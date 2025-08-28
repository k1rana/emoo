import { Command, Flags } from '@oclif/core'
import { createObjectCsvWriter } from 'csv-writer'
import ora from 'ora'
import { CpanelService, setDebugLevel as setCpanelDebugLevel } from '../../services/cpanel/auth.service.js'
import { DomainService, setDebugLevel as setDomainDebugLevel } from '../../services/cpanel/domain.service.js'
import { EmailService, setDebugLevel as setEmailDebugLevel } from '../../services/cpanel/email.service.js'
import { ParallelService } from '../../services/shared/parallel.service.js'
import { UtilService } from '../../services/shared/util.service.js'

export default class CpanelReset extends Command {
  static description = 'Reset passwords for cPanel email accounts in bulk'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --server cpanel.example.com --username admin --api-key your-key',
    '<%= config.bin %> <%= command.id %> --password newpass123 --output ./results/reset.csv',
    '<%= config.bin %> <%= command.id %> --parallel 5 --debug',
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
      description: 'New password for all accounts (leave empty for random)',
    }),
    output: Flags.string({
      char: 'o',
      description: 'Output CSV file path',
    }),
    regex: Flags.string({
      description: 'Filter emails using regex pattern',
    }),
    parallel: Flags.string({
      char: 'j',
      description: 'Number of parallel jobs for password reset',
      default: '3',
    }),
    debug: Flags.boolean({
      description: 'Enable debug mode',
    }),
  }

  async run() {
    const {flags} = await this.parse(CpanelReset)

    try {
      UtilService.printColor('green', '=== cPanel Bulk Email Password Reset ===')

      // Set debug levels for all services
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

      // Step 4: Get domains and select (with parallel scanning)
      const domainsWithEmails = await domainService.getDomainsWithEmailsParallel(parseInt(flags.parallel, 10))
      
      if (domainsWithEmails.length === 0) {
        throw new Error('No domains with email accounts found!')
      }

      UtilService.printColor('green', `Found ${domainsWithEmails.length} domains with email accounts:`)
      domainsWithEmails.forEach(item => {
        UtilService.printColor('cyan', `  - ${item.domain} (${item.emailCount} emails)`)
      })

      const selectedDomains = await domainService.selectDomains(domainsWithEmails)

      if (selectedDomains.length === 0) {
        UtilService.printColor('yellow', 'No domains selected. Exiting.')
        return
      }

      // Step 5: Get password preference
      const { useRandom, password: newPassword } = await UtilService.getPasswordPreference({
        password: flags.password
      })

      // Step 6: Get CSV filename with domain, action and Unix timestamp
      const generateDefaultFilename = (domains, action = 'email_pass_reset') => {
        const timestamp = Math.floor(Date.now() / 1000) // Unix timestamp
        const domainList = domains.length === 1 
          ? domains[0] 
          : domains.length <= 3 
            ? domains.join('-') 
            : `${domains.length}domains`
        
        // Sanitize domain names for filename
        const sanitizedDomain = domainList.replace(/[^a-zA-Z0-9-_.]/g, '_')
        
        return `${sanitizedDomain}_${action}_${timestamp}.csv`
      }

      const csvFile = flags.output || await UtilService.getCSVFilenameWithCustomDefault(
        { output: flags.output }, 
        generateDefaultFilename(selectedDomains, 'email_pass_reset')
      )
      
      // Ensure results directory exists
      const dirSpinner = ora('Preparing results directory...').start()
      try {
        await UtilService.ensureResultsDir(csvFile)
        dirSpinner.succeed(`Results will be saved to: ${csvFile}`)
      } catch (error) {
        dirSpinner.fail('Failed to create results directory')
        throw error
      }

      // Step 7: Confirm action
      const proceed = await UtilService.confirmAction('Continue with password reset?')
      if (!proceed) {
        UtilService.printColor('yellow', 'Operation cancelled.')
        return
      }

      // Step 8: Process reset with enhanced parallel processing
      const csvWriter = createObjectCsvWriter({
        path: csvFile,
        header: [
          { id: 'domain', title: 'Domain' },
          { id: 'email', title: 'Email' },
          { id: 'oldPasswordStatus', title: 'Old_Password_Status' },
          { id: 'newPassword', title: 'New_Password' },
          { id: 'resetStatus', title: 'Reset_Status' },
          { id: 'timestamp', title: 'Timestamp' }
        ]
      })

      const parallelJobs = parseInt(flags.parallel, 10)
      const parallelService = new ParallelService({
        concurrency: parallelJobs,
        exitOnError: false,
        debug: flags.debug
      })

      // Scan function to get email accounts for each domain
      const scanDomainForEmails = async (domain) => {
        const emails = await domainService.getEmailAccounts(domain)
        return { domain, emails, count: emails.length }
      }

      // Process function to reset password for each email
      const resetPasswordForEmail = async (emailData) => {
        const { domain, emailUser } = emailData
        const password = useRandom ? UtilService.generatePassword(12) : newPassword
        const fullEmail = `${emailUser}@${domain}`

        try {
          const success = await emailService.resetPassword(emailUser, domain, password)
          return {
            domain,
            email: fullEmail,
            oldPasswordStatus: 'N/A',
            newPassword: password,
            resetStatus: success ? 'SUCCESS' : 'FAILED',
            timestamp: new Date().toISOString()
          }
        } catch (error) {
          return {
            domain,
            email: fullEmail,
            oldPasswordStatus: 'N/A',
            newPassword: password,
            resetStatus: 'FAILED',
            timestamp: new Date().toISOString(),
            error: error.message
          }
        }
      }

      // Extract email items from scan results
      const extractEmailsFromScanResult = (domain, scanResult) => {
        if (scanResult.error || !scanResult.emails) {
          return []
        }
        return scanResult.emails.map(emailUser => ({ domain, emailUser }))
      }

      // Execute the parallel workflow
      const workflowResults = await parallelService.createScanAndProcessWorkflow(
        selectedDomains,
        scanDomainForEmails,
        resetPasswordForEmail,
        {
          concurrency: parallelJobs,
          scanTitle: 'Scanning domains for email accounts',
          processTitle: 'Resetting email passwords',
          extractItemsFromScanResult: extractEmailsFromScanResult,
          getTitleForProcess: (emailData) => `Reset ${emailData.emailUser}@${emailData.domain}`,
          progressCallback: (result, index, total) => {
            if (flags.debug) {
              const status = result.resetStatus === 'SUCCESS' ? '✅' : '❌'
              console.log(`${status} ${result.email} (${index + 1}/${total})`)
            }
          }
        }
      )

      const results = workflowResults.processResults || []

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
      UtilService.printColor('green', `  ✅ Successful resets: ${summary.successful}`)
      
      if (summary.failed > 0) {
        UtilService.printColor('red', `  ❌ Failed resets: ${summary.failed}`)
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
