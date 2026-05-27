import type { AnalyzedResult } from '../../analyzer/index.js';
import type { Verdict } from '../../types.js';
import type { ReportSummary } from '../index.js';

const VERDICT_LABEL: Record<Verdict, string> = {
  flaky: 'FLAKY',
  real_break: 'BREAK',
  inconclusive: 'INCONCLUSIVE',
  passing: 'PASS',
};

function renderTest(r: AnalyzedResult): string {
  const lines: string[] = [];
  lines.push('='.repeat(60));
  lines.push(`${VERDICT_LABEL[r.verdict]} [${r.flakinessScore}] ${r.suite} > ${r.testName}`);
  if (r.analysis) {
    lines.push(`Category:    ${r.analysis.rootCauseCategory} (confidence: ${r.analysis.confidence})`);
    lines.push(`Explanation: ${r.analysis.explanation}`);
    lines.push(`Fix:         ${r.analysis.suggestedFix}`);
  }
  if (r.failureMessage) {
    lines.push(`Failure:     ${r.failureMessage}`);
  }
  return lines.join('\n');
}

export function renderCli(results: AnalyzedResult[], summary: ReportSummary): string {
  const failing = results.filter((r) => r.verdict !== 'passing');
  const header = `Flaky Triager Report — ${summary.total} tests | ${summary.flaky} flaky | ${summary.realBreaks} breaks | ${summary.inconclusive} inconclusive | ${summary.passing} passing`;
  if (failing.length === 0) {
    return `${header}\n\nAll tests clean.`;
  }
  return [header, '', ...failing.map(renderTest)].join('\n');
}
