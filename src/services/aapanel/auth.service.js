import axios from 'axios';
import chalk from 'chalk';
import crypto from 'crypto';
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

// aaPanel API Service
export class AapanelService {
  constructor(server, apiKey) {
    this.server = server;
    this.apiKey = apiKey;
    
    // Add https if not specified
    if (!this.server.startsWith('http://') && !this.server.startsWith('https://')) {
      this.server = `https://${this.server}`;
    }
  }

  // Generate authentication parameters for aaPanel API
  generateAuthParams() {
    const now = Date.now();
    const request_token = crypto.createHash('md5').update(now + crypto.createHash('md5').update(this.apiKey).digest('hex')).digest('hex');
    
    return {
      request_time: now.toString(),
      request_token: request_token
    };
  }

  async validateConnection() {
    const spinner = ora('Validating aaPanel API connection...').start();
    
    try {
      const authParams = this.generateAuthParams();
      const config = {
        url: `${this.server}/config`,
        method: 'POST',
        timeout: 10000,
        httpsAgent: new (await import('https')).Agent({ rejectUnauthorized: false }),
        params: {
          action: 'get_token',
          ...authParams
        }
      };

      debugLog(2, 'Validating connection with config:', config);

      const response = await axios(config);
      
      debugLog(3, 'Connection validation response:', response.data);
      
      // Check if response is HTML (internal server error)
      if (typeof response.data === 'string' && response.data.includes('<div>') && response.data.includes('Something went wrong')) {
        throw new Error('aaPanel internal server error');
      }
      
      // For get_token endpoint, check if we get a token back (successful response)
      if (response.data && response.data.token) {
        spinner.succeed('aaPanel API connection validated successfully!');
        return true;
      } else if (response.data && response.data.status === 0) {
        // Some endpoints return status: 0 for success
        spinner.succeed('aaPanel API connection validated successfully!');
        return true;
      } else {
        debugLog(1, 'Unexpected response format:', response.data);
        throw new Error(`Invalid API response - no token received. Response: ${JSON.stringify(response.data)}`);
      }
    } catch (error) {
      debugLog(1, 'Connection validation failed:', error.message);
      spinner.fail('aaPanel API connection failed. Please check your server URL and API key.');
      throw new Error(`aaPanel API connection failed: ${error.message}`);
    }
  }

  async makeRequest(action, s, data = {}) {
    const authParams = this.generateAuthParams();
    const url = `${this.server}/v2/plugin`;
    
    const config = {
      url,
      method: 'POST',
      timeout: 30000,
      httpsAgent: new (await import('https')).Agent({ rejectUnauthorized: false }),
      params: {
        action,
        name: 'mail_sys',
        s,
        ...authParams
      },
      data
    };

    debugLog(2, `Making aaPanel API request to ${s}:`, { params: config.params, data });

    try {
      const response = await axios(config);
      debugLog(3, `API response for ${s}:`, response.data);
      
      // Check if response is HTML (internal server error)
      if (typeof response.data === 'string' && response.data.includes('<div>') && response.data.includes('Something went wrong')) {
        // Extract error message from HTML
        const errorMatch = response.data.match(/<h4[^>]*>(.*?)<\/h4>/);
        const errorMessage = errorMatch ? errorMatch[1] : 'Internal server error';
        throw new Error(`aaPanel internal server error: ${errorMessage}`);
      }
      
      return response.data;
    } catch (error) {
      debugLog(1, `API request failed for ${s}:`, error.message);
      
      if (error.response) {
        debugLog(2, 'Error response data:', error.response.data);
        debugLog(2, 'Error response status:', error.response.status);
        
        // Check if error response is HTML
        if (typeof error.response.data === 'string' && error.response.data.includes('<div>') && error.response.data.includes('Something went wrong')) {
          const errorMatch = error.response.data.match(/<h4[^>]*>(.*?)<\/h4>/);
          const errorMessage = errorMatch ? errorMatch[1] : 'Internal server error';
          throw new Error(`aaPanel internal server error: ${errorMessage}`);
        }
        
        throw new Error(`API request failed: ${error.response.status} - ${error.response.data?.message || error.message}`);
      } else if (error.request) {
        throw new Error(`No response received from server: ${error.message}`);
      } else {
        throw new Error(`Request setup error: ${error.message}`);
      }
    }
  }
}
