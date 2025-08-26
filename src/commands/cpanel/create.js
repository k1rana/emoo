import { Command, Flags } from '@oclif/core'
import chalk from 'chalk'
import csvParser from 'csv-parser'
import { createObjectCsvWriter } from 'csv-writer'
import fs from 'fs'
import inquirer from 'inquirer'
import ora from 'ora'
import { CpanelService, setDebugLevel as setCpanelDebugLevel } from '../../services/cpanel/auth.service.js'
import { DomainService, setDebugLevel as setDomainDebugLevel } from '../../services/cpanel/domain.service.js'
import { EmailService, setDebugLevel as setEmailDebugLevel } from '../../services/cpanel/email.service.js'
import { UtilService } from '../../services/shared/util.service.js'

export default class CpanelCreate extends Command {
  static description = 'Create cPanel email accounts in bulk'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --csv input/batch-create-example.csv',
    '<%= config.bin %> <%= command.id %> --server cpanel.example.com --username admin --api-key your-key',
  ]

  static flags = {
    server: Flags.string({
      char: 's',
      description: 'cPanel server domain/IP (with optional port)',
    }),
    username: Flags.string({
      char: 'u',
      description: 'cPanel username',
    }),
    'api-key': Flags.string({
      char: 'k',
      description: 'cPanel API key',
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
      default: '1024',
    }),
    output: Flags.string({
      char: 'o',
      description: 'Output CSV file path',
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

          quota = row.quota ? parseInt(row.quota) : 1024
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
    const { csvFile } = await inquirer.prompt([
      {
        type: 'input',
        name: 'csvFile',
        message: 'Enter path to CSV file:',
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

  async run() {
    const {flags} = await this.parse(CpanelCreate)

    try {
      UtilService.printColor('green', '=== cPanel Batch Email Creation ===')

      // Set debug levels
      const debugLevel = flags.debug ? 1 : 0
      setCpanelDebugLevel(debugLevel)
      setDomainDebugLevel(debugLevel)
      setEmailDebugLevel(debugLevel)

      // Step 1: Get credentials
      const credentials = await UtilService.getInteractiveInput({
        server: flags.server,
        username: flags.username,
        apiKey: flags['api-key']
      })

      // Step 2: Initialize services
      const cpanelService = new CpanelService(credentials.server, credentials.username, credentials.apiKey)
      const domainService = new DomainService(cpanelService)
      const emailService = new EmailService(cpanelService)

      // Step 3: Validate connection
      await cpanelService.validateConnection()

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
      const availableDomains = await domainService.getDomains()
      const emailDomains = [...new Set(emails.map(e => e.domain))]
      const invalidDomains = emailDomains.filter(d => !availableDomains.includes(d))
      
      if (invalidDomains.length > 0) {
        throw new Error(`These domains are not available in your cPanel: ${invalidDomains.join(', ')}`)
      }

      // Step 6: Get password preference and quota
      const { useRandom, password: defaultPassword } = await UtilService.getPasswordPreference({
        password: flags.password
      })

      const defaultQuota = parseInt(flags.quota)

      // Step 7: Get CSV filename
      const csvFile = await UtilService.getCSVFilename({ output: flags.output }, 'batch_create')
      await UtilService.ensureResultsDir(csvFile)

      // Step 8: Confirm action
      const proceed = await UtilService.confirmAction('Continue with email account creation?')
      if (!proceed) {
        UtilService.printColor('yellow', 'Operation cancelled.')
        return
      }

      // Step 9: Process creation
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

      const results = []
      const totalEmails = emails.length
      let processedEmails = 0

      const mainSpinner = ora(`Starting email creation process (0/${totalEmails} emails processed)`).start()

      for (const emailInfo of emails) {
        const password = useRandom ? UtilService.generatePassword(12) : defaultPassword
        const quota = emailInfo.quota || defaultQuota

        processedEmails++
        mainSpinner.text = `Creating account: ${emailInfo.email} (${processedEmails}/${totalEmails})`

        try {
          const success = await emailService.createAccount(emailInfo.username, emailInfo.domain, password, quota)

          results.push({
            email: emailInfo.email,
            username: emailInfo.username,
            domain: emailInfo.domain,
            password: password,
            quota: quota,
            createStatus: success ? 'SUCCESS' : 'FAILED',
            timestamp: new Date().toISOString()
          })
        } catch (error) {
          results.push({
            email: emailInfo.email,
            username: emailInfo.username,
            domain: emailInfo.domain,
            password: password,
            quota: quota,
            createStatus: 'FAILED',
            timestamp: new Date().toISOString()
          })
        }
      }

      mainSpinner.succeed(`Email creation process completed (${processedEmails}/${totalEmails} emails processed)`)

      // Save results
      const csvSpinner = ora('Saving results to CSV file...').start()
      try {
        await csvWriter.writeRecords(results)
        csvSpinner.succeed(`Results saved to: ${csvFile}`)
      } catch (error) {
        csvSpinner.fail('Failed to save results to CSV')
        throw error
      }

      // Show summary
      const successCount = results.filter(r => r.createStatus === 'SUCCESS').length
      const failedCount = results.filter(r => r.createStatus === 'FAILED').length

      console.log('')
      UtilService.printColor('green', '=== Process Complete ===')
      UtilService.printColor('green', `\nSummary:`)
      UtilService.printColor('green', `  ✅ Successful creations: ${successCount}`)
      
      if (failedCount > 0) {
        UtilService.printColor('red', `  ❌ Failed creations: ${failedCount}`)
      }

      if (useRandom && successCount > 0) {
        UtilService.printColor('yellow', '  📝 Random passwords generated - check CSV file for details')
      }

      UtilService.printColor('cyan', '\nThank you for using emoo! 🐄')

    } catch (error) {
      this.error(error.message)
    }
  }
}
