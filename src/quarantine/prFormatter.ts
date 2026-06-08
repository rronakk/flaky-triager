import type { QuarantineEntry } from './file.js';

export const QUARANTINE_PR_MARKER = '<!-- flaky-triager:quarantine-pr -->';
export const QUARANTINE_BRANCH = 'flaky-triager/quarantine';
export const QUARANTINE_FILE_PATH = '.flaky-quarantine.json';

export const UNQUARANTINE_PR_MARKER = '<!-- flaky-triager:unquarantine-pr -->';
export const UNQUARANTINE_BRANCH = 'flaky-triager/unquarantine';

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

export interface UnQuarantinePrBodyInputs {
  removals: QuarantineEntry[];
  minPasses: number;
  sourcePrNumber?: number;
  sourcePrUrl?: string;
}

export function formatUnQuarantinePrBody(inputs: UnQuarantinePrBodyInputs): string {
  const { removals, minPasses, sourcePrNumber, sourcePrUrl } = inputs;

  const tableRows = removals
    .map(
      (r) =>
        `| \`${r.suite} > ${r.testName}\` | ${r.flakinessScore} | quarantined ${r.addedAt.slice(0, 10)} — passed ${minPasses}+ consecutive runs since |`,
    )
    .join('\n');

  const sources = sourcePrNumber
    ? `\n**Detected on:** ${sourcePrUrl ? `[#${sourcePrNumber}](${sourcePrUrl})` : `#${sourcePrNumber}`}\n`
    : '';

  return [
    UNQUARANTINE_PR_MARKER,
    '## Un-quarantine recommendations',
    '',
    `The following tests have passed ${minPasses}+ consecutive CI runs since they were added to \`.flaky-quarantine.json\`. flaky-triager recommends removing them so failures will start blocking the build again.`,
    sources,
    '| Test | Original score | Removal reason |',
    '| --- | --- | --- |',
    tableRows,
    '',
    '**Review checklist:**',
    '- [ ] The pass streak is from genuine passes, not from a CI environment change that masks the original flakiness',
    '- [ ] No other suppression (e.g., test.skip) is in place that would explain the passes',
    '- [ ] Merge to re-enable these tests, or close this PR to keep them quarantined',
    '',
  ].join('\n');
}

export function unQuarantinePrTitle(count: number): string {
  const suffix = count === 1 ? 'test' : 'tests';
  return `flaky-triager: un-quarantine ${count} ${suffix}`;
}
