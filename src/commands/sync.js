import {Command, Flags} from '@oclif/core'
import { ImapService } from '../services/imap/sync.service.js'

export default class Sync extends Command {
  static description = 'Sync emails between IMAP servers'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --csv input/my-migration.csv',
    '<%= config.bin %> <%= command.id %> --dry-run --jobs 4',
    '<%= config.bin %> <%= command.id %> --docker --log-dir ./logs/sync',
  ]

  static flags = {
    csv: Flags.string({
      char: 'c',
      description: 'CSV file containing sync configurations',
      default: 'input/example.csv',
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
      default: './results',
    }),
    'dry-run': Flags.boolean({
      description: 'Show what would be synced without actually syncing',
    }),
  }

  async run() {
    const {flags} = await this.parse(Sync)

    try {
      const imapService = new ImapService()
      
      // Map flags to options format expected by the service
      const options = {
        csv: flags.csv,
        jobs: flags.jobs,
        docker: flags.docker,
        logDir: flags['log-dir'],
        dryRun: flags['dry-run'],
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
