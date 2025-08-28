import chalk from 'chalk';
import { spawn } from 'child_process';
import csv from 'csv-parser';
import { createReadStream } from 'fs';
import fs from 'fs-extra';
import inquirer from 'inquirer';
import { Listr } from 'listr2';
import path from 'path';

/**
 * IMAP synchronization service
 */
export class ImapService {
  constructor() {
    this.tasks = null;
  }

  /**
   * Helper function to parse boolean values
   */
  static toBool(value) {
    return value === '1' || value === 'true' || value === 'TRUE';
  }

  /**
   * Helper function to redact passwords from command arguments for display
   */
  static redactPasswords(args) {
    const redactedArgs = [...args];
    for (let i = 0; i < redactedArgs.length; i++) {
      if (redactedArgs[i] === '--password1' || redactedArgs[i] === '--password2') {
        if (i + 1 < redactedArgs.length) {
          redactedArgs[i + 1] = '***REDACTED***';
        }
      }
    }
    return redactedArgs;
  }

  /**
   * Check if imapsync is available locally
   */
  async checkImapsyncAvailability() {
    return new Promise((resolve) => {
      const child = spawn('which', ['imapsync']);
      child.on('close', (code) => {
        resolve(code === 0);
      });
    });
  }

  /**
   * Parse CSV file and return configurations
   */
  async parseCsvFile(csvFile) {
    if (!await fs.pathExists(csvFile)) {
      throw new Error(`CSV file not found: ${csvFile}`);
    }

    const configs = [];
    
    return new Promise((resolve, reject) => {
      createReadStream(csvFile)
        .pipe(csv())
        .on('data', (row) => {
          configs.push(row);
        })
        .on('error', reject)
        .on('end', () => {
          resolve(configs);
        });
    });
  }

  /**
   * Build imapsync command arguments from configuration
   */
  buildImapsyncArgs(config, options = {}) {
    const {
      src_host: shost,
      src_user: suser,
      src_pass: spass,
      dst_host: dhost,
      dst_user: duser,
      dst_pass: dpass,
      src_port,
      dst_port,
      src_ssl,
      dst_ssl,
      src_auth,
      dst_auth
    } = config;

    // Base flags
    const flags = [];
    
    // Disable imapsync's own logging to prevent LOG_imapsync folder creation
    flags.push('--nolog');
    flags.push('--useuid');
    flags.push('--maxsize', 100_000_000);
    
    // Add dry run flag only if explicitly requested
    if (options.dryRun) {
      flags.push('--dry');
    }
    
    // Add justfolders flag for folder structure preview (optional)
    if (options.justFolders) {
      flags.push('--justfolders');
    }

    // Add log file if provided
    if (options.logFile) {
      flags.push('--logfile', options.logFile);
    }

    // Add ports if specified
    if (src_port) flags.push('--port1', src_port);
    if (dst_port) flags.push('--port2', dst_port);

    // Add SSL flags
    if (src_ssl && ImapService.toBool(src_ssl)) flags.push('--ssl1');
    if (dst_ssl && ImapService.toBool(dst_ssl)) flags.push('--ssl2');

    // Add auth mechanisms
    if (src_auth) flags.push('--authmech1', src_auth);
    if (dst_auth) flags.push('--authmech2', dst_auth);

    // Add common options from environment
    if (process.env.COMMON_OPTS) {
      const commonOpts = process.env.COMMON_OPTS.split(' ');
      flags.push(...commonOpts);
    }

    return [
      '--host1', shost,
      '--user1', suser,
      '--password1', spass,
      '--host2', dhost,
      '--user2', duser,
      '--password2', dpass,
      ...flags
    ];
  }

  /**
   * Generate log file path for a sync operation
   */
  generateLogFilePath(config, logDir, unixTimestamp = null) {
    const { src_user: suser, dst_user: duser } = config;
    const sanitizedSrc = suser.replace(/@/g, '_');
    const sanitizedDst = duser.replace(/@/g, '_');
    
    // Use provided unix timestamp or generate new one
    const unixTime = unixTimestamp || Math.floor(Date.now() / 1000);
    
    // Add ISO timestamp to log file name for readability
    const isoTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
    
    // Create directory path with unix timestamp grouping
    const timestampDir = path.join(logDir, unixTime.toString());
    
    return path.join(timestampDir, `${sanitizedSrc}__to__${sanitizedDst}_${isoTimestamp}.log`);
  }

