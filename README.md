<p align="center">
  <img src="logo.png" alt="emoo - emo cow logo" width="200"/>
</p>

# emoo 🐄

_CLI tool for IMAP email migration and cPanel email bulk operations_

## Installation

```bash
# Clone repository
git clone <repository-url>
cd emoo

# Install dependencies
pnpm install

# Install globally for easier access
pnpm install -g emoo
```

## Usage

### General Help

```bash
# View all available commands
emoo --help

# or using pnpm
pnpm start --help
```

### cPanel Bulk Email Operations

This feature allows bulk email operations in cPanel including password reset and email creation.

#### Password Reset - Interactive Mode

```bash
# Interactive mode - will ask for server, username, and API key
emoo cpanel reset
```

#### Bulk Email Password Reset by Domain

```bash
# With all parameters
emoo cpanel reset \
  --server "server.example.com:2083" \
  --username "cpanel_user" \
  --api-key "your_api_key" \
  --password "new_password_for_all" \
  --output "./results/custom_output.csv"

# Or with random passwords
emoo cpanel reset \
  --server "server.example.com" \
  --username "cpanel_user" \
  --api-key "your_api_key" \
  --output "./results/passwords.csv"
```

#### Bulk Email Creation

```bash
# Create emails from CSV file
emoo cpanel create \
  --server "server.example.com" \
  --username "cpanel_user" \
  --api-key "your_api_key" \
  --csv "./input/new-emails.csv"

# Or create manually with interactive prompts
emoo cpanel create \
  --server "server.example.com" \
  --username "cpanel_user" \
  --api-key "your_api_key"
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
emoo sync

# Sync with custom CSV file
emoo sync --csv input/my-migration.csv

# Dry run - see what would be synced without execution
emoo sync --dry-run --csv input/example.csv

# Use Docker for imapsync
emoo sync --docker --csv input/example.csv

# Parallel processing with 4 jobs
emoo sync --parallel 4 --csv input/example.csv
```

#### Options

- `-c, --csv <file>`: CSV file containing sync configuration (default: "input/example.csv")
- `-j, --parallel <number>`: Number of parallel jobs (default: "1")
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

### cPanel Tools Features

- Auto-detect authentication method (cpanel/basic/uapi-token)
- Bulk email accounts password reset (including random password generation)
- Bulk email creation
- All result in CSV format

### IMAP Sync Features

- CSV-based configuration
- Docker support for imapsync

## Dependencies

- **Node.js**: >= 18.0.0
- **imapsync**: Optional (if not using Docker)
- **Docker**: Optional (for imapsync Docker mode)

## Examples

### Example 1: cPanel Password Reset

```bash
# Reset passwords for all emails in selected domain
emoo cpanel reset \
  --server "cpanel.example.com" \
  --username "admin" \
  --api-key "your-api-key"
```

### Example 2: cPanel Bulk Email Creation

```bash
# Create emails from CSV file
emoo cpanel create \
  --server "cpanel.example.com" \
  --username "admin" \
  --api-key "your-api-key" \
  --csv input/new-emails.csv
```

### Example 3: IMAP Migration with Parallel Jobs

```bash
# Migrate 10 accounts in parallel using Docker
emoo sync \
  --csv input/migration-batch1.csv \
  --parallel 10 \
  --docker \
  --log-dir ./logs/batch1
```

### Example 3: Dry Run Testing

```bash
# Test configuration without execution
emoo sync --dry-run --csv input/test-config.csv
```

## Troubleshooting

### imapsync not found

```bash
# Install imapsync locally or use Docker mode
emoo sync --docker
```

### cPanel API Authentication Issues

The tool will automatically try 2 authentication methods:

1. cPanel auth (`Authorization: cpanel username:apikey`)
2. Basic auth (`Authorization: Basic`)

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
