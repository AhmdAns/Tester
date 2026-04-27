import { z } from 'zod';

const analysisTypeEnum = z.enum([
  'ambiguity',
  'gap',
  'overlap',
  'contradiction',
  'dependency',
  'impact',
  'completeness',
  'testability',
]);

export const configSchema = z.object({
  ado: z.object({
    org: z.string().default(''),
    project: z.string().default(''),
    pat: z.string().default(''),
    apiVersion: z.string().default('7.1'),
  }),
  vectorizer: z
    .object({
      embeddingModel: z.enum(['local', 'openai']).default('local'),
      localModel: z.string().default('Xenova/all-MiniLM-L6-v2'),
      openaiModel: z.string().default('text-embedding-3-small'),
      chunkStrategy: z.enum(['semantic', 'fixed']).default('semantic'),
      storeDir: z.string().default('.testhelper'),
    })
    .default({}),
  analyzer: z
    .object({
      llmProvider: z.enum(['anthropic']).default('anthropic'),
      model: z.string().default('claude-sonnet-4-6'),
      defaultAnalyses: z.array(analysisTypeEnum).default(['ambiguity', 'gap', 'testability']),
    })
    .default({}),
  designer: z
    .object({
      llmProvider: z.enum(['anthropic']).default('anthropic'),
      model: z.string().default('claude-sonnet-4-6'),
      contextTopK: z.number().int().positive().default(10),
      coverageRules: z
        .object({
          requireHappyPath: z.boolean().default(true),
          requireBoundaryValues: z.boolean().default(true),
          requireNegativeTests: z.boolean().default(true),
          requireSecurityTest: z.union([z.boolean(), z.literal('auto')]).default('auto'),
          requireA11yTest: z.union([z.boolean(), z.literal('auto')]).default('auto'),
        })
        .default({}),
      defaultOutputFormat: z.enum(['json', 'md', 'csv', 'xlsx']).default('json'),
    })
    .default({}),
  publisher: z
    .object({
      defaultPlanName: z.string().default('TestHelper Generated'),
      defaultAreaPath: z.string().default(''),
      defaultIterationPath: z.string().default(''),
      automationStatus: z
        .enum(['Not Automated', 'Planned', 'Automated'])
        .default('Not Automated'),
      dryRun: z.boolean().default(false),
    })
    .default({}),
  cache: z
    .object({
      ttlMinutes: z.number().int().positive().default(15),
      dir: z.string().default('.testhelper/cache'),
    })
    .default({}),
});

export type Config = z.infer<typeof configSchema>;
export type AnalysisType = z.infer<typeof analysisTypeEnum>;
