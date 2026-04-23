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

export async function initCommand(): Promise<void> {
  const configPath = path.join(process.cwd(), '.testhelper.json');
  const gitignorePath = path.join(process.cwd(), '.gitignore');

  if (fs.existsSync(configPath)) {
    console.log('.testhelper.json already exists — skipping.');
  } else {
    fs.writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n');
    console.log('Created .testhelper.json');
  }

  const gitignoreEntry = '.testhelper/';
  if (fs.existsSync(gitignorePath)) {
    const existing = fs.readFileSync(gitignorePath, 'utf-8');
    if (!existing.includes(gitignoreEntry)) {
      fs.appendFileSync(gitignorePath, `\n${gitignoreEntry}\n`);
      console.log('Added .testhelper/ to .gitignore');
    }
  } else {
    fs.writeFileSync(gitignorePath, `${gitignoreEntry}\n`);
    console.log('Created .gitignore with .testhelper/');
  }

  console.log(`
TestHelper initialized!

Set these environment variables before running commands:

  TESTHELPER_ADO_PAT=<your-personal-access-token>
  TESTHELPER_ADO_ORG=<your-organization>
  TESTHELPER_ADO_PROJECT=<your-project>

Or edit .testhelper.json directly (use \${ENV_VAR} for secrets).

Quickstart:
  testhelper fetch --ids 12345
  testhelper fetch --from 2024-01-01 --to 2024-01-31 --types "User Story,Bug"
`);
}
