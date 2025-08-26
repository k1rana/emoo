import chalk from 'chalk';
import { spawn } from 'child_process';
import csv from 'csv-parser';
import { createReadStream } from 'fs';
import fs from 'fs-extra';
import path from 'path';
import ora from 'ora';

/**
 * IMAP synchronization service
 */
export class ImapService {
  constructor() {
    this.spinner = null;
  }

  /**
   * Helper function to parse boolean values
   */
  static toBool(value) {
    return value === '1' || value === 'true' || value === 'TRUE';
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
  buildImapsyncArgs(config) {
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
    const flags = ['--dry', '--justfolders'];

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
  generateLogFilePath(config, logDir) {
    const { src_user: suser, dst_user: duser } = config;
    const sanitizedSrc = suser.replace(/@/g, '_');
    const sanitizedDst = duser.replace(/@/g, '_');
    return path.join(logDir, `${sanitizedSrc}__to__${sanitizedDst}.log`);
  }

  /**
   * Run imapsync for one configuration
   */
  async runSingleSync(config, options = {}) {
    const {
      src_host: shost,
      src_user: suser,
      dst_user: duser
    } = config;

    // Skip empty or commented lines
    if (!shost || shost.startsWith('#')) {
      return { success: true, skipped: true };
    }

    console.log(chalk.blue(`Syncing: ${suser} -> ${duser}`));

    const logDir = options.logDir || './results';
    await fs.ensureDir(logDir);

    const logFile = this.generateLogFilePath(config, logDir);
    const imapsyncArgs = this.buildImapsyncArgs(config);

    if (options.dryRun) {
      console.log(chalk.yellow('DRY RUN - Command that would be executed:'));
      if (options.docker) {
        console.log(chalk.gray('docker run --rm gilleslamiral/imapsync imapsync'), imapsyncArgs.join(' '));
      } else {
        console.log(chalk.gray('imapsync'), imapsyncArgs.join(' '));
      }
      return { success: true, dryRun: true };
    }

    return new Promise((resolve) => {
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

      console.log(chalk.gray(`Running: ${command} ${args.join(' ')}`));

      const child = spawn(command, args);
      
      // Create log file stream
      const logStream = fs.createWriteStream(logFile);
      
      child.stdout.pipe(logStream);
      child.stderr.pipe(logStream);
      
      // Also pipe to console if not in quiet mode
      if (!options.quiet) {
        child.stdout.on('data', (data) => {
          process.stdout.write(data);
        });
        
        child.stderr.on('data', (data) => {
          process.stderr.write(data);
        });
      }

      child.on('close', (code) => {
        logStream.end();
        
        if (code === 0) {
          console.log(chalk.green(`✅ Successfully synced ${suser} -> ${duser}`));
          resolve({ success: true, logFile });
        } else {
          console.log(chalk.red(`❌ Failed to sync ${suser} -> ${duser} (exit code: ${code})`));
          resolve({ success: false, exitCode: code, logFile });
        }
      });

      child.on('error', (error) => {
        console.log(chalk.red(`❌ Error running imapsync: ${error.message}`));
        resolve({ success: false, error: error.message });
      });
    });
  }

  /**
   * Run multiple syncs in parallel
   */
  async runParallelSyncs(configs, options, maxJobs) {
    const results = [];
    const running = [];

    for (let i = 0; i < configs.length; i++) {
      const config = configs[i];
      
      // Wait if we have too many running jobs
      while (running.length >= maxJobs) {
        const completed = await Promise.race(running);
        const index = running.indexOf(completed);
        running.splice(index, 1);
        results.push(await completed);
      }

      // Start new job
      const job = this.runSingleSync(config, options);
      running.push(job);
    }

    // Wait for remaining jobs
    const remaining = await Promise.all(running);
    results.push(...remaining);

    return results;
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
      this.spinner = ora('Parsing CSV file...').start();
      const configs = await this.parseCsvFile(csvFile);
      this.spinner.succeed(`Found ${configs.length} configuration(s)`);
      
      if (configs.length === 0) {
        throw new Error('No configurations found in CSV file');
      }

      if (options.dryRun) {
        console.log(chalk.yellow('\n🔍 DRY RUN MODE - No actual synchronization will be performed\n'));
      }

      // Process configurations
      let results;
      if (jobs <= 1) {
        // Sequential processing
        console.log(chalk.blue('Running synchronizations sequentially...'));
        results = [];
        for (const config of configs) {
          const result = await this.runSingleSync(config, options);
          results.push(result);
        }
      } else {
        // Parallel processing
        console.log(chalk.blue(`Running synchronizations with ${jobs} parallel jobs...`));
        results = await this.runParallelSyncs(configs, options, jobs);
      }

      // Generate summary
      return this.generateSummary(results, options);

    } catch (error) {
      if (this.spinner) {
        this.spinner.fail('Synchronization failed');
      }
      throw error;
    }
  }

  /**
   * Generate synchronization summary
   */
  generateSummary(results, options) {
    const successful = results.filter(r => r.success && !r.skipped && !r.dryRun).length;
    const failed = results.filter(r => !r.success && !r.skipped).length;
    const skipped = results.filter(r => r.skipped).length;
    const dryRun = results.filter(r => r.dryRun).length;

    console.log(chalk.green('\n=== Synchronization Summary ==='));
    if (dryRun > 0) {
      console.log(chalk.yellow(`Dry run commands shown: ${dryRun}`));
    } else {
      console.log(chalk.green(`Successful: ${successful}`));
      console.log(chalk.red(`Failed: ${failed}`));
      console.log(chalk.gray(`Skipped: ${skipped}`));
    }

    if (options.logDir) {
      console.log(chalk.blue(`Log files saved to: ${options.logDir}`));
    }

    return {
      successful,
      failed,
      skipped,
      dryRun,
      total: results.length
    };
  }
}
