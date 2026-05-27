import type { AnalyzedResult } from '../../analyzer/index.js';
import type { ReportSummary } from '../index.js';

export function renderJson(results: AnalyzedResult[], summary: ReportSummary): string {
  return JSON.stringify({ summary, results }, null, 2);
}
