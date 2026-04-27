# TestHelper — Comprehensive Build Plan
### An npm CLI Library for AI-Powered Test Engineering via Claude Code

---

## Executive Summary

TestHelper is an npm-installable CLI tool designed to be invoked by Claude Code (and other AI agents) during testing tasks. It bridges Azure DevOps work item management, semantic knowledge retrieval, intelligent analysis, and test design into a single, composable pipeline. The library exposes both a CLI interface and a programmatic Node.js API, making it natively usable as an MCP (Model Context Protocol) server so Claude Code can call its capabilities as tools mid-task.

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        Claude Code                          │
│  (invokes TestHelper via MCP tools or CLI subprocess calls) │
└─────────────────────┬───────────────────────────────────────┘
                      │ MCP protocol / CLI
┌─────────────────────▼───────────────────────────────────────┐
│                  TestHelper CLI / MCP Server                 │
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │  Fetcher    │  │  Vectorizer │  │    Analyzer         │ │
│  │  Module     │  │  Module     │  │    Module           │ │
│  │  (ADO API)  │  │  (MD+Embed) │  │  (AI-powered)       │ │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘ │
│         │                │                     │            │
│  ┌──────▼──────────────────▼─────────────────────▼────────┐ │
│  │              Knowledge Store (local .testhelper/)       │ │
│  │         MD files + vector index (LanceDB/FAISS)        │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │               Test Designer Module                      │ │
│  │  (RAG-powered, context-aware, ADO-compatible output)   │ │
│  └──────────────────────────┬──────────────────────────────┘ │
│                             │                               │
│  ┌──────────────────────────▼──────────────────────────────┐ │
│  │               ADO Publisher Module                      │ │
│  │         (REST API + Azure Test Plans MCP)              │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Repository Structure

```
testhelper/
├── package.json
├── tsconfig.json
├── README.md
├── bin/
│   └── testhelper.js            # CLI entry point (shebang)
├── src/
│   ├── index.ts                 # Programmatic API exports
│   ├── mcp-server.ts            # MCP server entry point
│   ├── cli.ts                   # CLI command definitions (commander.js)
│   ├── config/
│   │   ├── schema.ts            # Zod config schema
│   │   └── loader.ts            # Config file resolution (~/.testhelperrc / .testhelper.json)
│   ├── modules/
│   │   ├── fetcher/
│   │   │   ├── ado-client.ts    # Azure DevOps REST API client
│   │   │   ├── fetcher.ts       # Work item fetch logic
│   │   │   └── types.ts
│   │   ├── vectorizer/
│   │   │   ├── md-builder.ts    # Work item → Markdown conversion
│   │   │   ├── embedder.ts      # Embedding generation
│   │   │   ├── store.ts         # LanceDB vector store wrapper
│   │   │   └── types.ts
│   │   ├── analyzer/
│   │   │   ├── analyzer.ts      # Analysis orchestration
│   │   │   ├── prompts.ts       # Analysis prompt templates
│   │   │   └── types.ts
│   │   ├── designer/
│   │   │   ├── designer.ts      # Test design orchestration
│   │   │   ├── retriever.ts     # RAG retrieval logic
│   │   │   ├── formatter.ts     # ADO-compatible output formatter
│   │   │   ├── prompts.ts
│   │   │   └── types.ts
│   │   └── publisher/
│   │       ├── publisher.ts     # Push tests to ADO Test Plans
│   │       ├── ado-test-client.ts
│   │       └── types.ts
│   └── utils/
│       ├── logger.ts
│       ├── cache.ts
│       └── retry.ts
├── .testhelper/                 # Local knowledge store (gitignored)
│   ├── items/                  # Raw MD files per work item
│   ├── vectors/                # LanceDB data
│   └── meta.json               # Index metadata
└── tests/
    ├── unit/
    └── integration/
```

---

## 3. Module Breakdown

### 3.1 Fetcher Module

**Purpose:** Connect to Azure DevOps and retrieve work items using flexible query strategies.

**Key Functions:**

