<p align="center">
  <img src="logo.png" alt="emoo - emo cow logo" width="200"/>
</p>

# emoo 🐄

_CLI tool for IMAP email migration and cPanel bulk operations_

## Installation

```bash
# Clone repository
git clone <repository-url>
cd emoo

# Install dependencies
pnpm install

# Make CLI executable
chmod +x bin/cli.js
```

## Usage

### General Help

```bash
# View all available commands
node bin/cli.js --help

# or
pnpm start --help
```

### cPanel Bulk Email Password Reset

This feature allows bulk email password reset in cPanel.

#### Interactive Mode

```bash
# Interactive mode - will ask for server, username, and API key
node bin/cli.js cpanel
```

#### Command Line Mode

```bash
# With all parameters
node bin/cli.js cpanel \
  --server "server.example.com:2083" \
  --username "cpanel_user" \
  --api-key "your_api_key" \
  --password "new_password_for_all" \
  --output "./results/custom_output.csv"

# Or with random passwords
node bin/cli.js cpanel \
  --server "server.example.com" \
  --username "cpanel_user" \
  --api-key "your_api_key" \
  --output "./results/passwords.csv"
```

#### Options

- `-s, --server <server>`: cPanel server domain/IP (with optional port)
- `-u, --username <username>`: cPanel username
- `-k, --api-key <key>`: cPanel API key
- `-p, --password <password>`: New password for all accounts (empty = random)
- `-o, --output <file>`: CSV output file path
- `--regex <pattern>`: Filter emails using regex pattern
- `--debug`: Enable debug mode

### IMAP Email Synchronization

This feature is for email synchronization between IMAP servers using imapsync.

#### Basic Usage

```bash
# Sync using default CSV (input/example.csv)
node bin/cli.js sync

# Sync with custom CSV file
node bin/cli.js sync --csv input/my-migration.csv

# Dry run - see what would be synced without execution
node bin/cli.js sync --dry-run --csv input/example.csv

# Use Docker for imapsync
node bin/cli.js sync --docker --csv input/example.csv

# Parallel processing with 4 jobs
node bin/cli.js sync --jobs 4 --csv input/example.csv
```

#### Options

- `-c, --csv <file>`: CSV file containing sync configuration (default: "input/example.csv")
- `-j, --jobs <number>`: Number of parallel jobs (default: "1")
- `--docker`: Use Docker for imapsync
- `--log-dir <dir>`: Directory for log files (default: "./results")
- `--dry-run`: Preview commands without execution

#### CSV Format for Sync

The CSV file must contain the following columns:

```csv
src_host,src_user,src_pass,dst_host,dst_user,dst_pass,src_port,dst_port,src_ssl,dst_ssl,src_auth,dst_auth
mail.old.com,user1@old.com,pass1,mail.new.com,user1@new.com,pass1,993,993,1,1,,
mail.old.com,user2@old.com,pass2,mail.new.com,user2@new.com,pass2,143,143,0,0,PLAIN,PLAIN
```

**Required columns:**

- `src_host`: Source IMAP server
- `src_user`: Source username
- `src_pass`: Source password
- `dst_host`: Destination IMAP server
- `dst_user`: Destination username
- `dst_pass`: Destination password

**Optional columns:**

- `src_port`, `dst_port`: Port numbers
- `src_ssl`, `dst_ssl`: SSL enabled (1/true = enabled, 0/false = disabled)
- `src_auth`, `dst_auth`: Authentication mechanisms

## Features

### Migration from Bash Scripts

This tool is a rewrite from bash scripts:

- `cpanel-email-bulk` → `node bin/cli.js cpanel`
- `sync` → `node bin/cli.js sync`

### cPanel Features

- ✅ Auto-detect authentication method (cpanel/basic/uapi-token)
- ✅ Interactive domain selection
- ✅ Bulk password reset
- ✅ Random password generation
- ✅ CSV export with timestamp
- ✅ Progress indicators and colored output

### IMAP Sync Features

- ✅ CSV-based configuration
- ✅ Sequential and parallel processing
- ✅ Docker support for imapsync
- ✅ Dry-run mode
- ✅ Detailed logging
- ✅ SSL/TLS support
- ✅ Custom authentication mechanisms

## Dependencies

- **Node.js**: >= 18.0.0
- **imapsync**: Optional (if not using Docker)
- **Docker**: Optional (for imapsync Docker mode)

## Directory Structure

```
emoo/
├── bin/cli.js          # Main CLI entry point
├── src/
│   ├── cpanel-bulk.js  # cPanel bulk operations
│   └── imap-sync.js    # IMAP synchronization
├── input/              # CSV input files
│   ├── example.csv     # Example configuration
│   └── *.csv           # Other configuration files
├── results/            # Output directory
└── package.json
```

## Examples

### Example 1: cPanel Password Reset

```bash
# Reset passwords for all emails in selected domain
node bin/cli.js cpanel \
  --server "cpanel.example.com" \
  --username "admin" \
  --api-key "your-api-key"
```

### Example 2: IMAP Migration with Parallel Jobs

```bash
# Migrate 10 accounts in parallel using Docker
node bin/cli.js sync \
  --csv input/migration-batch1.csv \
  --jobs 10 \
  --docker \
  --log-dir ./logs/batch1
```

### Example 3: Dry Run Testing

```bash
# Test configuration without execution
node bin/cli.js sync --dry-run --csv input/test-config.csv
```

## Troubleshooting

### imapsync not found

```bash
# Install imapsync locally or use Docker mode
node bin/cli.js sync --docker
```

### cPanel API Authentication Issues

The tool will automatically try 3 authentication methods:

1. cPanel auth (`Authorization: cpanel username:apikey`)
2. Basic auth (`Authorization: Basic`)
3. UAPI token (`Authorization: uapi-token username:token`)

### CSV Format Issues

Make sure the CSV file:

- Uses comma (`,`) as separator
- Has header row
- Required columns are available
- No empty rows in the middle of data

## Disclaimer

⚠️ **Use at your own risk!** Always backup your data before using emoo, test in development environment first, and make sure you have permission to access the email accounts. Authors are not responsible for any data loss or issues.

## License

This project is licensed under the ISC License - see the [LICENSE](LICENSE) file for details.
