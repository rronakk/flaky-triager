import { describe, it, expect } from 'vitest';
import {
  formatQuarantinePrBody,
  quarantinePrTitle,
  QUARANTINE_PR_MARKER,
} from '../../src/quarantine/prFormatter.js';
import type { QuarantineEntry } from '../../src/quarantine/file.js';

function entry(overrides: Partial<QuarantineEntry> = {}): QuarantineEntry {
  return {
    suite: 'tests/foo.test.ts',
    testName: 'sometimes fails',
    addedAt: '2026-05-30T14:00:00Z',
    verdict: 'flaky',
    flakinessScore: 85,
    reason: 'Failed 2/5 runs (flakiness score 85).',
    ...overrides,
  };
}

describe('formatQuarantinePrBody', () => {
  it('starts with the marker so the PR can be found on subsequent runs', () => {
    const md = formatQuarantinePrBody({ candidates: [entry()] });
    expect(md.startsWith(QUARANTINE_PR_MARKER)).toBe(true);
  });

  it('renders one table row per candidate with score and reason', () => {
    const md = formatQuarantinePrBody({
      candidates: [
        entry({ testName: 'a', flakinessScore: 85, reason: 'reason a' }),
        entry({ testName: 'b', flakinessScore: 90, reason: 'reason b' }),
      ],
    });
    expect(md).toContain('| `tests/foo.test.ts > a` | 85 | reason a |');
    expect(md).toContain('| `tests/foo.test.ts > b` | 90 | reason b |');
  });

  it('links the source PR when provided', () => {
    const md = formatQuarantinePrBody({
      candidates: [entry()],
      sourcePrNumber: 42,
      sourcePrUrl: 'https://github.com/owner/repo/pull/42',
    });
    expect(md).toContain('#42');
    expect(md).toContain('https://github.com/owner/repo/pull/42');
  });

  it('omits the source-PR section when no PR is provided', () => {
    const md = formatQuarantinePrBody({ candidates: [entry()] });
    expect(md).not.toContain('Detected on:');
  });
});

describe('quarantinePrTitle', () => {
  it('uses singular "test" for one candidate', () => {
    expect(quarantinePrTitle(1)).toContain('1 test');
    expect(quarantinePrTitle(1)).not.toContain('tests');
  });

  it('uses plural "tests" for more than one candidate', () => {
    expect(quarantinePrTitle(3)).toContain('3 tests');
  });
});
