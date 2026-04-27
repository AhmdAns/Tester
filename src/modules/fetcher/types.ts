export type WorkItemType =
  | 'Bug'
  | 'User Story'
  | 'Task'
  | 'Epic'
  | 'Feature'
  | 'Test Case'
  | 'Test Plan'
  | 'Test Suite'
  | string;

export interface WorkItemRelation {
  type: string;
  id: number;
  title: string;
  url: string;
}

export interface Attachment {
  id: string;
  name: string;
  url: string;
  size: number;
}

export interface RevisionEntry {
  rev: number;
  changedDate: string;
  changedBy: string;
  fields: Record<string, { oldValue: unknown; newValue: unknown }>;
}

export interface WorkItem {
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

export interface FetchByDateRangeOptions {
  org: string;
  project: string;
  pat: string;
  from: string;
  to: string;
  types?: WorkItemType[];
  areaPath?: string;
  iterationPath?: string;
  includeRelations?: boolean;
  includeAttachments?: boolean;
}

export interface FetchByIdsOptions {
  org: string;
  project: string;
  pat: string;
  ids: number[];
  includeRelations?: boolean;
}

export interface FetchByWiqlOptions {
  org: string;
  project: string;
  pat: string;
  query: string;
}