  /**
   * Create a single sync task for listr2
   */
  createSyncTask(config, options = {}, unixTimestamp = null, syncResults = null) {
    const {
      src_host: shost,
      src_user: suser,
      dst_host: dhost,
      dst_user: duser
    } = config;

    // Skip empty or commented lines
    if (!shost || shost.startsWith('#')) {
      return null;
    }

    const displayText = `${suser} (${shost}) -> ${duser} (${dhost})`;

    return {
      title: displayText,
      task: async (ctx, task) => {
        const logDir = options.logDir || './results/sync-log';
        
        const logFile = this.generateLogFilePath(config, logDir, unixTimestamp);
        
        // Ensure the directory exists (including unix timestamp subdirectory)
        await fs.ensureDir(path.dirname(logFile));

        const imapsyncArgs = this.buildImapsyncArgs(config, { ...options, logFile });

        return new Promise((resolve, reject) => {
          let command, args;

          if (options.docker) {
            command = 'docker';
            args = [
              'run', '--rm',
              '-e', 'IMAPSYNC_DEBUG=0',
              'gilleslamiral/imapsync',
              'imapsync',
              ...imapsyncArgs
            ];
          } else {
            command = 'imapsync';
            args = imapsyncArgs;
          }

          // Show command in debug mode or dry run mode
          if (options.debug || options.dryRun) {
            const commandText = options.dryRun ? 'DRY RUN - Executing: ' : 'Running: ';
            const redactedArgs = ImapService.redactPasswords(args);
            const fullCommand = `${command} ${redactedArgs.join(' ')}`;
            task.output = `${commandText}${fullCommand}`;
            
            // Also log to console in debug mode for visibility
            if (options.debug) {
              console.log(chalk.gray(`${commandText}${fullCommand}`));
            }
          }

          const child = spawn(command, args);
          
          // Create log file stream
          const logStream = fs.createWriteStream(logFile);
          
          child.stdout.pipe(logStream);
          child.stderr.pipe(logStream);
          
          // Only show detailed output in debug mode
          if (options.debug) {
            child.stdout.on('data', (data) => {
              task.output = data.toString();
            });
            
            child.stderr.on('data', (data) => {
              task.output = data.toString();
            });
          }

          child.on('close', (code) => {
            logStream.end();
            
            if (code === 0) {
              // Update success counter
              if (syncResults) {
                if (options.dryRun) {
                  syncResults.dryRun++;
                } else {
                  syncResults.successful++;
                }
              }
              
              if (options.dryRun) {
                task.title = `🔍 DRY RUN completed: ${displayText}`;
              } else {
                task.title = `✅ Successfully synced: ${displayText}`;
              }
              resolve({ success: true, logFile, dryRun: options.dryRun });
            } else {
              // Update failure counter
              if (syncResults) {
                syncResults.failed++;
              }
              
              const prefix = options.dryRun ? '🔍 DRY RUN failed: ' : '❌ Failed to sync: ';
              task.title = `${prefix}${displayText} (exit code: ${code})`;
              reject(new Error(`${prefix}${displayText} (exit code: ${code})`));
            }
          });

          child.on('error', (error) => {
            // Update failure counter
            if (syncResults) {
              syncResults.failed++;
            }
            
            const prefix = options.dryRun ? '🔍 DRY RUN error: ' : '❌ Error running imapsync: ';
            task.title = `${prefix}${error.message}`;
            reject(new Error(`${prefix}${error.message}`));
          });
        });
      }
    };
  }

