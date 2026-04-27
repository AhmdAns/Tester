# TestHelper

AI-powered test engineering CLI for Azure DevOps. Fetches work items, builds a product knowledge base, analyzes requirements, and generates comprehensive test cases — all using your Claude Code subscription, no separate API key required.

## Requirements

- Node.js `>=18`
- [Claude Code](https://claude.ai/code) installed and authenticated (`claude` must be in PATH)
- Azure DevOps Personal Access Token

## Install

```bash
npm install
npm run build
```

**Optional — install globally:**
```bash
npm install -g .
# then use `testhelper` instead of `node bin/testhelper.js` everywhere below
```

---

## Setup (one time)

**1. Set your Azure DevOps credentials**

```bash
export TESTHELPER_ADO_PAT=your-personal-access-token
export TESTHELPER_ADO_ORG=your-organization-name
export TESTHELPER_ADO_PROJECT=your-project-name
```

> To create a PAT: Azure DevOps → User Settings → Personal Access Tokens → New Token.
> Required scopes: **Work Items (Read)**, **Test Management (Read & Write)**.

**2. Initialize config**

```bash
node bin/testhelper.js init
```

Creates `.testhelper.json` in the current directory and adds `.testhelper/` to `.gitignore`.

---

## Recommended workflow

```
1. context build   → build product knowledge base (team lead, once per release/sprint)
2. git push        → share context with the team via version control
3. git pull        → teammates get the latest context
4. context rebuild → teammates regenerate their local vector index (no Claude/ADO needed)
5. run <id>        → full pipeline for a specific story
6. publish         → push generated tests to ADO Test Plans
```

---

## Product Context Knowledge Base

This is the foundation that makes TestHelper behave like a senior tester who already knows the product. Before designing any tests, build the knowledge base from your existing work items.

### How it works

1. Fetches a broad set of work items across a date range
2. Groups them into business clusters — by **Epic hierarchy** first, then by **Area Path**
3. For each cluster, calls Claude to extract: domain overview, business rules, user flows, constraints, edge cases, and domain vocabulary
4. Saves each cluster as a structured Markdown document in `.testhelper/context/`
5. Vectorizes all context documents into the same search index as individual work items

When you later run `design` or `analyze`, the relevant context documents are automatically injected into the prompt — giving Claude the product awareness to generate tests that reflect real business rules, not just the literal text of the story.

### Team sharing

The context knowledge base is designed to be built once by a team lead and shared with the whole team via git — no one else needs to call Claude or ADO to use it.

**What is committed to git** (text files, fully reviewable):
```
.testhelper/context/    ← business rule summaries per cluster
.testhelper/items/      ← work item Markdown files
```

**What stays local only** (gitignored, rebuilt on demand):
```
.testhelper/vectors/    ← LanceDB binary index
.testhelper/cache/      ← ADO API response cache
```

**Team lead workflow** (run once per sprint or after major feature delivery):
```bash
testhelper context build --from 2024-01-01 --to 2024-12-31
git add .testhelper/context/ .testhelper/items/
git commit -m "Update product context knowledge base"
git push
```

**Team member workflow** (after pulling):
```bash
git pull
testhelper context rebuild
```

`context rebuild` reads the committed Markdown files and regenerates the local vector index. It makes no Claude or ADO calls — it only runs the embedding model locally. Takes a few seconds after the first model download.

---

### Build the knowledge base

```bash
# Fetch up to 300 items from the last year and build context
node bin/testhelper.js context build --from 2024-01-01 --to 2024-12-31

# Limit item count
node bin/testhelper.js context build --from 2024-01-01 --to 2024-12-31 --max 150

# Filter by work item type
node bin/testhelper.js context build --from 2024-01-01 --to 2024-12-31 --types "User Story,Bug,Feature,Epic"

# Filter by area path
node bin/testhelper.js context build --from 2024-01-01 --to 2024-12-31 --area "MyProject\Auth"
```

> Refresh the knowledge base whenever significant new features or epics are delivered.

### Rebuild local index (team members)

```bash
node bin/testhelper.js context rebuild
```

Re-vectorizes all context documents and work items from the committed Markdown files. No Claude, no ADO — just the local embedding model.

### Check what was built

```bash
node bin/testhelper.js context status
```

Example output:
```
Product context knowledge base
Built: 2024-11-15T10:30:00Z
Total items indexed: 212

Clusters (8):
  [epic      ] Authentication & Security (34 items)
  [epic      ] Payments & Billing (28 items)
  [area      ] MyProject\Dashboard (19 items)
  [area      ] MyProject\Reporting (12 items)
  ...
```

### Search the knowledge base

```bash
node bin/testhelper.js context search "password reset flow"
node bin/testhelper.js context search "payment validation rules"
```

---

## Full pipeline (recommended)

Once the context knowledge base is built, run the full pipeline for any story:

```bash
node bin/testhelper.js run 12345
```

This does: fetch → vectorize → analyze → design in one command.

Also publish directly to ADO Test Plans:

```bash
node bin/testhelper.js run 12345 --publish --plan "Sprint 23 Tests"
```

---

## Step by step

### Fetch work items

```bash
# By ID (also fetches related items)
node bin/testhelper.js fetch --ids 12345

# Multiple IDs
node bin/testhelper.js fetch --ids 12345,12346,12347

# By date range with type filter
node bin/testhelper.js fetch --from 2024-01-01 --to 2024-01-31 --types "User Story,Bug"

# JSON output
node bin/testhelper.js fetch --ids 12345 --output json
```

### Index for semantic search

```bash
node bin/testhelper.js vectorize --ids 12345
```

> The first run downloads ~90 MB of embedding model weights and takes 15–30 seconds. Subsequent runs use the local cache and are fast.

Reindex everything in `.testhelper/items/`:

```bash
node bin/testhelper.js rebuild-index
```

### Search indexed items

```bash
node bin/testhelper.js search "password reset flow"
node bin/testhelper.js search "authentication" --top 5
```

### Analyze a work item

Uses Claude (your Claude Code subscription) to surface ambiguities, gaps, and testability issues before writing tests. If a context knowledge base has been built, relevant business rules are included in the analysis automatically.

```bash
# Default analyses: ambiguity, gap, testability
node bin/testhelper.js analyze 12345

# Specific analysis types
node bin/testhelper.js analyze 12345 --type ambiguity,gap,contradiction

# All 8 analysis types
node bin/testhelper.js analyze 12345 --type all

# Save report to file
node bin/testhelper.js analyze 12345 --output ./reports/12345.md
```

Available analysis types: `ambiguity`, `gap`, `overlap`, `contradiction`, `dependency`, `impact`, `completeness`, `testability`

### Design test cases

Uses Claude to generate comprehensive, coverage-complete test cases. Context documents matching the work item's area and epic are automatically prepended to the prompt, so Claude sees the full business rule picture before generating tests.

```bash
# Print as JSON (default)
node bin/testhelper.js design 12345

# Markdown table — good for review
node bin/testhelper.js design 12345 --format md

# Save to file
node bin/testhelper.js design 12345 --format json --output ./tests/12345-tests.json
node bin/testhelper.js design 12345 --format csv  --output ./tests/12345-tests.csv
node bin/testhelper.js design 12345 --format xlsx --output ./tests/12345-tests.xlsx
```

### Publish to Azure DevOps Test Plans

```bash
# From a JSON file you already generated
node bin/testhelper.js publish --from-file ./tests/12345-tests.json --plan "Sprint 23" --suite "US-12345"

# Design + publish in one step
node bin/testhelper.js publish --story 12345 --plan "Sprint 23" --suite "Password Reset"
```

---

## Dry run

Every command supports `--dry-run`. Shows what would happen without calling Claude or making any ADO write operations.

```bash
node bin/testhelper.js --dry-run context build --from 2024-01-01 --to 2024-12-31
node bin/testhelper.js --dry-run run 12345
node bin/testhelper.js --dry-run design 12345
node bin/testhelper.js --dry-run publish --from-file tests.json --plan "Sprint 23"
```

---

## Local storage

Everything is stored under `.testhelper/` in the current directory:

```
.testhelper/
  context/           ← Business context docs per cluster  [committed to git]
  items/             ← Markdown file per work item        [committed to git]
  context-meta.json  ← Index of built clusters            [committed to git]
  vectors/           ← LanceDB vector index               [gitignored — rebuild locally]
  cache/             ← ADO API response cache             [gitignored — ephemeral]
  publish-state/     ← Checkpoint files for publisher     [gitignored — local only]
```

`testhelper init` sets up the gitignore automatically. The split means text content is shareable and reviewable via git, while binary/ephemeral data stays local.

---

## MCP Server (Claude Code integration)

TestHelper can run as an MCP server so Claude Code can call its capabilities as native tools — no CLI needed.

Add to `.claude/settings.json` (project-level) or `~/.claude/settings.json` (user-level):

```json
{
  "mcpServers": {
    "testhelper": {
      "command": "node",
      "args": ["D:/Projects/Tester/Tester/bin/testhelper-mcp.js"],
      "env": {
        "TESTHELPER_ADO_PAT": "your-pat",
        "TESTHELPER_ADO_ORG": "your-org",
        "TESTHELPER_ADO_PROJECT": "your-project"
      }
    }
  }
}
```

Available MCP tools: `fetch_work_items`, `vectorize_work_items`, `search_context`, `analyze_work_item`, `design_tests`, `publish_tests`, `full_pipeline`

---

## Global options

Available on every command:

| Option | Description |
|--------|-------------|
| `--dry-run` | Preview without calling Claude or writing to ADO |
| `--verbose` | Enable debug logging |
| `--config <path>` | Path to config file (default: `.testhelper.json`) |

---

## Configuration

`testhelper init` creates `.testhelper.json` with these defaults:

```json
{
  "ado": {
    "org": "${TESTHELPER_ADO_ORG}",
    "project": "${TESTHELPER_ADO_PROJECT}",
    "pat": "${TESTHELPER_ADO_PAT}"
  },
  "vectorizer": {
    "embeddingModel": "local"
  },
  "analyzer": {
    "model": "claude-sonnet-4-6",
    "defaultAnalyses": ["ambiguity", "gap", "testability"]
  },
  "designer": {
    "model": "claude-sonnet-4-6"
  },
  "cache": {
    "ttlMinutes": 15
  }
}
```

`${ENV_VAR}` values are interpolated at runtime — never store raw PATs in committed config files.
