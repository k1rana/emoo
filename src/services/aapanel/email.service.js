import chalk from 'chalk';

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

export class EmailService {
  constructor(aapanelService) {
    this.aapanelService = aapanelService;
  }

  /**
   * Create an email account
   * @param {string} username - The email username (without domain)
   * @param {string} domain - The domain name
   * @param {string} password - The password for the email account
   * @param {number} quota - The quota in MB (default: 2048 = 2GB)
   * @returns {boolean} Success status
   */
  async createAccount(username, domain, password, quota = 2048) {
    const fullEmail = `${username}@${domain}`;
    
    try {
      debugLog(1, `Creating email account: ${fullEmail}`);
      
      // Convert quota from MB to GB for aaPanel API (it expects "2 GB" format)
      const quotaGB = Math.ceil(quota / 1024);
      const quotaString = `${quotaGB} GB`;
      
      const requestData = {
        full_name: username,  // Just the username part (before @)
        quota: quotaString,   // "2 GB" format
        is_admin: 0,         // Always 0 as requested
        username: fullEmail, // Full email as username
        password: password,
        active: 1,           // Always 1 as requested
        quota_active: 1      // Always 1 as requested
      };

      debugLog(2, `Email creation request data for ${fullEmail}:`, requestData);

      const response = await this.aapanelService.makeRequest('a', 'add_mailbox_v2', requestData);

      // Handle different response statuses:
      // status: 0 = success
      // status: -1 = error (email already exists, etc.)
      // HTML response = internal server error
      
      if (response.status === 0) {
        debugLog(1, `✅ Successfully created email: ${fullEmail}`, response.message);
        return true;
      } else if (response.status === -1) {
        const errorMessage = response.message?.result || 'Unknown error';
        debugLog(1, `❌ Failed to create email: ${fullEmail} - ${errorMessage}`);
        throw new Error(errorMessage);
      } else {
        debugLog(1, `❌ Failed to create email: ${fullEmail}`, response);
        throw new Error('Unexpected response format');
      }
    } catch (error) {
      debugLog(1, `❌ Error creating email ${fullEmail}:`, error.message);
      throw error;
    }
  }

  /**
   * Get list of email accounts
   * @returns {Array} List of email accounts
   */
  async getEmailList() {
    try {
      debugLog(1, 'Getting email list from aaPanel');
      
      const response = await this.aapanelService.makeRequest('a', 'get_mail_list');
      
      if (response.status === 0 || Array.isArray(response)) {
        debugLog(2, 'Email list response:', response);
        return response.data || response || [];
      } else {
        throw new Error('Failed to get email list');
      }
    } catch (error) {
      debugLog(1, 'Error getting email list:', error.message);
      throw error;
    }
  }
}
