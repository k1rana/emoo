import axios from 'axios';
import chalk from 'chalk';
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

// cPanel API Service
export class CpanelService {
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
    const spinner = ora('Validating API connection...').start();
    
    const methods = [
      { name: 'cpanel', headers: { 'Authorization': `cpanel ${this.username}:${this.apiKey}` } },
      { name: 'basic', auth: { username: this.username, password: this.apiKey } }
    ];

    for (const method of methods) {
      try {
        spinner.text = `Validating API connection using ${method.name} auth...`;
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
          spinner.succeed(`API connection validated successfully using ${method.name} auth!`);
          return true;
        }
      } catch (error) {
        debugLog(3, `Auth method ${method.name} failed:`, error.message);
        // Continue to next method
      }
    }
    
    spinner.fail('All authentication methods failed. Please check your credentials.');
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
      default:
        config.headers = { 'Authorization': `cpanel ${this.username}:${this.apiKey}` };
    }

    const response = await axios(config);
    return response.data;
  }
}
