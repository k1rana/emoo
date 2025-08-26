import chalk from 'chalk';
import { spawn } from 'child_process';
import csv from 'csv-parser';
import { createReadStream } from 'fs';
import fs from 'fs-extra';
import path from 'path';

// Helper function to parse boolean values
function toBool(value) {
  return value === '1' || value === 'true' || value === 'TRUE';
}

// Check if imapsync is available
async function haveImapsync() {
  return new Promise((resolve) => {
    const child = spawn('which', ['imapsync']);
    child.on('close', (code) => {
      resolve(code === 0);
    });
  });
}

// Run imapsync for one configuration
async function runOne(config, options) {
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

  // Skip empty or commented lines
  if (!shost || shost.startsWith('#')) {
    return { success: true, skipped: true };
  }

  console.log(chalk.blue(`Syncing: ${suser} -> ${duser}`));

  const logDir = options.logDir || './results';
  await fs.ensureDir(logDir);

  const logFile = path.join(logDir, `${suser.replace(/@/g, '_')}__to__${duser.replace(/@/g, '_')}.log`);

  // Base flags
  const flags = ['--dry' , '--justfolders'];

  // Add ports if specified
  if (src_port) flags.push('--port1', src_port);
  if (dst_port) flags.push('--port2', dst_port);

  // Add SSL flags
  if (src_ssl && toBool(src_ssl)) flags.push('--ssl1');
  if (dst_ssl && toBool(dst_ssl)) flags.push('--ssl2');

  // Add auth mechanisms
  if (src_auth) flags.push('--authmech1', src_auth);
  if (dst_auth) flags.push('--authmech2', dst_auth);

  // Add common options from environment or options
  if (process.env.COMMON_OPTS) {
    const commonOpts = process.env.COMMON_OPTS.split(' ');
    flags.push(...commonOpts);
  }

  const imapsyncArgs = [
    '--host1', shost,
    '--user1', suser,
    '--password1', spass,
    '--host2', dhost,
    '--user2', duser,
    '--password2', dpass,
    ...flags
  ];

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
    
    // Also pipe to console
    child.stdout.on('data', (data) => {
      process.stdout.write(data);
    });
    
    child.stderr.on('data', (data) => {
      process.stderr.write(data);
    });

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

// Parse CSV and get column indices
async function parseCsvHeader(csvFile) {
  return new Promise((resolve, reject) => {
    const headers = [];
    
    createReadStream(csvFile)
      .pipe(csv())
      .on('headers', (headerList) => {
        headers.push(...headerList);
      })
      .on('error', reject)
      .on('end', () => {
        const indices = {
          idx_src_host: headers.indexOf('src_host'),
          idx_src_user: headers.indexOf('src_user'),
          idx_src_pass: headers.indexOf('src_pass'),
          idx_dst_host: headers.indexOf('dst_host'),
          idx_dst_user: headers.indexOf('dst_user'),
          idx_dst_pass: headers.indexOf('dst_pass'),
          idx_src_port: headers.indexOf('src_port'),
          idx_dst_port: headers.indexOf('dst_port'),
          idx_src_ssl: headers.indexOf('src_ssl'),
          idx_dst_ssl: headers.indexOf('dst_ssl'),
          idx_src_auth: headers.indexOf('src_auth'),
          idx_dst_auth: headers.indexOf('dst_auth')
        };
        
        resolve(indices);
      });
  });
}

// Parse CSV file and return configurations
async function parseCsv(csvFile) {
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

// Run multiple syncs in parallel
async function runParallel(configs, options, maxJobs) {
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
    const job = runOne(config, options);
    running.push(job);
  }

  // Wait for remaining jobs
  const remaining = await Promise.all(running);
  results.push(...remaining);

  return results;
}

// Main sync function
export async function imapSync(options) {
  console.log(chalk.green('=== IMAP Email Synchronization ==='));

  const csvFile = options.csv || 'input/example.csv';
  const jobs = parseInt(options.jobs) || 1;

  // Check if CSV file exists
  if (!await fs.pathExists(csvFile)) {
    throw new Error(`CSV file not found: ${csvFile}`);
  }

  console.log(chalk.blue(`Reading configuration from: ${csvFile}`));

  // Check if imapsync is available (unless using Docker)
  if (!options.docker) {
    const hasImapsync = await haveImapsync();
    if (!hasImapsync) {
      console.log(chalk.yellow('imapsync not found locally. Consider using --docker option.'));
      console.log(chalk.yellow('Continuing with Docker mode...'));
      options.docker = true;
    }
  }

  // Parse CSV
  const configs = await parseCsv(csvFile);
  
  if (configs.length === 0) {
    throw new Error('No configurations found in CSV file');
  }

  console.log(chalk.blue(`Found ${configs.length} configuration(s)`));

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
      const result = await runOne(config, options);
      results.push(result);
    }
  } else {
    // Parallel processing
    console.log(chalk.blue(`Running synchronizations with ${jobs} parallel jobs...`));
    results = await runParallel(configs, options, jobs);
  }

  // Summary
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
}
