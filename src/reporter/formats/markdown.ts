import type { AnalyzedResult } from '../../analyzer/index.js';
import type { Verdict } from '../../types.js';
import type { ReportSummary } from '../index.js';
import { REPORT_MARKER } from '../index.js';

const VERDICT_LABEL: Record<Verdict, string> = {
  flaky: 'FLAKY',
  real_break: 'BREAK',
  inconclusive: 'INCONCLUSIVE',
  passing: 'PASS',
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderTestBlock(r: AnalyzedResult): string {
  const badge = `**${VERDICT_LABEL[r.verdict]}**`;
  const heading = `${badge} \`${escapeHtml(r.suite)} > ${escapeHtml(r.testName)}\` — score ${r.flakinessScore}`;
  const a = r.analysis;
  const body = a
    ? [
        `**Category:** ${escapeHtml(a.rootCauseCategory)} (confidence: ${a.confidence})`,
        '',
        `**Explanation:** ${escapeHtml(a.explanation)}`,
        '',
        `**Suggested fix:** ${escapeHtml(a.suggestedFix)}`,
      ].join('\n')
    : '_No LLM analysis available._';

  const failureBlock = r.failureMessage
    ? ['', '<details><summary>Failure message</summary>', '', '```', escapeHtml(r.failureMessage), '```', '</details>'].join('\n')
    : '';

  return [
    '<details>',
    `<summary>${heading}</summary>`,
    '',
    body,
    failureBlock,
    '</details>',
  ].join('\n');
}

export function renderMarkdown(results: AnalyzedResult[], summary: ReportSummary): string {
  const failing = results.filter((r) => r.verdict !== 'passing');

  const summaryTable = [
    '| Verdict | Count |',
    '| --- | --- |',
    `| Flaky | ${summary.flaky} |`,
    `| Real break | ${summary.realBreaks} |`,
    `| Inconclusive | ${summary.inconclusive} |`,
    `| Passing | ${summary.passing} |`,
  ].join('\n');

  const body =
    failing.length === 0
      ? '_No flaky or failing tests detected — all clean._'
      : failing.map(renderTestBlock).join('\n\n');

  return [
    REPORT_MARKER,
    '## Flaky Triager Report',
    '',
    summaryTable,
    '',
    body,
    '',
  ].join('\n');
}
