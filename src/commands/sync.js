import { Command, Flags } from '@oclif/core'
import fs from 'fs-extra'
import inquirer from 'inquirer'
import path from 'path'
import { ImapService } from '../services/imap/sync.service.js'

export default class Sync extends Command {
  static description = 'Sync emails between IMAP servers'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --csv input/my-migration.csv',
    '<%= config.bin %> <%= command.id %> --dry-run --jobs 4',
    '<%= config.bin %> <%= command.id %> --docker --log-dir ./results/sync-log',
    '<%= config.bin %> <%= command.id %> --debug --jobs 2',
  ]

  static flags = {
    csv: Flags.string({
      char: 'c',
      description: 'CSV file containing sync configurations (will prompt if not provided)',
    }),
    jobs: Flags.string({
      char: 'j',
      description: 'Number of parallel jobs',
      default: '1',
    }),
    docker: Flags.boolean({
      description: 'Use Docker for imapsync',
    }),
    'log-dir': Flags.string({
      description: 'Log directory',
      default: './results/sync-log',
    }),
    'dry-run': Flags.boolean({
      description: 'Show what would be synced without actually syncing',
    }),
    debug: Flags.boolean({
      description: 'Show detailed imapsync output and commands',
    }),
  }

  async promptForCsvFile() {
    // Get available CSV files from input/sync directory
    const syncDir = path.join(process.cwd(), 'input', 'sync')
    const inputDir = path.join(process.cwd(), 'input')
    const choices = []

    try {
      // Add files from input/sync/ directory
      if (await fs.pathExists(syncDir)) {
        const syncFiles = await fs.readdir(syncDir)
        const csvFiles = syncFiles.filter(file => file.endsWith('.csv'))
        csvFiles.forEach(file => {
          choices.push({
            name: `input/sync/${file}`,
            value: `input/sync/${file}`,
            short: file
          })
        })
      }

      // Add some files from input/ directory that are sync-related
      if (await fs.pathExists(inputDir)) {
        const inputFiles = await fs.readdir(inputDir)
        const syncRelatedFiles = inputFiles.filter(file => 
          file.endsWith('.csv') && 
          (file.includes('sync') || file.includes('imap'))
        )
        syncRelatedFiles.forEach(file => {
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
            default: 'input/sync/example.csv',
            validate: input => input.trim().length > 0 ? true : 'Please enter a file path'
          }
        ])
        return customPath
      }

      const { selectedFile } = await inquirer.prompt([
        {
          type: 'list',
          name: 'selectedFile',
          message: 'Select CSV file for sync configuration:',
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
            default: 'input/sync/example.csv',
            validate: input => input.trim().length > 0 ? true : 'Please enter a file path'
          }
        ])
        return customPath
      }

      return selectedFile
    } catch (error) {
      this.log('Error reading input directories, please enter file path manually:')
      const { customPath } = await inquirer.prompt([
        {
          type: 'input',
          name: 'customPath',
          message: 'Enter CSV file path:',
          default: 'input/sync/example.csv',
          validate: input => input.trim().length > 0 ? true : 'Please enter a file path'
        }
      ])
      return customPath
    }
  }

  async run() {
    const {flags} = await this.parse(Sync)

    try {
      // If CSV flag is not provided, prompt user for CSV file
      let csvFile = flags.csv
      if (!csvFile) {
        this.log('No CSV file specified, please select one:')
        csvFile = await this.promptForCsvFile()
      }

      // Validate that the file exists
      if (!await fs.pathExists(csvFile)) {
        this.error(`CSV file not found: ${csvFile}`)
      }

      const imapService = new ImapService()
      
      // Map flags to options format expected by the service
      const options = {
        csv: csvFile,
        jobs: flags.jobs,
        docker: flags.docker,
        logDir: flags['log-dir'],
        dryRun: flags['dry-run'],
        debug: flags.debug,
      }

      const summary = await imapService.sync(options)
      
      // Exit with error code if any operations failed
      if (summary.failed > 0 && !summary.dryRun) {
        process.exit(1)
      }
    } catch (error) {
      this.error(error.message)
    }
  }
}
