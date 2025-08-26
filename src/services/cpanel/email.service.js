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

// Email Operations Service
export class EmailService {
  constructor(cpanelService) {
    this.cpanel = cpanelService;
  }

  async resetPassword(emailUser, domain, newPassword) {
    // According to cPanel API docs, email parameter can be either:
    // - Full email address (username@domain.com), or
    // - Just the username part
    // Let's use the full email address for clarity
    const fullEmail = `${emailUser}@${domain}`;
    
    debugLog(2, `Resetting password for: ${fullEmail}`);
    debugLog(3, `Password reset parameters:`, { email: fullEmail, domain });
    
    try {
      // passwd_pop uses GET method with query parameters, not POST
      const response = await this.cpanel.makeRequest('Email/passwd_pop', {
        email: fullEmail,
        password: newPassword,
        domain
      });

      debugLog(2, `Password reset response for ${fullEmail}:`, response);
      return response.status === 1;
    } catch (error) {
      debugLog(1, `Password reset failed for ${fullEmail}:`, error.message);
      throw error;
    }
  }

  async createAccount(username, domain, password, quota = 2048) {
    const fullEmail = `${username}@${domain}`;
    
    debugLog(2, `Creating email account: ${fullEmail}`);
    debugLog(3, `Email creation parameters:`, { email: fullEmail, domain, quota });
    
    try {
      // addpop creates a new email account
      const response = await this.cpanel.makeRequest('Email/add_pop', {
        email: username,
        password: password,
        domain: domain,
        quota: quota
      });

      debugLog(2, `Email creation response for ${fullEmail}:`, response);
      return response.status === 1;
    } catch (error) {
      debugLog(1, `Email creation failed for ${fullEmail}:`, error.message);
      throw error;
    }
  }

  async deleteAccount(emailUser, domain) {
    const fullEmail = `${emailUser}@${domain}`;
    
    debugLog(2, `Deleting email account: ${fullEmail}`);
    
    try {
      const response = await this.cpanel.postRequest('Email/delpop', {
        email: emailUser,
        domain: domain
      });

      debugLog(2, `Email deletion response for ${fullEmail}:`, response);
      return response.status === 1;
    } catch (error) {
      debugLog(1, `Email deletion failed for ${fullEmail}:`, error.message);
      throw error;
    }
  }

  async getAccountInfo(emailUser, domain) {
    const fullEmail = `${emailUser}@${domain}`;
    
    debugLog(2, `Getting account info for: ${fullEmail}`);
    
    try {
      const response = await this.cpanel.makeRequest('Email/list_pops', {
        regex: fullEmail
      });

      if (response.status === 1 && response.data && response.data.length > 0) {
        const accountInfo = response.data.find(account => account.email === fullEmail);
        debugLog(2, `Account info for ${fullEmail}:`, accountInfo);
        return accountInfo;
      }
      
      return null;
    } catch (error) {
      debugLog(1, `Failed to get account info for ${fullEmail}:`, error.message);
      throw error;
    }
  }
}