```typescript
// By date/time range
fetchByDateRange(options: {
  org: string;
  project: string;
  pat: string;
  from: string;          // ISO 8601
  to: string;            // ISO 8601
  types?: WorkItemType[]; // Bug, User Story, Task, Epic, Feature...
  areaPath?: string;
  iterationPath?: string;
  includeRelations?: boolean;
  includeAttachments?: boolean;
}): Promise<WorkItem[]>

// By explicit IDs
fetchByIds(options: {
  org: string;
  project: string;
  pat: string;
  ids: number[];
  includeRelations?: boolean;
}): Promise<WorkItem[]>

// By WIQL query
fetchByWiql(options: {
  org: string;
  project: string;
  pat: string;
  query: string;        // Raw WIQL
}): Promise<WorkItem[]>
```

**Implementation Details:**
- Uses ADO REST API v7.1: `https://dev.azure.com/{org}/{project}/_apis/wit/workitems`
- Batch fetches in chunks of 200 (ADO limit) with retry + exponential backoff
- Resolves linked work items transitively (parent/child/related/blocks)
- Fetches revision history for change context
- Caches responses to `.testhelper/cache/` with TTL (configurable, default 15 min)
- PAT stored in env var `TESTHELPER_ADO_PAT` or config file, never hardcoded

**Work Item Data Model:**
```typescript
interface WorkItem {
  id: number;
  type: WorkItemType;
  title: string;
  description: string;
  acceptanceCriteria: string;
  state: string;
  priority: number;
  assignedTo: string;
  areaPath: string;
  iterationPath: string;
  tags: string[];
  relations: WorkItemRelation[];
  attachments: Attachment[];
  history: RevisionEntry[];
  createdDate: string;
  changedDate: string;
  rawFields: Record<string, unknown>;
}
```

---

### 3.2 Vectorizer Module

**Purpose:** Transform raw work items into semantically rich Markdown files and index them in a local vector store for RAG retrieval.

**MD File Structure (per work item):**

```markdown
---
id: 12345
type: User Story
title: "As a user, I can reset my password"
state: Active
priority: 2
iteration: Sprint 23
area: MyApp/Auth
tags: [security, authentication]
relations:
  - type: parent
    id: 12300
    title: "Authentication Epic"
  - type: child
    id: [12346, 12347]
  - type: related
    id: [11900]
---

# [US-12345] As a user, I can reset my password

## Description
{full description text}

## Acceptance Criteria
{structured AC — may be HTML, normalized to MD}

## Relations Context
### Parent: [Epic-12300] Authentication Epic
{parent description excerpt}

### Children
- [Task-12346] Implement reset email flow
- [Task-12347] Implement reset token validation

## Change History
| Date | Author | Change |
|------|--------|--------|
| ... | ... | ... |

## Tags
security, authentication
```

**Embedding Strategy:**
- Chunk each MD file into semantic segments: title+AC, description, relations context, history
- Generate embeddings per chunk using a local model (default: `@xenova/transformers` with `all-MiniLM-L6-v2` — runs entirely offline, no API cost)
- Alternatively support OpenAI `text-embedding-3-small` for higher quality (configurable)
- Store in LanceDB (embedded, no server required, written in Rust, fast similarity search)

**Key Functions:**
```typescript
vectorizeItems(items: WorkItem[], options?: VectorizeOptions): Promise<void>
// Converts to MD, saves to .testhelper/items/, indexes into LanceDB

rebuildIndex(): Promise<void>
// Full reindex from existing MD files

search(query: string, topK: number): Promise<SearchResult[]>
// Semantic similarity search

getItem(id: number): Promise<WorkItem | null>
// Direct lookup by ID from MD files
```

---

### 3.3 Analyzer Module

**Purpose:** Run AI-powered analysis passes over work items to surface actionable intelligence before test design.

**Analysis Types:**