  /**
   * Interactive email selection from CSV configurations
   */
  async selectEmailsInteractively(configs) {
    if (configs.length === 0) {
      return [];
    }

    console.log(chalk.blue('\n📧 Select emails to sync:'));
    console.log(chalk.gray('Use SPACE to select/deselect, ENTER to confirm'));
    console.log(chalk.gray('Press "a" to select all, "i" to invert selection\n'));

    const choices = configs.map((config, index) => {
      const { src_user, src_host, dst_user, dst_host } = config;
      return {
        name: `${src_user} (${src_host}) → ${dst_user} (${dst_host})`,
        value: index,
        checked: false
      };
    });

    const answer = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'selectedEmails',
        message: 'Choose emails to sync:',
        choices: choices,
        pageSize: 15,
        loop: false,
        validate: (input) => {
          if (input.length === 0) {
            return 'Please select at least one email to sync.';
          }
          return true;
        }
      }
    ]);

    return answer.selectedEmails.map(index => configs[index]);
  }

  /**
   * Main synchronization method
   */
  async sync(options = {}) {
    try {
      console.log(chalk.green('=== IMAP Email Synchronization ==='));

      const csvFile = options.csv || 'input/example.csv';
      const jobs = parseInt(options.jobs) || 1;

      console.log(chalk.blue(`Reading configuration from: ${csvFile}`));

      // Check if imapsync is available (unless using Docker)
      if (!options.docker) {
        const hasImapsync = await this.checkImapsyncAvailability();
        if (!hasImapsync) {
          console.log(chalk.yellow('imapsync not found locally. Consider using --docker option.'));
          console.log(chalk.yellow('Continuing with Docker mode...'));
          options.docker = true;
        }
      }

      // Parse CSV
      const tempSpinner = new Listr([
        {
          title: 'Parsing CSV file...',
          task: async (ctx) => {
            const configs = await this.parseCsvFile(csvFile);
            if (configs.length === 0) {
              throw new Error('No configurations found in CSV file');
            }
            ctx.configs = configs;
          }
        }
      ]);
      
      const context = await tempSpinner.run();
      let configs = context.configs;
      console.log(chalk.green(`✅ Found ${configs.length} configuration(s)`));

      // Interactive email selection (unless --all flag is provided)
      if (!options.all && !options.skipSelection) {
        configs = await this.selectEmailsInteractively(configs);
        if (configs.length === 0) {
          console.log(chalk.yellow('No emails selected. Exiting...'));
          return { successful: 0, failed: 0, skipped: 0, dryRun: 0, total: 0 };
        }
        console.log(chalk.green(`📋 Selected ${configs.length} email(s) for sync`));
      }

      if (options.dryRun) {
        console.log(chalk.yellow('\n🔍 DRY RUN MODE - No actual synchronization will be performed\n'));
      }

      // Generate unix timestamp for this sync batch to group logs
      const batchUnixTimestamp = Math.floor(Date.now() / 1000);
      console.log(chalk.blue(`📁 Logs will be grouped in directory: ${batchUnixTimestamp}`));

      // Track results manually using a shared counter
      const syncResults = {
        successful: 0,
        failed: 0,
        dryRun: 0
      };

      // Create sync tasks
      const syncTasks = configs
        .map(config => this.createSyncTask(config, options, batchUnixTimestamp, syncResults))
        .filter(task => task !== null); // Filter out skipped tasks

      if (syncTasks.length === 0) {
        console.log(chalk.yellow('No valid configurations to sync.'));
        return { successful: 0, failed: 0, skipped: configs.length, dryRun: 0, total: configs.length };
      }

      // Create and run listr2 tasks
      const taskList = new Listr(syncTasks, {
        concurrent: jobs > 1 ? jobs : false,
        exitOnError: false,
        collectErrors: 'minimal',
        rendererOptions: {
          collapseErrors: false,
          showErrorMessage: true,
          persistentOutput: options.debug,
          outputBar: options.debug ? Infinity : 0
        }
      });

      console.log(chalk.blue(`\n📊 Processing ${syncTasks.length} email accounts${jobs > 1 ? ` with ${jobs} parallel jobs` : ' sequentially'}\n`));

      let results;
      try {
        results = await taskList.run();
        console.log(chalk.green('\n✅ All sync tasks completed!'));
      } catch (error) {
        console.log(chalk.yellow('\n⚠️  Some sync tasks failed, but continuing with summary...'));
      }

      // Generate summary
      return this.generateSummary(syncResults, options, syncTasks.length, batchUnixTimestamp);

    } catch (error) {
      throw error;
    }
  }

  /**
   * Generate synchronization summary
   */
  generateSummary(syncResults, options, totalTasks, unixTimestamp = null) {
    const { successful, failed, dryRun } = syncResults;
    const skipped = 0; // We filter out skipped tasks before creating the task list

    console.log(chalk.green('\n=== Synchronization Summary ==='));
    if (options.dryRun) {
      console.log(chalk.yellow(`Dry run tasks: ${dryRun}`));
      if (failed > 0) {
        console.log(chalk.red(`Failed: ${failed}`));
      }
    } else {
      console.log(chalk.green(`Successful: ${successful}`));
      console.log(chalk.red(`Failed: ${failed}`));
      if (skipped > 0) {
        console.log(chalk.gray(`Skipped: ${skipped}`));
      }
    }

    if (options.logDir && unixTimestamp) {
      console.log(chalk.blue(`Log files saved to: ${path.join(options.logDir, unixTimestamp.toString())}`));
      console.log(chalk.gray(`Unix timestamp: ${unixTimestamp} (${new Date(unixTimestamp * 1000).toISOString()})`));
    } else if (options.logDir) {
      console.log(chalk.blue(`Log files saved to: ${options.logDir}`));
    }

    const processedJobs = parseInt(options.jobs) || 1;
    if (processedJobs > 1) {
      console.log(chalk.blue(`🚀 Processed with ${processedJobs} parallel jobs`));
    }

    return {
      successful,
      failed,
      skipped,
      dryRun,
      total: totalTasks
    };
  }
}
