import { Command, Flags } from '@oclif/core'
import chalk from 'chalk'
import csvParser from 'csv-parser'
import { createObjectCsvWriter } from 'csv-writer'
import fs from 'fs'
import fsExtra from 'fs-extra'
import inquirer from 'inquirer'
import ora from 'ora'
import path from 'path'
import { AapanelService, setDebugLevel as setAapanelDebugLevel } from '../../services/aapanel/auth.service.js'
import { DomainService, setDebugLevel as setDomainDebugLevel } from '../../services/aapanel/domain.service.js'
import { EmailService, setDebugLevel as setEmailDebugLevel } from '../../services/aapanel/email.service.js'
import { ParallelService } from '../../services/shared/parallel.service.js'
import { UtilService } from '../../services/shared/util.service.js'

export default class AapanelCreate extends Command {
  static description = 'Create aaPanel email accounts in bulk'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --csv input/batch-create-example.csv',
    '<%= config.bin %> <%= command.id %> --server https://145.79.12.148:27208 --api-key your-key',
    '<%= config.bin %> <%= command.id %> --parallel 5 --debug',
  ]

  static flags = {
    server: Flags.string({
      char: 's',
      description: 'aaPanel server URL (with protocol and port)',
    }),
    'api-key': Flags.string({
      char: 'k',
      description: 'aaPanel API secret key',
    }),
    password: Flags.string({
      char: 'p',
      description: 'Password for all accounts (leave empty for random)',
    }),
    csv: Flags.string({
      char: 'c',
      description: 'CSV file containing email accounts to create',
    }),
    quota: Flags.string({
      char: 'q',
      description: 'Quota for email accounts in MB',
      default: '2048',
    }),
    output: Flags.string({
      char: 'o',
      description: 'Output CSV file path',
    }),
    parallel: Flags.string({
      char: 'j',
      description: 'Number of parallel jobs for account creation',
      default: '3',
    }),
    debug: Flags.boolean({
      description: 'Enable debug mode',
    }),
  }

  async getEmailInputMethod() {
    const { inputMethod } = await inquirer.prompt([
      {
        type: 'list',
        name: 'inputMethod',
        message: 'How do you want to provide email accounts to create?',
        choices: [
          { name: 'Manual input (type email accounts)', value: 'manual' },
          { name: 'CSV file input', value: 'csv' }
        ]
      }
    ])

    return inputMethod
  }

  async getManualEmailInput() {
    const emails = []
    
    console.log(chalk.cyan('\n=== Manual Email Input ==='))
    console.log(chalk.yellow('Enter email accounts to create (one by one). Press Enter with empty input to finish.'))
    
    while (true) {
      const { email } = await inquirer.prompt([
        {
          type: 'input',
          name: 'email',
          message: `Enter email ${emails.length + 1} (or press Enter to finish):`,
          validate: (input) => {
            if (!input.trim()) {
              return true
            }
            
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
            if (!emailRegex.test(input)) {
              return 'Please enter a valid email address'
            }
            
            if (emails.some(e => e.email === input.trim())) {
              return 'This email is already in the list'
            }
            
            return true
          }
        }
      ])

      if (!email.trim()) {
        break
      }

      const [username, domain] = email.trim().split('@')
      emails.push({ email: email.trim(), username, domain })
      
      UtilService.printColor('green', `✓ Added: ${email}`)
    }

    if (emails.length === 0) {
      throw new Error('No email accounts provided!')
    }

    return emails
  }

  async parseEmailCSV(csvFile) {
    return new Promise((resolve, reject) => {
      const emails = []
      const errors = []

      fs.createReadStream(csvFile)
        .pipe(csvParser())
        .on('data', (row) => {
          let email, username, domain, quota

          if (row.email) {
            email = row.email.trim()
            const parts = email.split('@')
            if (parts.length !== 2) {
              errors.push(`Invalid email format: ${email}`)
              return
            }
            username = parts[0]
            domain = parts[1]
          } else if (row.username && row.domain) {
            username = row.username.trim()
            domain = row.domain.trim()
            email = `${username}@${domain}`
          } else {
            errors.push(`Missing required columns: either 'email' or 'username,domain'`)
            return
          }

          quota = row.quota ? parseInt(row.quota) : 2048
          emails.push({ email, username, domain, quota })
        })
        .on('end', () => {
          if (errors.length > 0) {
            reject(new Error(`CSV parsing errors:\n${errors.join('\n')}`))
          } else {
            resolve(emails)
          }
        })
        .on('error', reject)
    })
  }

  async getCSVEmailInput() {
    // Get available CSV files from input directory and subdirectories
    const inputDir = path.join(process.cwd(), 'input')
    const createDir = path.join(inputDir, 'create')
    const choices = []
    let csvFile

    try {
      // Add files from input/create/ directory (most relevant for email creation)
      if (await fsExtra.pathExists(createDir)) {
        const createFiles = await fsExtra.readdir(createDir)
        const csvFiles = createFiles.filter(file => file.endsWith('.csv'))
        csvFiles.forEach(file => {
          choices.push({
            name: `input/create/${file}`,
            value: `input/create/${file}`,
            short: file
          })
        })
      }

      // Add files from main input/ directory
      if (await fsExtra.pathExists(inputDir)) {
        const inputFiles = await fsExtra.readdir(inputDir)
        const csvFiles = inputFiles.filter(file => 
          file.endsWith('.csv') && 
          (file.includes('create') || file.includes('batch') || file.includes('email'))
        )
        csvFiles.forEach(file => {
          choices.push({
            name: `input/${file}`,
            value: `input/${file}`,
            short: file
          })
        })
      }

      // Add option to specify custom path
      choices.push({
        name: 'Enter custom file path',
        value: 'custom',
        short: 'custom'
      })

      if (choices.length === 1) {
        // Only custom option available
        const { customPath } = await inquirer.prompt([
          {
            type: 'input',
            name: 'customPath',
            message: 'Enter CSV file path:',
            default: 'input/create/example.csv',
            validate: (input) => {
              if (!input.trim()) {
                return 'CSV file path cannot be empty'
              }
              
              if (!fs.existsSync(input.trim())) {
                return 'File does not exist'
              }
              
              return true
            }
          }
        ])
        csvFile = customPath
      } else {
        const { selectedFile } = await inquirer.prompt([
          {
            type: 'list',
            name: 'selectedFile',
            message: 'Select CSV file for email creation:',
            choices: choices,
            pageSize: 10
          }
        ])

        if (selectedFile === 'custom') {
          const { customPath } = await inquirer.prompt([
            {
              type: 'input',
              name: 'customPath',
              message: 'Enter CSV file path:',
              default: 'input/create/example.csv',
              validate: (input) => {
                if (!input.trim()) {
                  return 'CSV file path cannot be empty'
                }
                
                if (!fs.existsSync(input.trim())) {
                  return 'File does not exist'
                }
                
                return true
              }
            }
          ])
          csvFile = customPath
        } else {
          csvFile = selectedFile
        }
      }
    } catch (error) {
      // Fallback to manual input if directory scanning fails
      const { customPath } = await inquirer.prompt([
        {
          type: 'input',
          name: 'customPath',
          message: 'Enter CSV file path:',
          default: 'input/create/example.csv',
          validate: (input) => {
            if (!input.trim()) {
              return 'CSV file path cannot be empty'
            }
            
            if (!fs.existsSync(input.trim())) {
              return 'File does not exist'
            }
            
            return true
          }
        }
      ])
      csvFile = customPath
    }

    const spinner = ora('Parsing CSV file...').start()
    
    try {
      const emails = await this.parseEmailCSV(csvFile)
      spinner.succeed(`Parsed ${emails.length} email accounts from CSV`)
      return emails
    } catch (error) {
      spinner.fail('Failed to parse CSV file')
      throw error
    }
  }

  async getAapanelCredentials(options) {
    const questions = [];

    // Server input
    if (!options.server) {
      questions.push({
        type: 'input',
        name: 'server',
        message: 'Enter aaPanel server URL (with protocol and port):',
        default: 'https://your-server.com:27208',
        validate: (input) => {
          if (!input.trim()) {
            return 'Server URL cannot be empty';
          }
          return true;
        }
      });
    }

    // API Key input
    if (!options.apiKey) {
      questions.push({
        type: 'password',
        name: 'apiKey',
        message: 'Enter aaPanel API Secret Key:',
        mask: '*',
        validate: (input) => {
          if (!input.trim()) {
            return 'API Secret Key cannot be empty';
          }
          return true;
        }
      });
    }

    const answers = await inquirer.prompt(questions);

    return {
      server: options.server || answers.server,
      apiKey: options.apiKey || answers.apiKey
    };
  }

  async run() {
    const {flags} = await this.parse(AapanelCreate)

    try {
      UtilService.printColor('green', '=== aaPanel Batch Email Creation ===')

      // Set debug levels
      const debugLevel = flags.debug ? 1 : 0
      setAapanelDebugLevel(debugLevel)
      setDomainDebugLevel(debugLevel)
      setEmailDebugLevel(debugLevel)

      // Step 1: Get credentials
      const credentials = await this.getAapanelCredentials({
        server: flags.server,
        apiKey: flags['api-key']
      })

      // Step 2: Initialize services
      const aapanelService = new AapanelService(credentials.server, credentials.apiKey)
      const domainService = new DomainService(aapanelService)
      const emailService = new EmailService(aapanelService)

      // Step 3: Validate connection
      await aapanelService.validateConnection()

      // Step 4: Get email accounts to create
      let emails

      if (flags.csv) {
        const spinner = ora('Parsing CSV file...').start()
        try {
          emails = await this.parseEmailCSV(flags.csv)
          spinner.succeed(`Parsed ${emails.length} email accounts from CSV`)
        } catch (error) {
          spinner.fail('Failed to parse CSV file')
          throw error
        }
      } else {
        const inputMethod = await this.getEmailInputMethod()
        
        if (inputMethod === 'csv') {
          emails = await this.getCSVEmailInput()
        } else {
          emails = await this.getManualEmailInput()
        }
      }

      UtilService.printColor('green', `\nFound ${emails.length} email accounts to create:`)
      emails.forEach((emailInfo, index) => {
        UtilService.printColor('cyan', `  ${index + 1}. ${emailInfo.email}`)
      })

      // Step 5: Validate domains
      const availableDomains = await domainService.getAllDomains()
      const emailDomains = [...new Set(emails.map(e => e.domain))]
      const invalidDomains = emailDomains.filter(d => !availableDomains.includes(d))
      
      if (invalidDomains.length > 0) {
        throw new Error(`These domains are not available in your aaPanel: ${invalidDomains.join(', ')}`)
      }

      // Step 6: Get password preference and quota
      const { useRandom, password: defaultPassword } = await UtilService.getPasswordPreference({
        password: flags.password
      })

      const defaultQuota = parseInt(flags.quota)

      // Step 7: Get CSV filename with domains, action and Unix timestamp
      const generateDefaultFilename = (emails, action = 'batch_create') => {
        const timestamp = Math.floor(Date.now() / 1000) // Unix timestamp
        const uniqueDomains = [...new Set(emails.map(e => e.domain))]
        const domainList = uniqueDomains.length === 1 
          ? uniqueDomains[0] 
          : uniqueDomains.length <= 3 
            ? uniqueDomains.join('-') 
            : `${uniqueDomains.length}domains`
        
        // Sanitize domain names for filename
        const sanitizedDomain = domainList.replace(/[^a-zA-Z0-9-_.]/g, '_')
        
        return `${sanitizedDomain}_aapanel_${action}_${timestamp}.csv`
      }

      const csvFile = flags.output || await UtilService.getCSVFilenameWithCustomDefault(
        { output: flags.output }, 
        generateDefaultFilename(emails, 'batch_create')
      )
      await UtilService.ensureResultsDir(csvFile)

      // Step 8: Confirm action
      const proceed = await UtilService.confirmAction('Continue with email account creation?')
      if (!proceed) {
        UtilService.printColor('yellow', 'Operation cancelled.')
        return
      }

      // Step 9: Process creation with parallel processing
      const csvWriter = createObjectCsvWriter({
        path: csvFile,
        header: [
          { id: 'email', title: 'Email' },
          { id: 'username', title: 'Username' },
          { id: 'domain', title: 'Domain' },
          { id: 'password', title: 'Password' },
          { id: 'quota', title: 'Quota_MB' },
          { id: 'createStatus', title: 'Create_Status' },
          { id: 'timestamp', title: 'Timestamp' }
        ]
      })

      const parallelJobs = parseInt(flags.parallel, 10)
      const parallelService = new ParallelService({
        concurrency: parallelJobs,
        exitOnError: false,
        debug: flags.debug
      })

      // Process function to create email accounts
      const createEmailAccount = async (emailInfo, index) => {
        const password = useRandom ? UtilService.generatePassword(12) : defaultPassword
        const quota = emailInfo.quota || defaultQuota

        try {
          const success = await emailService.createAccount(emailInfo.username, emailInfo.domain, password, quota)
          
          return {
            email: emailInfo.email,
            username: emailInfo.username,
            domain: emailInfo.domain,
            password: password,
            quota: quota,
            createStatus: success ? 'SUCCESS' : 'FAILED',
            timestamp: new Date().toISOString()
          }
        } catch (error) {
          return {
            email: emailInfo.email,
            username: emailInfo.username,
            domain: emailInfo.domain,
            password: password,
            quota: quota,
            createStatus: 'FAILED',
            timestamp: new Date().toISOString(),
            error: error.message
          }
        }
      }

      // Execute parallel email creation
      const processResults = await parallelService.createProcessTasks(
        emails,
        createEmailAccount,
        {
          concurrency: parallelJobs,
          title: 'Creating email accounts in parallel',
          getTitleFor: (emailInfo) => `Create ${emailInfo.email}`,
          progressCallback: (result, index, total) => {
            if (flags.debug) {
              const status = result.createStatus === 'SUCCESS' ? '✅' : '❌'
              console.log(`${status} ${result.email} (${index + 1}/${total})`)
            }
          }
        }
      )

      const results = processResults.processResults || []

      // Save results
      const csvSpinner = ora('Saving results to CSV file...').start()
      try {
        await csvWriter.writeRecords(results)
        csvSpinner.succeed(`Results saved to: ${csvFile}`)
      } catch (error) {
        csvSpinner.fail('Failed to save results to CSV')
        throw error
      }

      // Generate and show summary using parallel service
      const summary = parallelService.generateSummary(results, { printSummary: false })

      console.log('')
      UtilService.printColor('green', '=== Process Complete ===')
      UtilService.printColor('green', `\nSummary:`)
      UtilService.printColor('green', `  📊 Total emails processed: ${summary.total}`)
      UtilService.printColor('green', `  ✅ Successful creations: ${summary.successful}`)
      
      if (summary.failed > 0) {
        UtilService.printColor('red', `  ❌ Failed creations: ${summary.failed}`)
      }

      if (summary.skipped > 0) {
        UtilService.printColor('yellow', `  ⏭️  Skipped: ${summary.skipped}`)
      }

      if (useRandom && summary.successful > 0) {
        UtilService.printColor('yellow', '  📝 Random passwords generated - check CSV file for details')
      }

      if (parallelJobs > 1) {
        UtilService.printColor('cyan', `  🚀 Processed with ${parallelJobs} parallel jobs`)
      }

      UtilService.printColor('cyan', '\nThank you for using emoo! 🐄')

    } catch (error) {
      this.error(error.message)
    }
  }
}
