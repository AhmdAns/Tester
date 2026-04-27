export { Fetcher } from './modules/fetcher/fetcher.js';
export type {
  WorkItem,
  WorkItemType,
  WorkItemRelation,
  Attachment,
  RevisionEntry,
  FetchByDateRangeOptions,
  FetchByIdsOptions,
  FetchByWiqlOptions,
} from './modules/fetcher/types.js';

export { Vectorizer } from './modules/vectorizer/vectorizer.js';
export type { SearchResult, VectorizeOptions } from './modules/vectorizer/types.js';

export { Analyzer } from './modules/analyzer/analyzer.js';
export type { AnalysisReport, Finding, Recommendation } from './modules/analyzer/types.js';

export { Designer } from './modules/designer/designer.js';
export type { TestCase, TestStep, TestType, DesignOptions } from './modules/designer/types.js';
export { toJson, toMarkdown, toCsv, toXlsx, saveOutput } from './modules/designer/formatter.js';

export { Publisher } from './modules/publisher/publisher.js';
export type { PublishOptions, PublishResult } from './modules/publisher/types.js';

export { loadConfig } from './config/loader.js';
export type { Config, AnalysisType } from './config/schema.js';
