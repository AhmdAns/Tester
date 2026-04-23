# TestHelper

AI-powered test engineering CLI for Azure DevOps.

## Install

Requirements:
- Node.js `>=18`

From this repo:

```bash
npm install
npm run build
```

Run CLI locally:

```bash
node ./bin/testhelper.js --help
```

Optional global command:

```bash
npm link
testhelper --help
```

## Key Features (Current)

### 1) Initialize config (`init`)

```bash
testhelper init
```

What it does:
- creates `.testhelper.json`
- adds `.testhelper/` to `.gitignore` (if missing)

### 2) Fetch work items (`fetch`)

Set credentials first:

```bash
TESTHELPER_ADO_PAT=<your-personal-access-token>
TESTHELPER_ADO_ORG=<your-organization>
TESTHELPER_ADO_PROJECT=<your-project>
```

Fetch by IDs:

```bash
testhelper fetch --ids 12345,12346
```

Fetch by date range:

```bash
testhelper fetch --from 2024-01-01 --to 2024-01-31 --types "User Story,Bug"
```

Get JSON output:

```bash
testhelper fetch --ids 12345 --output json
```

## Useful Options

`fetch` options:
- `--ids <comma-separated ids>`
- `--from <iso-date> --to <iso-date>`
- `--types <comma-separated types>`
- `--area <area path>`
- `--iteration <iteration path>`
- `--include-relations` (default: true)
- `--output summary|json`

Global options:
- `--dry-run`
- `--verbose`
- `--config <path>`

Example dry run:

```bash
testhelper --dry-run fetch --ids 12345
```
