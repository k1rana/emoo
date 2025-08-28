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

export class DomainService {
  constructor(aapanelService) {
    this.aapanelService = aapanelService;
  }

  /**
   * Get all domains from aaPanel mail system
   * @param {number} page - Page number (default: 1)
   * @param {number} size - Page size (default: 100 to get all domains)
   * @returns {Array} List of domain names
   */
  async getDomains(page = 1, size = 100) {
    try {
      debugLog(1, `Getting domains from aaPanel (page: ${page}, size: ${size})`);
      
      const requestData = {
        p: page,
        size: size
      };

      const response = await this.aapanelService.makeRequest('a', 'get_domains', requestData);
      
      if (response.status === 0) {
        const domains = response.message?.data || [];
        const domainNames = domains.map(domain => domain.domain);
        
        debugLog(2, 'Domains response:', domains);
        debugLog(1, `Found ${domainNames.length} domains: ${domainNames.join(', ')}`);
        
        return domainNames;
      } else if (response.status === -1) {
        const errorMessage = response.message?.result || 'Failed to get domains';
        throw new Error(errorMessage);
      } else {
        throw new Error('Unexpected response format');
      }
    } catch (error) {
      debugLog(1, 'Error getting domains:', error.message);
      throw error;
    }
  }

  /**
   * Get all domains with pagination support (fetches all pages)
   * @returns {Array} Complete list of all domain names
   */
  async getAllDomains() {
    try {
      const allDomains = [];
      let page = 1;
      const size = 50; // Reasonable page size
      
      while (true) {
        const response = await this.aapanelService.makeRequest('a', 'get_domains', {
          p: page,
          size: size
        });
        
        if (response.status === 0) {
          const domains = response.message?.data || [];
          
          if (domains.length === 0) {
            break; // No more domains
          }
          
          const domainNames = domains.map(domain => domain.domain);
          allDomains.push(...domainNames);
          
          debugLog(2, `Page ${page}: Found ${domainNames.length} domains`);
          
          // If we got fewer domains than requested, we're on the last page
          if (domains.length < size) {
            break;
          }
          
          page++;
        } else {
          break;
        }
      }
      
      debugLog(1, `Total domains found: ${allDomains.length}`);
      return allDomains;
    } catch (error) {
      debugLog(1, 'Error getting all domains:', error.message);
      throw error;
    }
  }
}
