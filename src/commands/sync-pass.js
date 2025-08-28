import { Command, Flags } from '@oclif/core'
import csv from 'csv-parser'
import { createObjectCsvWriter } from 'csv-writer'
import fs from 'fs-extra'
import inquirer from 'inquirer'
import path from 'path'

export default class SyncPass extends Command {
  static description = 'Sync passwords from reset/create results to imapsync configuration'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --reset-file results/reset.csv --imapsync-file input/sync/migration.csv',
    '<%= config.bin %> <%= command.id %> --target dst --output input/sync/updated-migration.csv',
    '<%= config.bin %> <%= command.id %> --create-new --target src',
    '<%= config.bin %> <%= command.id %> --include-failed --target dst',
  ]

  static flags = {
    'reset-file': Flags.string({
      char: 'r',
      description: 'Password reset/create results CSV file (will prompt if not provided)',
    }),
    'imapsync-file': Flags.string({
      char: 'i',
      description: 'ImapSync configuration CSV file (will prompt if not provided)',
    }),
    target: Flags.string({
      char: 't',
      description: 'Target field to update (src or dst)',
      options: ['src', 'dst'],
    }),
    output: Flags.string({
      char: 'o',
      description: 'Output CSV file path (will prompt if not provided)',
    }),
    'create-new': Flags.boolean({
      description: 'Create new imapsync file instead of updating existing',
    }),
    'include-failed': Flags.boolean({
      description: 'Include failed password resets/creates in the output (default: false)',
      default: false,
    }),
    debug: Flags.boolean({
      description: 'Show detailed debug information',
    }),
  }

  // Helper function to detect file type and normalize data
  normalizeResultData(rawData) {
    if (rawData.length === 0) return { data: [], type: 'unknown' }

    const firstRow = rawData[0]
    
    // Check if it's a reset results file
    if (firstRow.hasOwnProperty('Reset_Status') && firstRow.hasOwnProperty('New_Password')) {
      return {
        data: rawData.map(record => ({
          Email: record.Email,
          Password: record.New_Password,
          Status: record.Reset_Status,
          isSuccess: record.Reset_Status === 'SUCCESS'
        })),
        type: 'reset'
      }
    }
    
    // Check if it's a create results file
    if (firstRow.hasOwnProperty('Create_Status') && firstRow.hasOwnProperty('Password')) {
      return {
        data: rawData.map(record => ({
          Email: record.Email,
          Password: record.Password,
          Status: record.Create_Status,
          isSuccess: record.Create_Status === 'SUCCESS'
        })),
        type: 'create'
      }
    }
    
    // Unknown format - try to guess
    this.warn('⚠️  Unknown file format. Trying to auto-detect...')
    
    // Try to find email and password fields
    const emailField = Object.keys(firstRow).find(key => 
      key.toLowerCase().includes('email') || key.toLowerCase().includes('user')
    )
    const passwordField = Object.keys(firstRow).find(key => 
      key.toLowerCase().includes('password') || key.toLowerCase().includes('pass')
    )
    const statusField = Object.keys(firstRow).find(key => 
      key.toLowerCase().includes('status')
    )
    
    if (emailField && passwordField) {
      return {
        data: rawData.map(record => ({
          Email: record[emailField],
          Password: record[passwordField],
          Status: statusField ? record[statusField] : 'SUCCESS',
          isSuccess: statusField ? (record[statusField] === 'SUCCESS') : true
        })),
        type: 'auto-detected'
      }
    }
    
    throw new Error('Could not detect file format. Expected reset results (Reset_Status, New_Password) or create results (Create_Status, Password)')
  }

  async promptForResetFile() {
    const resultsDir = path.join(process.cwd(), 'results')
    const choices = []

    try {
      if (await fs.pathExists(resultsDir)) {
        const files = await fs.readdir(resultsDir)
        const resetFiles = files.filter(file => 
          file.endsWith('.csv') && 
          (file.includes('reset') || file.includes('password') || file.includes('create') || file.includes('batch'))
        )
        resetFiles.forEach(file => {
          choices.push({
            name: `results/${file}`,
            value: `results/${file}`,
            short: file
          })
        })
      }

      choices.push({
        name: 'Enter custom file path',
        value: 'custom',
        short: 'custom'
      })

      if (choices.length === 1) {
        const { customPath } = await inquirer.prompt([
          {
            type: 'input',
            name: 'customPath',
            message: 'Enter password reset/create CSV file path:',
            default: 'results/example_result_password_reset.csv',
            validate: input => input.trim().length > 0 ? true : 'Please enter a file path'
          }
        ])
        return customPath
      }

      const { selectedFile } = await inquirer.prompt([
        {
          type: 'list',
          name: 'selectedFile',
          message: 'Select password reset/create CSV file:',
          choices: choices,
          pageSize: 10
        }
      ])

      if (selectedFile === 'custom') {
        const { customPath } = await inquirer.prompt([
          {
            type: 'input',
            name: 'customPath',
            message: 'Enter password reset/create CSV file path:',
            default: 'results/example_result_password_reset.csv',
            validate: input => input.trim().length > 0 ? true : 'Please enter a file path'
          }
        ])
        return customPath
      }

      return selectedFile
    } catch (error) {
      this.log('Error reading results directory, please enter file path manually:')
      const { customPath } = await inquirer.prompt([
        {
          type: 'input',
          name: 'customPath',
          message: 'Enter password reset/create CSV file path:',
          default: 'results/example_result_password_reset.csv',
          validate: input => input.trim().length > 0 ? true : 'Please enter a file path'
        }
      ])
      return customPath
    }
  }

  async promptForImapSyncFile(createNew = false) {
    if (createNew) {
      const { filePath } = await inquirer.prompt([
        {
          type: 'input',
          name: 'filePath',
          message: 'Enter new imapsync CSV file path:',
          default: 'input/sync/new-migration.csv',
          validate: input => input.trim().length > 0 ? true : 'Please enter a file path'
        }
      ])
      return filePath
    }

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

      choices.push({
        name: 'Enter custom file path',
        value: 'custom',
        short: 'custom'
      })

      if (choices.length === 1) {
        const { customPath } = await inquirer.prompt([
          {
            type: 'input',
            name: 'customPath',
            message: 'Enter imapsync CSV file path:',
            default: 'input/sync/migration.csv',
            validate: input => input.trim().length > 0 ? true : 'Please enter a file path'
          }
        ])
        return customPath
      }

      const { selectedFile } = await inquirer.prompt([
        {
          type: 'list',
          name: 'selectedFile',
          message: 'Select imapsync configuration CSV file:',
          choices: choices,
          pageSize: 10
        }
      ])

      if (selectedFile === 'custom') {
        const { customPath } = await inquirer.prompt([
          {
            type: 'input',
            name: 'customPath',
            message: 'Enter imapsync CSV file path:',
            default: 'input/sync/migration.csv',
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
          message: 'Enter imapsync CSV file path:',
          default: 'input/sync/migration.csv',
          validate: input => input.trim().length > 0 ? true : 'Please enter a file path'
        }
      ])
      return customPath
    }
  }

  async readCsvFile(filePath) {
    return new Promise((resolve, reject) => {
      const results = []
      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', () => resolve(results))
        .on('error', reject)
    })
  }

  async createBareboneImapSyncFile(filePath, normalizedData, target, includeFailed = false) {
    // Create bare bone imapsync CSV structure using normalized data
    const successfulEntries = normalizedData.data.filter(record => record.isSuccess)
    const failedEntries = normalizedData.data.filter(record => !record.isSuccess)
    
    const records = successfulEntries.map(record => {
      const baseRecord = {
        src_host: 'mail.example.com',
        src_user: record.Email,
        src_pass: target === 'src' ? record.Password : 'old_password',
        dst_host: 'mail.newserver.com',
        dst_user: record.Email,
        dst_pass: target === 'dst' ? record.Password : 'new_password',
        src_port: '993',
        dst_port: '993',
        src_ssl: '1',
        dst_ssl: '1',
        // Add comment field for tracking
        comments: `Password synced from ${normalizedData.type} (${target})`
      }
      return baseRecord
    })

    // Add failed entries only if includeFailed is true
    const failedRecords = includeFailed ? failedEntries.map(record => {
      const baseRecord = {
        src_host: 'mail.example.com',
        src_user: record.Email,
        src_pass: 'FAILED_CHECK_MANUALLY',
        dst_host: 'mail.newserver.com', 
        dst_user: record.Email,
        dst_pass: 'FAILED_CHECK_MANUALLY',
        src_port: '993',
        dst_port: '993',
        src_ssl: '1',
        dst_ssl: '1',
        comments: `⚠️ ${normalizedData.type} failed: ${record.Status || 'Unknown'} - Check manually`
      }
      return baseRecord
    }) : []

    // Combine successful and failed records
    const allRecords = [...records, ...failedRecords]

    // Ensure directory exists
    await fs.ensureDir(path.dirname(filePath))

    const csvWriter = createObjectCsvWriter({
      path: filePath,
      header: [
        {id: 'src_host', title: 'src_host'},
        {id: 'src_user', title: 'src_user'},
        {id: 'src_pass', title: 'src_pass'},
        {id: 'dst_host', title: 'dst_host'},
        {id: 'dst_user', title: 'dst_user'},
        {id: 'dst_pass', title: 'dst_pass'},
        {id: 'src_port', title: 'src_port'},
        {id: 'dst_port', title: 'dst_port'},
        {id: 'src_ssl', title: 'src_ssl'},
        {id: 'dst_ssl', title: 'dst_ssl'},
        {id: 'comments', title: 'comments'}
      ]
    })

    await csvWriter.writeRecords(allRecords)
    
    return {
      totalRecords: allRecords.length,
      successfulRecords: records.length,
      failedRecords: failedRecords.length,
      addedFromSource: successfulEntries.map(r => r.Email),
      failedFromSource: failedEntries.map(r => r.Email)
    }
  }

  async updateImapSyncFile(imapSyncPath, normalizedData, target, outputPath, includeFailed = false) {
    const imapSyncData = await this.readCsvFile(imapSyncPath)
    
    // Create maps for quick lookup using normalized data
    const passwordMap = new Map()
    const sourceEmailSet = new Set()
    const successfulEmails = new Set()
    const failedEmails = new Set()
    
    normalizedData.data.forEach(record => {
      sourceEmailSet.add(record.Email)
      if (record.isSuccess) {
        passwordMap.set(record.Email, record.Password)
        successfulEmails.add(record.Email)
      } else {
        failedEmails.add(record.Email)
      }
    })

    // Track different types of emails
    const syncStats = {
      updatedCount: 0,
      notFoundInSource: [],
      foundInSource: [],
      failedButInSync: [],
      newlyAddedFromSource: []
    }

    // Get existing emails in sync file
    const existingEmails = new Set()
    imapSyncData.forEach(record => {
      const email = target === 'src' ? record.src_user : record.dst_user
      existingEmails.add(email)
    })

    // Update passwords in existing imapsync data
    const updatedData = imapSyncData.map(record => {
      const updatedRecord = { ...record }
      let emailToCheck = ''
      
      if (target === 'src') {
        emailToCheck = record.src_user
      } else if (target === 'dst') {
        emailToCheck = record.dst_user
      }
      
      // Add comments field if not exists
      if (!updatedRecord.comments) {
        updatedRecord.comments = ''
      }

      if (passwordMap.has(emailToCheck)) {
        // Email found in successful results - update password
        if (target === 'src') {
          updatedRecord.src_pass = passwordMap.get(emailToCheck)
        } else {
          updatedRecord.dst_pass = passwordMap.get(emailToCheck)
        }
        updatedRecord.comments = `Password updated from ${normalizedData.type} (${target})`
        syncStats.updatedCount++
        syncStats.foundInSource.push(emailToCheck)
      } else if (failedEmails.has(emailToCheck)) {
        // Email exists in failed results
        updatedRecord.comments = `⚠️ ${normalizedData.type} failed - Password NOT updated. Check manually!`
        syncStats.failedButInSync.push(emailToCheck)
      } else {
        // Email not found in any results
        if (!updatedRecord.comments) {
          updatedRecord.comments = `Not in ${normalizedData.type} results - Password unchanged`
        }
        syncStats.notFoundInSource.push(emailToCheck)
      }
      
      return updatedRecord
    })

    // Find emails that were successful but not in existing sync file
    successfulEmails.forEach(email => {
      if (!existingEmails.has(email)) {
        syncStats.newlyAddedFromSource.push(email)
        // Add new record for emails that were processed but not in sync file
        const newRecord = {
          src_host: updatedData.length > 0 ? updatedData[0].src_host || 'mail.example.com' : 'mail.example.com',
          src_user: email,
          src_pass: target === 'src' ? passwordMap.get(email) : 'NEEDS_PASSWORD',
          dst_host: updatedData.length > 0 ? updatedData[0].dst_host || 'mail.newserver.com' : 'mail.newserver.com',
          dst_user: email,
          dst_pass: target === 'dst' ? passwordMap.get(email) : 'NEEDS_PASSWORD',
          src_port: updatedData.length > 0 ? updatedData[0].src_port || '993' : '993',
          dst_port: updatedData.length > 0 ? updatedData[0].dst_port || '993' : '993',
          src_ssl: updatedData.length > 0 ? updatedData[0].src_ssl || '1' : '1',
          dst_ssl: updatedData.length > 0 ? updatedData[0].dst_ssl || '1' : '1',
          comments: `✨ New entry from ${normalizedData.type} results (${target} password updated)`
        }
        updatedData.push(newRecord)
      }
    })

    // Also add failed emails that weren't in sync file for completeness (only if includeFailed is true)
    if (includeFailed) {
      failedEmails.forEach(email => {
        if (!existingEmails.has(email)) {
          const newRecord = {
            src_host: updatedData.length > 0 ? updatedData[0].src_host || 'mail.example.com' : 'mail.example.com',
            src_user: email,
            src_pass: 'FAILED_CHECK_MANUALLY',
            dst_host: updatedData.length > 0 ? updatedData[0].dst_host || 'mail.newserver.com' : 'mail.newserver.com',
            dst_user: email,
            dst_pass: 'FAILED_CHECK_MANUALLY',
            src_port: updatedData.length > 0 ? updatedData[0].src_port || '993' : '993',
            dst_port: updatedData.length > 0 ? updatedData[0].dst_port || '993' : '993',
            src_ssl: updatedData.length > 0 ? updatedData[0].src_ssl || '1' : '1',
            dst_ssl: updatedData.length > 0 ? updatedData[0].dst_ssl || '1' : '1',
            comments: `⚠️ ${normalizedData.type} failed - Added for completeness, check manually!`
          }
          updatedData.push(newRecord)
        }
      })
    }

    // Ensure output directory exists
    await fs.ensureDir(path.dirname(outputPath))

    // Write updated data
    if (updatedData.length > 0) {
      const headers = Object.keys(updatedData[0])
      // Ensure comments field is included
      if (!headers.includes('comments')) {
        headers.push('comments')
      }
      
      const csvWriter = createObjectCsvWriter({
        path: outputPath,
        header: headers.map(h => ({id: h, title: h}))
      })

      await csvWriter.writeRecords(updatedData)
    }

    return {
      updatedCount: syncStats.updatedCount,
      totalRecords: updatedData.length,
      foundInSource: syncStats.foundInSource,
      notFoundInSource: syncStats.notFoundInSource,
      failedButInSync: syncStats.failedButInSync,
      newlyAddedFromSource: syncStats.newlyAddedFromSource,
      originalRecords: imapSyncData.length
    }
  }

  async run() {
    const { flags } = await this.parse(SyncPass)

    try {
      if (flags.debug) {
        this.log('🔍 Debug mode enabled')
      }

      // Step 1: Get results file (reset or create)
      let resultsFile = flags['reset-file']
      if (!resultsFile) {
        this.log('\n📁 Select password reset/create results file:')
        resultsFile = await this.promptForResetFile()
      }

      if (!await fs.pathExists(resultsFile)) {
        this.error(`❌ Results file not found: ${resultsFile}`)
      }

      // Step 2: Read and normalize results data
      this.log(`\n📖 Reading results from: ${resultsFile}`)
      const rawData = await this.readCsvFile(resultsFile)
      const normalizedData = this.normalizeResultData(rawData)
      
      const successfulEntries = normalizedData.data.filter(record => record.isSuccess)
      this.log(`✅ Found ${successfulEntries.length} successful entries out of ${normalizedData.data.length} total`)
      this.log(`📋 File type detected: ${normalizedData.type}`)

      if (successfulEntries.length === 0) {
        this.error('❌ No successful entries found in the file')
      }

      // Step 3: Check if creating new or updating existing
      let createNew = flags['create-new']
      if (createNew === undefined) {
        const { action } = await inquirer.prompt([
          {
            type: 'list',
            name: 'action',
            message: '📄 What would you like to do?',
            choices: [
              { name: 'Update existing imapsync file', value: 'update' },
              { name: 'Create new imapsync file', value: 'create' }
            ]
          }
        ])
        createNew = action === 'create'
      }

      // Step 4: Get target (src or dst)
      let target = flags.target
      if (!target) {
        const { selectedTarget } = await inquirer.prompt([
          {
            type: 'list',
            name: 'selectedTarget',
            message: '🎯 Where should the passwords be applied?',
            choices: [
              { name: 'Source (src) - Update source email passwords', value: 'src' },
              { name: 'Destination (dst) - Update destination email passwords', value: 'dst' }
            ]
          }
        ])
        target = selectedTarget
      }

      let result

      if (createNew) {
        // Step 5a: Create new file
        let outputPath = flags.output
        if (!outputPath) {
          outputPath = await this.promptForImapSyncFile(true)
        }

        this.log(`\n🆕 Creating new imapsync file: ${outputPath}`)
        const createResult = await this.createBareboneImapSyncFile(outputPath, normalizedData, target, flags['include-failed'])
        
        result = {
          action: 'created',
          outputPath,
          updatedCount: createResult.successfulRecords,
          totalRecords: createResult.totalRecords,
          failedRecords: createResult.failedRecords,
          addedFromSource: createResult.addedFromSource,
          failedFromSource: createResult.failedFromSource,
          notFoundInSource: [],
          newlyAddedFromSource: createResult.addedFromSource,
          failedButInSync: []
        }

      } else {
        // Step 5b: Update existing file
        let imapSyncFile = flags['imapsync-file']
        if (!imapSyncFile) {
          this.log('\n📂 Select imapsync configuration file to update:')
          imapSyncFile = await this.promptForImapSyncFile(false)
        }

        if (!await fs.pathExists(imapSyncFile)) {
          this.error(`❌ ImapSync file not found: ${imapSyncFile}`)
        }

        let outputPath = flags.output
        if (!outputPath) {
          // Generate default output path
          const parsedPath = path.parse(imapSyncFile)
          outputPath = path.join(parsedPath.dir, `${parsedPath.name}_updated${parsedPath.ext}`)
          
          const { confirmOutput } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'confirmOutput',
              message: `💾 Save updated file to: ${outputPath}?`,
              default: true
            }
          ])

          if (!confirmOutput) {
            const { customOutput } = await inquirer.prompt([
              {
                type: 'input',
                name: 'customOutput',
                message: 'Enter output file path:',
                default: outputPath,
                validate: input => input.trim().length > 0 ? true : 'Please enter a file path'
              }
            ])
            outputPath = customOutput
          }
        }

        this.log(`\n🔄 Updating imapsync file: ${imapSyncFile}`)
        result = await this.updateImapSyncFile(imapSyncFile, normalizedData, target, outputPath, flags['include-failed'])
        result.action = 'updated'
        result.outputPath = outputPath
      }

      // Step 6: Show results
      this.log('\n🎉 Sync completed successfully!')
      this.log(`📊 Summary:`)
      this.log(`   • Action: ${result.action === 'created' ? 'Created new file' : 'Updated existing file'}`)
      this.log(`   • Output: ${result.outputPath}`)
      this.log(`   • Target: ${target === 'src' ? 'Source passwords' : 'Destination passwords'}`)
      this.log(`   • Total records: ${result.totalRecords}`)
      this.log(`   • Passwords updated: ${result.updatedCount}`)
      
      // Show detailed sync analysis
      if (result.action === 'created') {
        this.log(`\n📝 Creation Details:`)
        if (result.failedRecords > 0) {
          this.log(`   • ⚠️  Failed entries added: ${result.failedRecords} (marked for manual check)`)
        }
        if (result.failedFromSource && result.failedFromSource.length > 0) {
          this.log(`   • 🔍 Failed entries: ${result.failedFromSource.slice(0, 5).join(', ')}${result.failedFromSource.length > 5 ? '...' : ''}`)
        }
      } else {
        this.log(`\n📝 Sync Analysis:`)
        
        if (result.newlyAddedFromSource && result.newlyAddedFromSource.length > 0) {
          this.log(`   • ✨ New entries from source: ${result.newlyAddedFromSource.length}`)
          if (flags.debug) {
            this.log(`     ${result.newlyAddedFromSource.slice(0, 3).join(', ')}${result.newlyAddedFromSource.length > 3 ? '...' : ''}`)
          }
        }
        
        if (result.notFoundInSource && result.notFoundInSource.length > 0) {
          this.log(`   • ⚠️  Emails in sync file but not in source: ${result.notFoundInSource.length}`)
          if (flags.debug) {
            this.log(`     ${result.notFoundInSource.slice(0, 3).join(', ')}${result.notFoundInSource.length > 3 ? '...' : ''}`)
          }
        }
        
        if (result.failedButInSync && result.failedButInSync.length > 0) {
          this.log(`   • ❌ Failed entries in sync file: ${result.failedButInSync.length} (passwords NOT updated)`)
          if (flags.debug) {
            this.log(`     ${result.failedButInSync.slice(0, 3).join(', ')}${result.failedButInSync.length > 3 ? '...' : ''}`)
          }
        }
        
        if (result.originalRecords) {
          const addedRecords = result.totalRecords - result.originalRecords
          if (addedRecords > 0) {
            this.log(`   • ➕ Records added: ${addedRecords}`)
          }
        }
      }

      // Important notes
      this.log(`\n💡 Important Notes:`)
      this.log(`   • Check the 'comments' column in output file for details`)
      if (flags['include-failed']) {
        this.log(`   • Failed reset entries included (use --no-include-failed to exclude)`)
      } else {
        this.log(`   • Failed reset entries excluded by default (use --include-failed to include)`)
      }
      this.log(`   • Entries marked 'FAILED_CHECK_MANUALLY' need manual attention`)
      this.log(`   • Entries marked 'NEEDS_PASSWORD' need the other password filled`)

      if (flags.debug) {
        this.log('\n🔍 Debug info:')
        this.log(`   • Source file: ${resultsFile}`)
        this.log(`   • File type: ${normalizedData.type}`)
        this.log(`   • Target field: ${target}_pass`)
        this.log(`   • Create new: ${createNew}`)
        this.log(`   • Include failed: ${flags['include-failed']}`)
        if (result.foundInSource && result.foundInSource.length > 0) {
          this.log(`   • Emails found and updated: ${result.foundInSource.length}`)
        }
      }

    } catch (error) {
      this.error(`❌ Error: ${error.message}`)
    }
  }
}
