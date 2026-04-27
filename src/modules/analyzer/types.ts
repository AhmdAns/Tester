import type { AnalysisType } from '../../config/schema.js';

export type { AnalysisType };

export interface Finding {
  location: string;
  description: string;
  suggestion?: string;
}

export interface Recommendation {
  priority: 'critical' | 'high' | 'medium' | 'low';
  action: string;
  rationale: string;
}

export interface AnalysisReport {
  workItemId: number;
  analysisType: AnalysisType;
  timestamp: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  findings: Finding[];
  recommendations: Recommendation[];
  relatedItems: number[];
}

export interface AnalyzeOptions {
  model?: string;
  contextMd?: string;
}
