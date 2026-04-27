import type { WorkItem } from '../fetcher/types.js';

export type ClusterType = 'area' | 'epic' | 'ungrouped';

export interface WorkItemCluster {
  id: string;
  name: string;
  type: ClusterType;
  areaPath: string;
  epicId?: number;
  items: WorkItem[];
}

export interface ContextDocument {
  clusterId: string;
  clusterName: string;
  clusterType: ClusterType;
  areaPath: string;
  itemCount: number;
  workItemIds: number[];
  lastBuilt: string;
  content: string;
}

export interface ContextMeta {
  builtAt: string;
  totalItems: number;
  clusters: Array<{
    id: string;
    name: string;
    type: ClusterType;
    itemCount: number;
  }>;
}

export interface ContextBuildOptions {
  maxItemsPerCluster?: number;
}
