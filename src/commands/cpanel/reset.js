import {Command, Flags} from '@oclif/core'
import { CpanelService } from '../../services/cpanel/auth.service.js'
import { DomainService, setDebugLevel as setDomainDebugLevel } from '../../services/cpanel/domain.service.js'
import { EmailService, setDebugLevel as setEmailDebugLevel } from '../../services/cpanel/email.service.js'
import { UtilService } from '../../services/shared/util.service.js'
import { setDebugLevel as setCpanelDebugLevel } from '../../services/cpanel/auth.service.js'
import { createObjectCsvWriter } from 'csv-writer'
import ora from 'ora'

export default class CpanelReset extends Command {
  static description = 'Reset passwords for cPanel email accounts in bulk'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --server cpanel.example.com --username admin --api-key your-key',
    '<%= config.bin %> <%= command.id %> --password newpass123 --output ./results/reset.csv',
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

      // Step 4: Get domains and select
      const domainsWithEmails = await domainService.getDomainsWithEmails()
      
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

      // Step 6: Get CSV filename
      const csvFile = await UtilService.getCSVFilename({ output: flags.output }, 'password_reset')
      
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

      // Step 8: Process reset
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

      const results = []
      let totalEmails = 0
      let processedEmails = 0

      // Calculate total emails
      for (const domain of selectedDomains) {
        const emailAccounts = await domainService.getEmailAccounts(domain)
        totalEmails += emailAccounts.length
      }

      const mainSpinner = ora(`Starting password reset process (0/${totalEmails} emails processed)`).start()

      // Process each domain
      for (const domain of selectedDomains) {
        mainSpinner.text = `Processing domain: ${domain}`
        const emailAccounts = await domainService.getEmailAccounts(domain)

        for (const emailUser of emailAccounts) {
          const password = useRandom ? UtilService.generatePassword(12) : newPassword
          const fullEmail = `${emailUser}@${domain}`

          processedEmails++
          mainSpinner.text = `Resetting password for: ${fullEmail} (${processedEmails}/${totalEmails})`

          try {
            const success = await emailService.resetPassword(emailUser, domain, password)

            results.push({
              domain,
              email: fullEmail,
              oldPasswordStatus: 'N/A',
              newPassword: password,
              resetStatus: success ? 'SUCCESS' : 'FAILED',
              timestamp: new Date().toISOString()
            })
          } catch (error) {
            results.push({
              domain,
              email: fullEmail,
              oldPasswordStatus: 'N/A',
              newPassword: password,
              resetStatus: 'FAILED',
              timestamp: new Date().toISOString()
            })
          }
        }
      }

      mainSpinner.succeed(`Password reset process completed (${processedEmails}/${totalEmails} emails processed)`)

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
      const successCount = results.filter(r => r.resetStatus === 'SUCCESS').length
      const failedCount = results.filter(r => r.resetStatus === 'FAILED').length

      console.log('')
      UtilService.printColor('green', '=== Process Complete ===')
      UtilService.printColor('green', `\nSummary:`)
      UtilService.printColor('green', `  ✅ Successful resets: ${successCount}`)
      
      if (failedCount > 0) {
        UtilService.printColor('red', `  ❌ Failed resets: ${failedCount}`)
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