| Analysis | Description |
|----------|-------------|
| `ambiguity` | Identifies vague language, missing acceptance criteria, undefined edge cases, unclear actors |
| `gap` | Finds missing requirements: unspecified error states, missing non-functional requirements, absent boundary definitions |
| `overlap` | Detects functional duplication between work items that may cause conflicting implementations |
| `contradiction` | Finds logically conflicting requirements across work items (e.g., US-A says field required, US-B says optional) |
| `dependency` | Maps implicit and explicit dependency chains not captured in ADO relations |
| `impact` | Given a change to a work item, surfaces all downstream work items and tests likely to be affected |
| `completeness` | Scores work items against a completeness rubric (has AC, has description, has priority, is sized, etc.) |
| `testability` | Scores whether each acceptance criterion is directly testable as written |

**Implementation:**

Each analysis type is a prompt template + RAG retrieval pipeline:

```
User Story + Related Context (via vector search)
        ↓
Analyzer Prompt (role: senior BA + QA architect)
        ↓
Structured JSON output
        ↓
Formatted report (MD or JSON)
```

**Output Format:**
```typescript
interface AnalysisReport {
  workItemId: number;
  analysisType: AnalysisType;
  timestamp: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  findings: Finding[];
  recommendations: Recommendation[];
  relatedItems: number[]; // other WI IDs referenced
}
```

Reports are saved to `.testhelper/reports/` and can be aggregated across multiple work items.

---

### 3.4 Test Designer Module

**Purpose:** Generate comprehensive, best-practice test suites for user stories using full project context — not just the story in isolation.

**Design Philosophy:**
- Tests are designed against the **intended system behavior**, not just the text of the user story
- Context includes: parent epic, sibling stories, related tasks, historical bugs, NFR items
- Test structure follows **IEEE 829 / ISTQB** conventions adapted for Azure Test Plans
- Coverage model: functional, boundary, negative, integration, regression hooks, accessibility (where applicable), security (where applicable)

**Retrieval Strategy (RAG):**
```
For Work Item X:
1. Direct fetch: WI-X full content
2. Vector search: top-10 semantically similar items
3. Relation traversal: parent epic, sibling stories in same iteration, child tasks
4. Historical bugs: search for WIs tagged as Bug in same area path
5. NFR items: search for Performance/Security/Compliance items in same area

→ Token budget check (target: ≤ 80k tokens for context)
→ If over budget, apply priority truncation:
     Priority 1 (always included): direct WI full content
     Priority 2: AC fields of directly related WIs
     Priority 3: descriptions of related WIs
     Priority 4: history and low-relevance vector results (drop first)
→ Assembled context window (de-duped, ranked by relevance)
→ Test Design Prompt
→ Structured test output
```

**Test Case Structure (ADO Compatible):**
```typescript
interface TestCase {
  title: string;                    // Max 255 chars
  description: string;              // Test objective
  priority: 1 | 2 | 3 | 4;
  areaPath: string;                 // Inherited from WI
  iterationPath: string;
  automationStatus: 'Not Automated' | 'Planned' | 'Automated';
  tags: string[];
  steps: TestStep[];
  associatedWorkItems: number[];    // Links back to US, Epic, Bug
  testType: TestType;
  preconditions: string;
  expectedOutcome: string;
}

interface TestStep {
  stepNumber: number;
  action: string;          // What to do
  expectedResult: string;  // What should happen
  testData?: string;       // Specific data values
}

type TestType =
  | 'Happy Path'
  | 'Boundary Value'
  | 'Negative / Error'
  | 'Integration'
  | 'Security'
  | 'Performance'
  | 'Accessibility'
  | 'Regression Hook'
  | 'Edge Case';
```

**Coverage Requirements enforced by prompt:**
- At least 1 happy path per acceptance criterion
- Boundary value tests for all numeric inputs, date ranges, text length limits
- Negative tests for all validation rules stated or implied
- At least 1 unauthorized access test for any authenticated feature
- Integration test for each external system dependency
- At least 1 regression hook test per bug found in the same area

**Output Formats:**
- JSON (for programmatic use / ADO push)
- Markdown table (for review in Claude Code chat)
- CSV (importable to Azure Test Plans via native import)
- XLSX (for stakeholder review)

---

### 3.5 Publisher Module

**Purpose:** Push generated test cases directly into Azure DevOps Test Plans.

