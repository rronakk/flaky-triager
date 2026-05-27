import type { AnalyzedResult } from '../analyzer/index.js';
import type { Verdict } from '../types.js';
import { renderMarkdown } from './formats/markdown.js';
import { renderCli } from './formats/cli.js';
import { renderJson } from './formats/json.js';

export const REPORT_MARKER = '<!-- flaky-triager:report -->';

export type ReportFormat = 'markdown' | 'cli' | 'json';

export interface ReportSummary {
  total: number;
  flaky: number;
  realBreaks: number;
  inconclusive: number;
  passing: number;
}

export function summarize(results: AnalyzedResult[]): ReportSummary {
  const summary: ReportSummary = {
    total: results.length,
    flaky: 0,
    realBreaks: 0,
    inconclusive: 0,
    passing: 0,
  };
  const bucketFor: Record<Verdict, keyof Omit<ReportSummary, 'total'>> = {
    flaky: 'flaky',
    real_break: 'realBreaks',
    inconclusive: 'inconclusive',
    passing: 'passing',
  };
  for (const r of results) {
    summary[bucketFor[r.verdict]]++;
  }
  return summary;
}

export function formatReport(results: AnalyzedResult[], format: ReportFormat): string {
  const summary = summarize(results);
  switch (format) {
    case 'markdown':
      return renderMarkdown(results, summary);
    case 'cli':
      return renderCli(results, summary);
    case 'json':
      return renderJson(results, summary);
  }
}
