#!/usr/bin/env node

import chalk from 'chalk';
import { Command } from 'commander';
import { cpanelBulkReset } from '../src/cpanel-bulk.js';
import { imapSync } from '../src/imap-sync.js';

const program = new Command();

program
  .name('migrate-imap')
  .description('CLI tool for IMAP email migration and cPanel bulk operations')
  .version('1.0.0');

// cPanel bulk email password reset command
program
  .command('cpanel')
  .description('cPanel bulk email password reset')
  .option('-s, --server <server>', 'cPanel server domain/IP (with optional port)')
  .option('-u, --username <username>', 'cPanel username')
  .option('-k, --api-key <key>', 'cPanel API key')
  .option('-p, --password <password>', 'New password for all accounts (leave empty for random)')
  .option('-o, --output <file>', 'Output CSV file path')
  .option('--regex <pattern>', 'Filter emails using regex pattern')
  .option('-v, --verbose', 'Enable debug output (use multiple times: -v, -vv, -vvv for more detail)', (_, previous) => previous + 1, 0)
  .option('--very-verbose', 'Enable detailed debug output (equivalent to -vv)') 
  .option('--ultra-verbose', 'Enable ultra detailed debug output (equivalent to -vvv)')
  .option('--debug', 'Enable debug mode (deprecated, use -v instead)')
  .action(async (options) => {
    try {
      // Determine debug level - support both counting -v flags and explicit options
      let debugLevel = 0;
      if (options.debug) debugLevel = Math.max(debugLevel, 1); // Legacy support
      if (options.verbose > 0) debugLevel = Math.max(debugLevel, options.verbose);
      if (options.veryVerbose) debugLevel = Math.max(debugLevel, 2);
      if (options.ultraVerbose) debugLevel = Math.max(debugLevel, 3);

      // Map CLI option names to function parameter names
      const mappedOptions = {
        server: options.server,
        username: options.username,
        apiKey: options.apiKey,  // Map --api-key to apiKey
        password: options.password,
        output: options.output,
        regex: options.regex,
        debugLevel: debugLevel
      };
      
      await cpanelBulkReset(mappedOptions);
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      if (options.debug) {
        console.error(chalk.red('Stack trace:'), error.stack);
      }
      process.exit(1);
    }
  });

// IMAP sync command
program
  .command('sync')
  .description('Sync emails between IMAP servers')
  .option('-c, --csv <file>', 'CSV file containing sync configurations', 'input/example.csv')
  .option('-j, --jobs <number>', 'Number of parallel jobs', '1')
  .option('--docker', 'Use Docker for imapsync')
  .option('--log-dir <dir>', 'Log directory', './results')
  .option('--dry-run', 'Show what would be synced without actually syncing')
  .action(async (options) => {
    try {
      await imapSync(options);
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// Show help by default if no command provided
if (process.argv.length <= 2) {
  program.help();
}

program.parse();