**Two Integration Paths:**

**Path A — REST API (always available):**
```typescript
// 1. Create Test Cases as Work Items
POST https://dev.azure.com/{org}/{project}/_apis/wit/workitems/$Test%20Case

// 2. Create Test Plan (if not exists)
POST https://dev.azure.com/{org}/{project}/_apis/testplan/plans

// 3. Create Test Suite under plan
POST https://dev.azure.com/{org}/{project}/_apis/testplan/plans/{planId}/suites

// 4. Add Test Cases to Suite
POST https://dev.azure.com/{org}/{project}/_apis/testplan/plans/{planId}/suites/{suiteId}/testcase

// 5. Create test steps via PATCH (HTML formatted for ADO)
PATCH https://dev.azure.com/{org}/{project}/_apis/wit/workitems/{id}
  field: Microsoft.VSTS.TCM.Steps (XML format)
```

**Path B — Azure DevOps MCP (when available):**

If the user has the Azure DevOps MCP server configured, TestHelper detects it and delegates publish operations through the MCP protocol, giving Claude Code full visibility into the publish operation and enabling interactive corrections.

```typescript
// mcp-server.ts exposes publish as a tool:
{
  name: "testhelper_publish",
  description: "Push test cases to Azure DevOps Test Plans",
  input_schema: {
    testCases: TestCase[],
    planName: string,
    suiteName: string,
    associatedUserStoryId: number
  }
}
```

**Publish Flow:**
```
1. Validate ADO connection + permissions
2. Resolve or create Test Plan (by name or ID)
3. Resolve or create Test Suite (named after User Story)
4. For each TestCase:
   a. Create Work Item (type: Test Case)
   b. Set Microsoft.VSTS.TCM.Steps field (XML)
   c. Link to User Story (Tested By relation)
   d. Assign to iteration + area path
5. Add all Test Cases to Suite
6. Return publish summary (plan URL, suite URL, IDs)
```

---

## 4. MCP Server Interface

TestHelper runs as an MCP server so Claude Code can call its capabilities as native tools without subprocess management.

**Exposed Tools:**

```typescript
const tools = [
  {
    name: "fetch_work_items",
    description: "Fetch work items from Azure DevOps by date range or IDs",
    inputSchema: { /* fetch options */ }
  },
  {
    name: "vectorize_work_items",
    description: "Index fetched work items into local vector store for semantic retrieval",
    inputSchema: { itemIds?: number[] }
  },
  {
    name: "search_context",
    description: "Semantic search across indexed work items",
    inputSchema: { query: string; topK?: number }
  },
  {
    name: "analyze_work_item",
    description: "Run analysis passes (ambiguity, gaps, contradictions, etc.)",
    inputSchema: { id: number; analyses: AnalysisType[] }
  },
  {
    name: "design_tests",
    description: "Generate comprehensive test cases for a user story using full project context",
    inputSchema: { userStoryId: number; options?: DesignOptions }
  },
  {
    name: "publish_tests",
    description: "Push designed test cases to Azure DevOps Test Plans",
    inputSchema: { testCases: TestCase[]; planName: string; suiteName: string }
  },
  {
    name: "full_pipeline",
    description: "Run the entire pipeline: fetch → vectorize → analyze → design → publish",
    inputSchema: { userStoryId: number; publishImmediately?: boolean }
  }
]
```

**MCP Server Registration (.claude/settings.json — for Claude Code):**
```json
{
  "mcpServers": {
    "testhelper": {
      "command": "npx",
      "args": ["-y", "testhelper", "--mcp"],
      "env": {
        "TESTHELPER_ADO_PAT": "your-pat-here",
        "TESTHELPER_ADO_ORG": "your-org",
        "TESTHELPER_ADO_PROJECT": "your-project"
      }
    }
  }
}
```

> Note: Claude Desktop users register MCP servers in `claude_desktop_config.json` with the same structure but without the `-y` flag on `npx`. Claude Code uses `.claude/settings.json` (project-level) or `~/.claude/settings.json` (user-level).

---

## 5. CLI Interface

