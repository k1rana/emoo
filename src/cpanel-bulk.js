import axios from 'axios';
import chalk from 'chalk';
import { createObjectCsvWriter } from 'csv-writer';
import fs from 'fs-extra';
import inquirer from 'inquirer';
import path from 'path';

// Generate random password
function generatePassword(length = 12) {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += charset.charAt(Math.floor(Math.random() * charset.length));
  }
  return password;
}

// Global debug level
let DEBUG_LEVEL = 0;

// Print colored output
function printColor(color, message) {
  console.log(chalk[color](message));
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

// API client class
class CpanelAPI {
  constructor(server, username, apiKey) {
    this.server = server;
    this.username = username;
    this.apiKey = apiKey;
    this.authMethod = 'cpanel';
    
    // Add default port if not specified
    if (!server.includes(':')) {
      this.server = `${server}:2083`;
    }
  }

  async validateConnection() {
    printColor('blue', 'Validating API connection...');
    
    const methods = [
      { name: 'cpanel', headers: { 'Authorization': `cpanel ${this.username}:${this.apiKey}` } },
      { name: 'basic', auth: { username: this.username, password: this.apiKey } },
      { name: 'uapi-token', headers: { 'Authorization': `uapi-token ${this.username}:${this.apiKey}` } }
    ];

    for (const method of methods) {
      try {
        const config = {
          url: `https://${this.server}/execute/Quota/get_quota_info`,
          method: 'GET',
          timeout: 10000,
          httpsAgent: new (await import('https')).Agent({ rejectUnauthorized: false }),
          ...method
        };

        const response = await axios(config);
        
        if (response.data && response.data.status === 1 && response.data.data) {
          this.authMethod = method.name;
          printColor('green', `✅ API connection validated successfully using ${method.name} auth!`);
          return true;
        }
      } catch (error) {
        // Continue to next method
      }
    }
    
    throw new Error('All authentication methods failed. Please check your credentials.');
  }

  async makeRequest(endpoint, params = {}) {
    const url = `https://${this.server}/execute/${endpoint}`;
    const config = {
      url,
      method: 'GET',
      timeout: 10000,
      httpsAgent: new (await import('https')).Agent({ rejectUnauthorized: false }),
      params
    };

    switch (this.authMethod) {
      case 'basic':
        config.auth = { username: this.username, password: this.apiKey };
        break;
      case 'uapi-token':
        config.headers = { 'Authorization': `uapi-token ${this.username}:${this.apiKey}` };
        break;
      default:
        config.headers = { 'Authorization': `cpanel ${this.username}:${this.apiKey}` };
    }

    const response = await axios(config);
    return response.data;
  }

  async postRequest(endpoint, data = {}) {
    const url = `https://${this.server}/execute/${endpoint}`;
    const config = {
      url,
      method: 'POST',
      timeout: 10000,
      httpsAgent: new (await import('https')).Agent({ rejectUnauthorized: false }),
      data
    };

    switch (this.authMethod) {
      case 'basic':
        config.auth = { username: this.username, password: this.apiKey };
        break;
      case 'uapi-token':
        config.headers = { 'Authorization': `uapi-token ${this.username}:${this.apiKey}` };
        break;
      default:
        config.headers = { 'Authorization': `cpanel ${this.username}:${this.apiKey}` };
    }

    const response = await axios(config);
    return response.data;
  }

  async getDomains() {
    printColor('blue', 'Fetching domains...');
    const response = await this.makeRequest('DomainInfo/domains_data');
    
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
      return [...new Set(cleanDomains)].sort();
    }
    
    return [];
  }

  async getEmailAccounts(domain) {
    debugLog(1, `Getting emails for domain: ${domain}`);
    const response = await this.makeRequest('Email/list_pops', { regex: `@${domain}` });
    
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
  }

  async getAllEmails(regexFilter = '') {
    const params = regexFilter ? { regex: regexFilter } : {};
    const response = await this.makeRequest('Email/list_pops', params);
    
    if (response.status === 1 && response.data) {
      return response.data.map(account => account.user);
    }
    
    return [];
  }

  async getDomainsWithEmails() {
    const domains = await this.getDomains();
    const domainsWithEmails = [];

    for (const domain of domains) {
      const emails = await this.getEmailAccounts(domain);
      if (emails.length > 0) {
        domainsWithEmails.push({ domain, emailCount: emails.length });
      }
    }

    return domainsWithEmails;
  }

  async resetEmailPassword(emailUser, domain, newPassword) {
    // According to cPanel API docs, email parameter can be either:
    // - Full email address (username@domain.com), or
    // - Just the username part
    // Let's use the full email address for clarity
    const fullEmail = `${emailUser}@${domain}`;
    
    debugLog(2, `Resetting password for: ${fullEmail}`);
    debugLog(3, `Password reset parameters:`, { email: fullEmail, domain });
    
    // passwd_pop uses GET method with query parameters, not POST
    const response = await this.makeRequest('Email/passwd_pop', {
      email: fullEmail,
      password: newPassword,
      domain
    });

    debugLog(2, `Password reset response for ${fullEmail}:`, response);
    return response.status === 1;
  }
}

