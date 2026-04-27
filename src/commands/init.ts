import fs from 'fs';
import path from 'path';

const DEFAULT_CONFIG = {
  ado: {
    org: '${TESTHELPER_ADO_ORG}',
    project: '${TESTHELPER_ADO_PROJECT}',
    pat: '${TESTHELPER_ADO_PAT}',
    apiVersion: '7.1',
  },
  vectorizer: {
    embeddingModel: 'local',
  },
  analyzer: {
    model: 'claude-sonnet-4-6',
    defaultAnalyses: ['ambiguity', 'gap', 'testability'],
  },
  designer: {
    model: 'claude-sonnet-4-6',
  },
  cache: {
    ttlMinutes: 15,
  },
};

// These are local-only — binary/ephemeral, never shared via git
const GITIGNORE_ENTRIES = [
  '.testhelper/vectors/',
  '.testhelper/cache/',
  '.testhelper/publish-state/',
];

// These are shared via git — context docs and work item MDs
const GITIGNORE_COMMENT = '# testhelper: local-only (rebuild with: testhelper context rebuild)';

export async function initCommand(): Promise<void> {
  const configPath = path.join(process.cwd(), '.testhelper.json');
  const gitignorePath = path.join(process.cwd(), '.gitignore');

  // Config file
  if (fs.existsSync(configPath)) {
    console.log('.testhelper.json already exists — skipping.');
  } else {
    fs.writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n');
    console.log('Created .testhelper.json');
  }

  // .gitignore — only ignore local-only subdirectories, not the whole .testhelper/
  let gitignore = fs.existsSync(gitignorePath)
    ? fs.readFileSync(gitignorePath, 'utf-8')
    : '';

  // Migrate: if old blanket entry exists, replace it with granular entries
  if (gitignore.includes('.testhelper/\n') || gitignore.endsWith('.testhelper/')) {
    gitignore = gitignore.replace(/\.testhelper\/\n?/g, '');
    console.log('Migrated .gitignore: replaced .testhelper/ with granular entries');
  }

  const missing = GITIGNORE_ENTRIES.filter((entry) => !gitignore.includes(entry));
  if (missing.length > 0) {
    const block = ['\n' + GITIGNORE_COMMENT, ...missing].join('\n') + '\n';
    fs.appendFileSync(gitignorePath, block);
    console.log(`Added to .gitignore: ${missing.join(', ')}`);
  }

  // Create shared directories so git tracks them
  for (const dir of ['.testhelper/context', '.testhelper/items']) {
    fs.mkdirSync(path.join(process.cwd(), dir), { recursive: true });
    const keep = path.join(process.cwd(), dir, '.gitkeep');
    if (!fs.existsSync(keep)) fs.writeFileSync(keep, '');
  }

  console.log(`
TestHelper initialized!

Set these environment variables before running commands:

  TESTHELPER_ADO_PAT=<your-personal-access-token>
  TESTHELPER_ADO_ORG=<your-organization>
  TESTHELPER_ADO_PROJECT=<your-project>

Or edit .testhelper.json directly (use \${ENV_VAR} for secrets).

Team sharing:
  .testhelper/context/ and .testhelper/items/ are NOT gitignored.
  Commit them so teammates can pull and run:
    testhelper context rebuild

Quickstart:
  testhelper context build --from 2024-01-01 --to 2024-12-31
  testhelper run 12345
`);
}
