import type { QuarantineEntry } from './file.js';

export const QUARANTINE_PR_MARKER = '<!-- flaky-triager:quarantine-pr -->';
export const QUARANTINE_BRANCH = 'flaky-triager/quarantine';
export const QUARANTINE_FILE_PATH = '.flaky-quarantine.json';

export interface QuarantinePrBodyInputs {
  candidates: QuarantineEntry[];
  sourcePrNumber?: number;
  sourcePrUrl?: string;
}

export function formatQuarantinePrBody(inputs: QuarantinePrBodyInputs): string {
  const { candidates, sourcePrNumber, sourcePrUrl } = inputs;

  const tableRows = candidates
    .map((c) => `| \`${c.suite} > ${c.testName}\` | ${c.flakinessScore} | ${c.reason} |`)
    .join('\n');

  const sources = sourcePrNumber
    ? `\n**Detected on:** ${sourcePrUrl ? `[#${sourcePrNumber}](${sourcePrUrl})` : `#${sourcePrNumber}`}\n`
    : '';

  return [
    QUARANTINE_PR_MARKER,
    '## Quarantine recommendations',
    '',
    'flaky-triager has detected the following tests as flaky on recent CI runs and recommends adding them to `.flaky-quarantine.json` so they no longer block builds.',
    sources,
    '| Test | Score | Reason |',
    '| --- | --- | --- |',
    tableRows,
    '',
    '**Review checklist:**',
    '- [ ] The flake is real (not a real failure being masked)',
    '- [ ] An issue or ticket exists to track fixing the underlying cause',
    '- [ ] Merge to skip these tests in CI, or close this PR to dismiss the recommendation',
    '',
  ].join('\n');
}

export function quarantinePrTitle(count: number): string {
  const suffix = count === 1 ? 'test' : 'tests';
  return `flaky-triager: quarantine ${count} ${suffix}`;
}