// Interactive domain selection with arrow navigation
async function selectDomains(domainsWithEmails) {
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

// Interactive input function with better UX
async function getInteractiveInput(options) {
  const questions = [];

  // Server input
  if (!options.server) {
    questions.push({
      type: 'input',
      name: 'server',
      message: 'Enter server domain/IP:',
      default: 'your-server.com:2083',
      validate: (input) => {
        if (!input.trim()) {
          return 'Server cannot be empty';
        }
        return true;
      },
      filter: (input) => {
        // Add default port if not specified
        if (!input.includes(':')) {
          return `${input}:2083`;
        }
        return input;
      }
    });
  }

  // Username input
  if (!options.username) {
    questions.push({
      type: 'input',
      name: 'username',
      message: 'Enter cPanel username:',
      validate: (input) => {
        if (!input.trim()) {
          return 'Username cannot be empty';
        }
        return true;
      }
    });
  }

  // API Key input
  if (!options.apiKey) {
    questions.push({
      type: 'password',
      name: 'apiKey',
      message: 'Enter cPanel API key:',
      mask: '*',
      validate: (input) => {
        if (!input.trim()) {
          return 'API key cannot be empty';
        }
        return true;
      }
    });
  }

  const answers = await inquirer.prompt(questions);

  return {
    server: options.server || answers.server,
    username: options.username || answers.username,
    apiKey: options.apiKey || answers.apiKey
  };
}

// Get password preference
async function getPasswordPreference(options) {
  if (options.password) {
    return {
      useRandom: false,
      password: options.password
    };
  }

  const { passwordType } = await inquirer.prompt([
    {
      type: 'list',
      name: 'passwordType',
      message: 'Password setting:',
      choices: [
        { name: 'Generate random passwords for each account', value: 'random' },
        { name: 'Use same password for all accounts', value: 'same' }
      ]
    }
  ]);

  if (passwordType === 'same') {
    const { password } = await inquirer.prompt([
      {
        type: 'password',
        name: 'password',
        message: 'Enter new password for all accounts:',
        mask: '*',
        validate: (input) => {
          if (!input.trim()) {
            return 'Password cannot be empty';
          }
          if (input.length < 6) {
            return 'Password must be at least 6 characters long';
          }
          return true;
        }
      }
    ]);

    return {
      useRandom: false,
      password: password
    };
  }

  return {
    useRandom: true,
    password: null
  };
}

// Get CSV filename
async function getCSVFilename(options) {
  if (options.output) {
    return options.output;
  }

  const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  const defaultFilename = `email_password_reset_${timestamp}.csv`;

  const { filename } = await inquirer.prompt([
    {
      type: 'input',
      name: 'filename',
      message: 'Enter CSV filename (will be saved to ./results/):',
      default: defaultFilename,
      filter: (input) => {
        if (!input.trim()) {
          return defaultFilename;
        }
        return input.endsWith('.csv') ? input : `${input}.csv`;
      }
    }
  ]);

  return path.join('./results', filename);
}
// Main function
export async function cpanelBulkReset(options = {}) {
  printColor('green', '=== cPanel Bulk Email Password Reset ===');

  // Set global debug level
  DEBUG_LEVEL = options.debugLevel || 0;
  if (DEBUG_LEVEL > 0) {
    debugLog(1, `Debug level set to: ${DEBUG_LEVEL}`);
  }

  // Step 1: Get server, username, and API key
  const credentials = await getInteractiveInput(options);
  const api = new CpanelAPI(credentials.server, credentials.username, credentials.apiKey);

  try {
    // Step 2: Validate API connection
    await api.validateConnection();
  } catch (error) {
    throw new Error(`API validation failed: ${error.message}`);
  }

  // Step 3: Get domains with email accounts and let user select
  printColor('blue', 'Fetching domains with email accounts...');
  const domainsWithEmails = await api.getDomainsWithEmails();

  if (domainsWithEmails.length === 0) {
    throw new Error('No domains with email accounts found!');
  }

  printColor('green', `Found ${domainsWithEmails.length} domains with email accounts:`);
  domainsWithEmails.forEach(item => {
    printColor('cyan', `  - ${item.domain} (${item.emailCount} emails)`);
  });

  const selectedDomains = await selectDomains(domainsWithEmails);

  if (selectedDomains.length === 0) {
    printColor('yellow', 'No domains selected. Exiting.');
    return;
  }

  printColor('green', `\nSelected domains: ${selectedDomains.join(', ')}`);

  // Step 4: Get password preference
  const { useRandom, password: newPassword } = await getPasswordPreference(options);

  if (useRandom) {
    printColor('yellow', '\nWill generate random passwords for each account');
  } else {
    printColor('yellow', '\nWill use the same password for all accounts');
  }

  // Step 5: Get CSV filename
  const csvFile = await getCSVFilename(options);
  
  // Ensure results directory exists
  const resultsDir = path.dirname(csvFile);
  await fs.ensureDir(resultsDir);

  printColor('green', `\nResults will be saved to: ${csvFile}`);

  // Confirm before proceeding
  const { proceed } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'proceed',
      message: 'Continue with password reset?',
      default: true
    }
  ]);

  if (!proceed) {
    printColor('yellow', 'Operation cancelled.');
    return;
  }

  // Initialize CSV writer
  const csvWriter = createObjectCsvWriter({
    path: csvFile,
    header: [
      { id: 'domain', title: 'Domain' },
      { id: 'email', title: 'Email' },
      { id: 'oldPasswordStatus', title: 'Old_Password_Status' },
      { id: 'newPassword', title: 'New_Password' },
      { id: 'resetStatus', title: 'Reset_Status' },
      { id: 'timestamp', title: 'Timestamp' }
    ]
  });

  const results = [];

  // Process each selected domain
  printColor('blue', '\n=== Starting Password Reset Process ===');
  
  for (const domain of selectedDomains) {
    printColor('cyan', `\nProcessing domain: ${domain}`);

    const emailAccounts = await api.getEmailAccounts(domain);

    if (emailAccounts.length === 0) {
      printColor('yellow', `  No email accounts found for ${domain}`);
      continue;
    }

    for (const emailUser of emailAccounts) {
      const password = useRandom ? generatePassword(12) : newPassword;

      printColor('blue', `  Resetting password for: ${emailUser}@${domain}`);

      try {
        const success = await api.resetEmailPassword(emailUser, domain, password);

        if (success) {
          printColor('green', '    ✅ Success');
          results.push({
            domain,
            email: `${emailUser}@${domain}`,
            oldPasswordStatus: 'N/A',
            newPassword: password,
            resetStatus: 'SUCCESS',
            timestamp: new Date().toISOString()
          });
        } else {
          printColor('red', '    ❌ Failed');
          results.push({
            domain,
            email: `${emailUser}@${domain}`,
            oldPasswordStatus: 'N/A',
            newPassword: password,
            resetStatus: 'FAILED',
            timestamp: new Date().toISOString()
          });
        }
      } catch (error) {
        printColor('red', `    ❌ Failed: ${error.message}`);
        results.push({
          domain,
          email: `${emailUser}@${domain}`,
          oldPasswordStatus: 'N/A',
          newPassword: password,
          resetStatus: 'FAILED',
          timestamp: new Date().toISOString()
        });
      }
    }
  }

  // Write results to CSV
  await csvWriter.writeRecords(results);

  // Show summary
  const successCount = results.filter(r => r.resetStatus === 'SUCCESS').length;
  const failedCount = results.filter(r => r.resetStatus === 'FAILED').length;

  printColor('green', '\n=== Process Complete ===');
  printColor('cyan', `Results saved to: ${csvFile}`);
  printColor('green', `\nSummary:`);
  printColor('green', `  ✅ Successful resets: ${successCount}`);
  
  if (failedCount > 0) {
    printColor('red', `  ❌ Failed resets: ${failedCount}`);
  }

  if (useRandom && successCount > 0) {
    printColor('yellow', '  📝 Random passwords generated - check CSV file for details');
  }

  printColor('cyan', '\nThank you for using cPanel Bulk Email Password Reset! 🚀');
}
