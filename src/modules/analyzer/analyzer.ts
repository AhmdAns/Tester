import { callClaude } from '../../utils/claude-client.js';
import { logger } from '../../utils/logger.js';
import { ANALYZER_SYSTEM_PROMPT, buildAnalysisPrompt, formatReport } from './prompts.js';
import type { AnalysisReport, AnalyzeOptions } from './types.js';
import type { AnalysisType } from '../../config/schema.js';

export class Analyzer {
  private readonly model: string;

  constructor(opts: { model?: string } = {}) {
    this.model = opts.model ?? 'claude-sonnet-4-6';
  }

  async analyze(
    workItemId: number,
    workItemMd: string,
    analysisTypes: AnalysisType[],
    opts: AnalyzeOptions = {},
  ): Promise<AnalysisReport[]> {
    const reports: AnalysisReport[] = [];

    for (const analysisType of analysisTypes) {
      logger.info({ workItemId, analysisType }, 'Running analysis');
      const report = await this.runSingleAnalysis(
        workItemId,
        workItemMd,
        analysisType,
        opts.contextMd ?? '',
      );
      reports.push(report);
    }

    return reports;
  }

  private async runSingleAnalysis(
    workItemId: number,
    workItemMd: string,
    analysisType: AnalysisType,
    contextMd: string,
  ): Promise<AnalysisReport> {
    const userContent = buildAnalysisPrompt(analysisType, workItemMd, contextMd);

    process.stderr.write(`  → ${analysisType}... `);

    let accumulated = '';
    const raw = await callClaude(ANALYZER_SYSTEM_PROMPT, userContent, {
      model: this.model,
      onChunk: (text) => {
        accumulated += text;
      },
    });

    process.stderr.write('done\n');

    return this.parseResponse(workItemId, analysisType, raw);
  }

  private parseResponse(
    workItemId: number,
    analysisType: AnalysisType,
    raw: string,
  ): AnalysisReport {
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      const json = jsonMatch ? JSON.parse(jsonMatch[0]) : {};

      return {
        workItemId,
        analysisType,
        timestamp: new Date().toISOString(),
        severity: json.severity ?? 'info',
        findings: Array.isArray(json.findings) ? json.findings : [],
        recommendations: Array.isArray(json.recommendations) ? json.recommendations : [],
        relatedItems: Array.isArray(json.relatedItems) ? json.relatedItems : [],
      };
    } catch {
      logger.warn({ workItemId, analysisType }, 'Failed to parse analysis JSON, returning raw');
      return {
        workItemId,
        analysisType,
        timestamp: new Date().toISOString(),
        severity: 'info',
        findings: [{ location: 'response', description: raw }],
        recommendations: [],
        relatedItems: [],
      };
    }
  }

  formatReports(reports: AnalysisReport[]): string {
    return reports.map((r) => formatReport(r, r.workItemId)).join('\n\n---\n\n');
  }
}
