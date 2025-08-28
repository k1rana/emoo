import chalk from 'chalk';
import fs from 'fs-extra';
import inquirer from 'inquirer';
import path from 'path';

// Utility functions
export class UtilService {
  // Generate random password
  static generatePassword(length = 12) {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let password = '';
    for (let i = 0; i < length; i++) {
      password += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    return password;
  }

  // Print colored output
  static printColor(color, message) {
    console.log(chalk[color](message));
  }

  // Get interactive input for credentials
  static async getInteractiveInput(options) {
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

    // API Key/Password input
    if (!options.apiKey) {
      questions.push({
        type: 'password',
        name: 'apiKey',
        message: 'Enter cPanel API Token or Password:',
        mask: '*',
        validate: (input) => {
          if (!input.trim()) {
            return 'API Token or Password cannot be empty';
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
  static async getPasswordPreference(options) {
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
  static async getCSVFilename(options, operation = 'operation') {
    if (options.output) {
      return options.output;
    }

    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    const defaultFilename = `email_${operation}_${timestamp}.csv`;

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

  // Get CSV filename with custom default
  static async getCSVFilenameWithCustomDefault(options, customDefault) {
    if (options.output) {
      return options.output;
    }

    const { filename } = await inquirer.prompt([
      {
        type: 'input',
        name: 'filename',
        message: 'Enter CSV filename (will be saved to ./results/):',
        default: customDefault,
        filter: (input) => {
          if (!input.trim()) {
            return customDefault;
          }
          return input.endsWith('.csv') ? input : `${input}.csv`;
        }
      }
    ]);

    return path.join('./results', filename);
  }

  // Ensure results directory exists
  static async ensureResultsDir(csvFile) {
    const resultsDir = path.dirname(csvFile);
    await fs.ensureDir(resultsDir);
    return resultsDir;
  }

  // Confirm action
  static async confirmAction(message = 'Continue?', defaultValue = true) {
    const { proceed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'proceed',
        message: message,
        default: defaultValue
      }
    ]);

    return proceed;
  }
}