```bash
# Installation
npm install -g testhelper

# Global flags (available on all commands)
#   --dry-run     Show what would happen without calling LLMs or ADO write APIs
#   --verbose     Enable debug logging
#   --config      Path to config file (overrides default resolution)

# Configure
testhelper init
# → creates .testhelper.json in current dir or ~/.testhelperrc

# Fetch work items
testhelper fetch --from "2024-01-01" --to "2024-01-31"
testhelper fetch --ids 12345,12346,12347
testhelper fetch --ids 12345 --include-relations

# Vectorize
testhelper vectorize                     # vectorize all fetched items
testhelper vectorize --ids 12345,12346   # specific items only
testhelper rebuild-index                 # full reindex

# Search
testhelper search "password reset flow"
testhelper search "authentication" --top 5

# Analyze
testhelper analyze 12345 --type all
testhelper analyze 12345 --type ambiguity,gap,contradiction
testhelper analyze --ids 12345,12346 --type overlap

# Design tests
testhelper design 12345
testhelper design 12345 --format json
testhelper design 12345 --format csv
testhelper design 12345 --output ./tests/

# Publish
testhelper publish --from-file tests/12345-tests.json --plan "Sprint 23 Tests" --suite "US-12345"
testhelper publish --story 12345 --plan "Sprint 23 Tests"  # design + publish in one step

# Full pipeline
testhelper run 12345
testhelper run --ids 12345,12346 --publish
```

---

## 6. Configuration Schema

```json
{
  "ado": {
    "org": "my-org",
    "project": "my-project",
    "pat": "${TESTHELPER_ADO_PAT}",
    "apiVersion": "7.1"
  },
  "vectorizer": {
    "embeddingModel": "local",
    "localModel": "Xenova/all-MiniLM-L6-v2",
    "openaiModel": "text-embedding-3-small",
    "chunkStrategy": "semantic",
    "storeDir": ".testhelper"
  },
  "analyzer": {
    "llmProvider": "anthropic",
    "model": "claude-sonnet-4-6",
    "defaultAnalyses": ["ambiguity", "gap", "testability"]
  },
  "designer": {
    "llmProvider": "anthropic",
    "model": "claude-sonnet-4-6",
    "contextTopK": 10,
    "coverageRules": {
      "requireHappyPath": true,
      "requireBoundaryValues": true,
      "requireNegativeTests": true,
      "requireSecurityTest": "auto",
      "requireA11yTest": "auto"
    },
    "defaultOutputFormat": "json"
  },
  "publisher": {
    "defaultPlanName": "TestHelper Generated",
    "defaultAreaPath": "",
    "defaultIterationPath": "",
    "automationStatus": "Not Automated",
    "dryRun": false
  },
  "cache": {
    "ttlMinutes": 15,
    "dir": ".testhelper/cache"
  }
}
```

---

## 7. Technology Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Language | TypeScript 5.x | Type safety, Claude Code native |
| CLI framework | Commander.js | Mature, well-typed |
| ADO HTTP client | Axios + azure-devops-node-api | Official SDK available |
| Vector store | LanceDB (@lancedb/lancedb npm) | Embedded, no server, Rust-backed, fast |
| Embedding model (local) | @huggingface/transformers (WASM) | Fully offline, no API key needed |
| Embedding model (cloud) | OpenAI API | Optional upgrade path |
| LLM (analysis + design) | Anthropic API (Claude Sonnet 4.6) | Best reasoning quality |
| MCP server | @modelcontextprotocol/sdk | Official MCP SDK |
| Schema validation | Zod | Runtime type safety |
| MD generation | unified / remark | Robust AST-based MD |
| Test output | exceljs (XLSX), csv-stringify | ADO import compatibility |
| Logging | pino | Structured, fast |
| Testing | Vitest | Fast, TS-native |
| Build | tsup | Zero-config bundler |

---

## 8. Security Considerations

