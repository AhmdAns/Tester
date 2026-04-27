export interface PublishOptions {
  org: string;
  project: string;
  pat: string;
  planName: string;
  suiteName: string;
  associatedUserStoryId?: number;
  areaPath?: string;
  iterationPath?: string;
  automationStatus?: 'Not Automated' | 'Planned' | 'Automated';
  dryRun?: boolean;
  checkpointDir?: string;
}

export interface PublishResult {
  planId: number;
  planUrl: string;
  suiteId: number;
  suiteUrl: string;
  testCaseIds: number[];
  skipped: number;
}

export interface PublishState {
  runId: string;
  planId: number;
  suiteId: number;
  publishedIds: number[];
  timestamp: string;
}
