import chalk from 'chalk';
import inquirer from 'inquirer';
import { Listr } from 'listr2';
import ora from 'ora';

// Global debug level
let DEBUG_LEVEL = 0;

export function setDebugLevel(level) {
  DEBUG_LEVEL = level;
}

// Debug logging with levels
function debugLog(level, message, data = null) {
  if (DEBUG_LEVEL >= level) {
    const prefix = level === 1 ? 'DEBUG' : level === 2 ? 'DEBUG++' : 'DEBUG+++';
    console.log(chalk.gray(`[${prefix}] ${message}`));
    if (data !== null && DEBUG_LEVEL >= 2) {
      console.log(chalk.gray(JSON.stringify(data, null, 2)));
    }
  }
}

// Domain and Email Management Service
export class DomainService {
  constructor(cpanelService) {
    this.cpanel = cpanelService;
  }

  async getDomains() {
    const spinner = ora('Fetching domains...').start();
    
    try {
      const response = await this.cpanel.makeRequest('DomainInfo/domains_data');
      
      debugLog(2, 'domains_data API response:', response.data);
      
      if (response.status === 1 && response.data) {
        const domains = response.data.main_domain ? [response.data.main_domain] : [];
        
        if (response.data.addon_domains) {
          // addon_domains might be an array of objects or strings
          const addonDomains = Array.isArray(response.data.addon_domains) 
            ? response.data.addon_domains.map(domain => typeof domain === 'string' ? domain : domain.domain || domain.name || domain)
            : Object.keys(response.data.addon_domains); // Sometimes it's an object
          domains.push(...addonDomains);
          debugLog(3, `Added ${addonDomains.length} addon domains:`, addonDomains);
        }
        
        if (response.data.sub_domains) {
          // sub_domains might be an array of objects or strings  
          const subDomains = Array.isArray(response.data.sub_domains)
            ? response.data.sub_domains.map(domain => typeof domain === 'string' ? domain : domain.domain || domain.name || domain)
            : Object.keys(response.data.sub_domains); // Sometimes it's an object
          domains.push(...subDomains);
          debugLog(3, `Added ${subDomains.length} sub domains:`, subDomains);
        }
        
        // Filter out any undefined/null values and ensure all are strings
        const cleanDomains = domains.filter(domain => domain && typeof domain === 'string');
        debugLog(1, `Clean domains found: ${cleanDomains.length}`, cleanDomains);
        
        const uniqueDomains = [...new Set(cleanDomains)].sort();
        spinner.succeed(`Found ${uniqueDomains.length} domains`);
        return uniqueDomains;
      }
      
      spinner.fail('No domains found');
      return [];
    } catch (error) {
      spinner.fail('Failed to fetch domains');
      throw error;
    }
  }

  async getEmailAccounts(domain) {
    debugLog(1, `Getting emails for domain: ${domain}`);
    
    try {
      const response = await this.cpanel.makeRequest('Email/list_pops', { regex: `@${domain}` });
      
      debugLog(2, `Email API response for ${domain}:`, response.data?.slice(0, 3));
      
      if (response.status === 1 && response.data) {
        // Filter to only include emails for this specific domain
        const filteredEmails = response.data
          .filter(account => account.email && account.email.endsWith(`@${domain}`))
          .map(account => account.user || account.email.split('@')[0]);
        
        debugLog(1, `Filtered emails for ${domain}: ${filteredEmails.length}`);
        debugLog(3, `Email list for ${domain}:`, filteredEmails);
        return filteredEmails;
      }
      
      return [];
    } catch (error) {
      debugLog(1, `Failed to get emails for ${domain}:`, error.message);
      return [];
    }
  }

  async getAllEmails(regexFilter = '') {
    const params = regexFilter ? { regex: regexFilter } : {};
    const response = await this.cpanel.makeRequest('Email/list_pops', params);
    
    if (response.status === 1 && response.data) {
      return response.data.map(account => account.user);
    }
    
    return [];
  }

  async getDomainsWithEmailsParallel(parallelJobs = 3) {
    const domains = await this.getDomains();
    
    if (domains.length === 0) {
      return [];
    }

    const tasks = new Listr([
      {
        title: 'Analyzing domains with email accounts in parallel',
        task: async (ctx, task) => {
          const domainTasks = domains.map(domain => ({
            title: `Checking ${domain}`,
            task: async (subCtx, subTask) => {
              try {
                const emails = await this.getEmailAccounts(domain);
                if (emails.length > 0) {
                  ctx.domainsWithEmails = ctx.domainsWithEmails || [];
                  ctx.domainsWithEmails.push({ domain, emailCount: emails.length });
                  subTask.title = `Checking ${domain} (${emails.length} emails found)`;
                } else {
                  subTask.skip(`${domain} has no email accounts`);
                }
              } catch (error) {
                subTask.skip(`Failed to check ${domain}: ${error.message}`);
              }
            }
          }));

          return task.newListr(domainTasks, { concurrent: parallelJobs });
        }
      }
    ], { concurrent: false });

    const context = await tasks.run();
    return context.domainsWithEmails || [];
  }

  async getDomainsWithEmails() {
    const spinner = ora('Analyzing domains with email accounts...').start();
    
    try {
      const domains = await this.getDomains();
      const domainsWithEmails = [];

      let processedCount = 0;
      for (const domain of domains) {
        processedCount++;
        spinner.text = `Checking emails for domain ${processedCount}/${domains.length}: ${domain}`;
        
        const emails = await this.getEmailAccounts(domain);
        if (emails.length > 0) {
          domainsWithEmails.push({ domain, emailCount: emails.length });
        }
      }

      spinner.succeed(`Found ${domainsWithEmails.length} domains with email accounts`);
      return domainsWithEmails;
    } catch (error) {
      spinner.fail('Failed to analyze domains with emails');
      throw error;
    }
  }

  async selectDomains(domainsWithEmails) {
    if (domainsWithEmails.length === 0) {
      throw new Error('No domains with email accounts found!');
    }

    console.log(chalk.cyan('\n=== Domain Selection ==='));
    console.log(chalk.yellow('Select domains to process (use Space to toggle, Enter to confirm):'));

    const choices = domainsWithEmails.map(item => ({
      name: `${item.domain} (${item.emailCount} emails)`,
      value: item.domain,
      checked: false
    }));

    const { selectedDomains } = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'selectedDomains',
        message: 'Choose domains:',
        choices: choices,
        validate: (answer) => {
          if (answer.length < 1) {
            return 'You must choose at least one domain.';
          }
          return true;
        }
      }
    ]);

    return selectedDomains;
  }
}