- PAT tokens are **never** logged, stored in plain `.testhelper/` files, or included in error output
- PAT resolution order: CLI flag → env var → config file → interactive prompt
- Config file PAT values support `${ENV_VAR}` interpolation — never store raw PATs in committed config
- `.testhelper/` is added to `.gitignore` automatically by `testhelper init`
- All ADO API calls use HTTPS only
- LanceDB vector store and MD files contain work item text — teams should evaluate data residency requirements for sensitive projects

---

## 9. Implementation Phases

### Phase 1 — Foundation (Weeks 1–2)
- Project scaffold (tsup, tsconfig, package.json, bin entry)
- Config loader + Zod schema
- ADO client with PAT auth, retry logic, batch fetch
- `fetch` CLI command (by date range and by IDs)
- Unit tests for fetcher
- README with quickstart

### Phase 2 — Knowledge Store (Weeks 3–4)
- MD builder (work item → structured MD)
- Local embedding with @huggingface/transformers (WASM) — validate Windows WASM path compatibility as first checkpoint
- LanceDB (@lancedb/lancedb) integration (store + search)
- Model warm-up + first-run download progress indicator
- `vectorize` and `search` CLI commands
- Integration tests with mock ADO data

### Phase 3 — Analysis Engine (Weeks 5–6)
- Anthropic API integration (single shared client instance, injected into modules)
- Prompt caching on system prompts + static analysis templates (`cache_control: ephemeral`)
- Prompt templates for all 8 analysis types
- RAG retrieval pipeline
- Streaming LLM responses piped to CLI output (no silent waits)
- `analyze` CLI command with `--dry-run` support (prints assembled prompt + context, skips LLM call)
- Output formatter (MD reports)

### Phase 4 — Test Designer (Weeks 7–9)
- Context assembly (RAG + relation traversal) with token budget enforcement (≤ 80k, priority truncation)
- Prompt caching on design system prompt + static coverage rules
- Test design prompt (with coverage rules enforcement)
- Streaming LLM response to CLI with incremental test case display
- Structured output parser + validator
- Output formatters: JSON, MD, CSV, XLSX
- `design` CLI command with `--dry-run` support (prints assembled context + token count, skips LLM call)
- Test design quality eval suite (manual review of 20 real stories)

### Phase 5 — Publisher (Weeks 10–11)
- ADO Test Plans REST client
- Plan/suite resolution and creation
- Test Case work item creation with steps (XML format)
- Work item linking (Tested By)
- Checkpoint file (`.testhelper/publish-state/{runId}.json`) tracking published IDs — retry skips already-published cases to prevent duplicates
- Progress output: streaming publish status per test case (e.g., "Publishing [3/18] TC: Happy path — valid credentials")
- `publish` CLI command with `--dry-run` support (validates ADO connection + permissions, prints plan but makes no writes)
- `full_pipeline` compound command (fetch → vectorize → analyze → design → publish) with per-step progress and `--no-publish` flag to stop before push

### Phase 6 — MCP Server (Week 12)
- MCP server entry point with @modelcontextprotocol/sdk
- All 7 tools exposed
- Claude Desktop / Claude Code config documentation
- End-to-end integration test (Claude Code → MCP → ADO)

### Phase 7 — Polish & Release (Weeks 13–14)
- Error handling hardening + user-friendly messages
- WASM model warm-up progress indicator (first-run download of ~90MB embedding weights)
- ADO rate-limit header logging (`X-RateLimit-Remaining`) for large fetches
- npm publish setup (scoped: `@yourorg/testhelper` or public `testhelper`)
- GitHub Actions CI (lint, test, publish on tag)
- Full documentation site (or README + CHANGELOG)

---

## 10. Example End-to-End Workflow

**Scenario:** QA Engineer asks Claude Code: *"Design tests for user story 12345 and push them to Azure Test Plans."*

