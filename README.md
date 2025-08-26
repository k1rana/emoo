# IMAP Migration CLI Tool

CLI tool untuk migrasi email IMAP dan operasi bulk cPanel yang di-rewrite dari bash script ke Node.js.

## Installation

```bash
# Clone repository
git clone <repository-url>
cd migrate-imap

# Install dependencies
pnpm install

# Make CLI executable
chmod +x bin/cli.js
```

## Usage

### General Help

```bash
# Lihat semua commands yang tersedia
node bin/cli.js --help

# atau
pnpm start --help
```

### cPanel Bulk Email Password Reset

Fitur ini memungkinkan reset password email secara bulk di cPanel.

#### Interactive Mode

```bash
# Mode interaktif - akan menanyakan server, username, dan API key
node bin/cli.js cpanel
```

#### Command Line Mode

```bash
# Dengan semua parameter
node bin/cli.js cpanel \
  --server "server.example.com:2083" \
  --username "cpanel_user" \
  --api-key "your_api_key" \
  --password "new_password_for_all" \
  --output "./results/custom_output.csv"

# Atau dengan random passwords
node bin/cli.js cpanel \
  --server "server.example.com" \
  --username "cpanel_user" \
  --api-key "your_api_key" \
  --output "./results/passwords.csv"
```

#### Options

- `-s, --server <server>`: cPanel server domain/IP (dengan optional port)
- `-u, --username <username>`: cPanel username
- `-k, --api-key <key>`: cPanel API key
- `-p, --password <password>`: Password baru untuk semua akun (kosong = random)
- `-o, --output <file>`: Path file CSV output
- `--regex <pattern>`: Filter email menggunakan regex pattern
- `--debug`: Enable debug mode

### IMAP Email Synchronization

Fitur ini untuk sinkronisasi email antara server IMAP menggunakan imapsync.

#### Basic Usage

```bash
# Sync menggunakan CSV default (input/example.csv)
node bin/cli.js sync

# Sync dengan custom CSV file
node bin/cli.js sync --csv input/my-migration.csv

# Dry run - lihat apa yang akan di-sync tanpa eksekusi
node bin/cli.js sync --dry-run --csv input/example.csv

# Menggunakan Docker untuk imapsync
node bin/cli.js sync --docker --csv input/example.csv

# Parallel processing dengan 4 jobs
node bin/cli.js sync --jobs 4 --csv input/example.csv
```

#### Options

- `-c, --csv <file>`: CSV file berisi konfigurasi sync (default: "input/example.csv")
- `-j, --jobs <number>`: Jumlah parallel jobs (default: "1")
- `--docker`: Gunakan Docker untuk imapsync
- `--log-dir <dir>`: Directory untuk log files (default: "./results")
- `--dry-run`: Preview command tanpa eksekusi

#### CSV Format for Sync

File CSV harus mengandung kolom-kolom berikut:

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

### Migrasi dari Bash Scripts

Tool ini adalah rewrite dari bash scripts:

- `cpanel-email-bulk` → `node bin/cli.js cpanel`
- `sync` → `node bin/cli.js sync`

### cPanel Features

- ✅ Auto-detect authentication method (cpanel/basic/uapi-token)
- ✅ Interactive domain selection
- ✅ Bulk password reset
- ✅ Random password generation
- ✅ CSV export dengan timestamp
- ✅ Progress indicators dan colored output

### IMAP Sync Features

- ✅ CSV-based configuration
- ✅ Sequential dan parallel processing
- ✅ Docker support untuk imapsync
- ✅ Dry-run mode
- ✅ Detailed logging
- ✅ SSL/TLS support
- ✅ Custom authentication mechanisms

## Dependencies

- **Node.js**: >= 18.0.0
- **imapsync**: Optional (jika tidak menggunakan Docker)
- **Docker**: Optional (untuk imapsync Docker mode)

## Directory Structure

```
migrate-imap/
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
# Reset passwords untuk semua email di domain yang dipilih
node bin/cli.js cpanel \
  --server "cpanel.example.com" \
  --username "admin" \
  --api-key "your-api-key"
```

### Example 2: IMAP Migration with Parallel Jobs

```bash
# Migrate 10 accounts secara parallel menggunakan Docker
node bin/cli.js sync \
  --csv input/migration-batch1.csv \
  --jobs 10 \
  --docker \
  --log-dir ./logs/batch1
```

### Example 3: Dry Run Testing

```bash
# Test konfigurasi tanpa eksekusi
node bin/cli.js sync --dry-run --csv input/test-config.csv
```

## Troubleshooting

### imapsync not found

```bash
# Install imapsync locally atau gunakan Docker mode
node bin/cli.js sync --docker
```

### cPanel API Authentication Issues

Tool akan otomatis mencoba 3 metode authentication:

1. cPanel auth (`Authorization: cpanel username:apikey`)
2. Basic auth (`Authorization: Basic`)
3. UAPI token (`Authorization: uapi-token username:token`)

### CSV Format Issues

Pastikan CSV file:

- Menggunakan comma (`,`) sebagai separator
- Memiliki header row
- Required columns tersedia
- Tidak ada baris kosong di tengah data

## License

ISC License