```
Claude Code invokes:
  1. testhelper_fetch({ ids: [12345], includeRelations: true })
     → Returns US-12345 + parent Epic-12300 + 3 child tasks + 2 related bugs

  2. testhelper_vectorize({ itemIds: [12345, 12300, 12346, 12347, 11800, 11820] })
     → MD files written, embeddings indexed

  3. testhelper_analyze({ id: 12345, analyses: ['ambiguity', 'gap', 'testability'] })
     → Finds: "AC #3 uses vague term 'shortly'" → flags for Claude to mention to user
     → Finds: "No error state defined for network timeout"
     → Claude surfaces these to QA engineer before proceeding

  4. testhelper_design({ userStoryId: 12345 })
     → Retrieves context: US + Epic + child tasks + related bugs + NFR items from same area
     → Generates 18 test cases covering:
        - 4 happy path (one per AC)
        - 5 boundary value (input limits, timeout thresholds)  
        - 4 negative (invalid input, unauthorized, duplicate submission)
        - 2 integration (email service, token service)
        - 1 security (session fixation after password change)
        - 1 regression hook (covers bug 11800: "reset link expired too early")
        - 1 accessibility (keyboard navigation through reset flow)

  5. testhelper_publish({
       testCases: [...18 cases...],
       planName: "Sprint 23 — Auth Module",
       suiteName: "US-12345: Password Reset"
     })
     → Creates Test Plan (if new)
     → Creates Test Suite
     → Creates 18 Test Case work items with full steps
     → Links all to US-12345
     → Returns: Plan URL, Suite URL, 18 Test Case IDs

Claude Code reports back to QA engineer:
  "18 test cases published to Azure Test Plans. I flagged 2 ambiguities in the
   acceptance criteria — you may want to clarify with the BA before test execution."
```

---

## 11. Key Design Decisions & Rationale

**Why LanceDB over Pinecone/Weaviate?**
LanceDB is embedded (no server process), written in Rust (fast), stores data locally (no cloud dependency or data residency concern), and installs as a pure npm package. Ideal for a CLI tool.

**Why local embeddings by default?**
Work items often contain sensitive business logic. Running embeddings locally with `@huggingface/transformers` (WASM in Node) avoids sending data to external APIs. Quality is sufficient for retrieval tasks. Teams can opt into OpenAI embeddings for higher precision.

**WASM embedding performance caveat:** On first use, `@huggingface/transformers` downloads ~90MB of model weights and compiles them in WASM — this takes 15–30 seconds. After the first run the model is cached locally and subsequent embeddings run at ~100ms/chunk. TestHelper shows an explicit first-run progress indicator and caches the model in `.testhelper/model-cache/`. On some Windows environments the WASM runtime can have path issues — this should be tested as an early Phase 2 checkpoint.

**Why Claude Sonnet 4 for analysis and design?**
The analysis and test design tasks require sustained reasoning across large context windows with nuanced judgment about completeness and coverage. Sonnet 4 provides the best quality/cost ratio for this use case.

**Why MCP + CLI (not just one)?**
The CLI enables standalone use by humans and scripting in CI. The MCP server enables Claude Code to call TestHelper as a native tool with structured I/O, streaming progress, and direct integration into the AI agent's reasoning loop — no prompt engineering required to parse CLI output.

**Why not use azure-devops-node-api for test steps?**
The official SDK does not fully support the `Microsoft.VSTS.TCM.Steps` XML field format required for structured test steps. Direct REST calls with the correct XML schema give full control over step structure.

**Why a single shared Anthropic client?**
Both the analyzer and designer modules make Claude API calls. Instantiating one client and injecting it (rather than constructing per-module) enables connection reuse, centralized retry logic, and unified prompt caching configuration. The shared client is initialized in `src/index.ts` and passed as a dependency.

**Why prompt caching on analysis and design prompts?**
System prompts and static coverage-rule instructions are identical across calls for different work items. Marking these with `cache_control: {type: "ephemeral"}` lets the Anthropic API cache the prompt prefix across calls within a 5-minute window, cutting input token costs by up to 90% for batch analysis runs.

---

*TestHelper v1 — Architecture Plan*
*Revision 1.1 — Updated: package names (@huggingface/transformers, @lancedb/lancedb), model IDs (claude-sonnet-4-6), MCP registration format, prompt caching, token budget management, streaming, dry-run global flag, checkpoint/resume for publisher, full_pipeline moved to Phase 5, WASM caveat documented*
