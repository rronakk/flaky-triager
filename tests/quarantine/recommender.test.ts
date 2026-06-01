import { describe, it, expect } from 'vitest';
import { recommendQuarantine, RECOMMEND_MIN_SCORE } from '../../src/quarantine/recommender.js';
import { emptyQuarantine, addEntries, type QuarantineEntry } from '../../src/quarantine/file.js';
import type { AnalyzedResult } from '../../src/analyzer/index.js';

function res(overrides: Partial<AnalyzedResult> = {}): AnalyzedResult {
  return {
    testName: 'flaky thing',
    suite: 'tests/foo.test.ts',
    verdict: 'flaky',
    flakinessScore: 85,
    sameSHADivergence: true,
    totalRuns: 2,
    failures: 1,
    passes: 1,
    failureMessage: 'sometimes fails',
    stackTrace: 'at foo.test.ts:10',
    analysis: {
      rootCauseCategory: 'timing',
      explanation: 'race condition',
      suggestedFix: 'await it',
      confidence: 'high',
    },
    ...overrides,
  };
}

function existing(overrides: Partial<QuarantineEntry> = {}): QuarantineEntry {
  return {
    suite: 'tests/foo.test.ts',
    testName: 'already quarantined',
    addedAt: '2026-05-29T00:00:00Z',
    verdict: 'flaky',
    flakinessScore: 90,
    reason: 'old',
    ...overrides,
  };
}

describe('recommendQuarantine', () => {
  it('recommends a flaky test with a high score', () => {
    const rec = recommendQuarantine([res()], emptyQuarantine());
    expect(rec).toHaveLength(1);
    expect(rec[0].suite).toBe('tests/foo.test.ts');
    expect(rec[0].testName).toBe('flaky thing');
    expect(rec[0].verdict).toBe('flaky');
  });

  it('does not recommend a test below the score threshold', () => {
    const rec = recommendQuarantine([res({ flakinessScore: RECOMMEND_MIN_SCORE - 1 })], emptyQuarantine());
    expect(rec).toHaveLength(0);
  });

  it('does not recommend non-flaky verdicts even at high scores', () => {
    const rec = recommendQuarantine(
      [
        res({ verdict: 'real_break', flakinessScore: 95 }),
        res({ verdict: 'inconclusive', flakinessScore: 95 }),
        res({ verdict: 'passing', flakinessScore: 0 }),
      ],
      emptyQuarantine(),
    );
    expect(rec).toHaveLength(0);
  });

  it('skips tests already in the quarantine file', () => {
    const q = addEntries(emptyQuarantine(), [existing({ suite: 'tests/foo.test.ts', testName: 'flaky thing' })]);
    const rec = recommendQuarantine([res()], q);
    expect(rec).toHaveLength(0);
  });

  it('only recommends the new candidates when some are already quarantined', () => {
    const q = addEntries(emptyQuarantine(), [existing({ suite: 'tests/foo.test.ts', testName: 'already' })]);
    const rec = recommendQuarantine(
      [
        res({ testName: 'already' }),
        res({ testName: 'fresh' }),
      ],
      q,
    );
    expect(rec.map((r) => r.testName)).toEqual(['fresh']);
  });

  it('builds a reason string that includes failure-rate and score', () => {
    const rec = recommendQuarantine([res({ totalRuns: 5, failures: 2, flakinessScore: 88 })], emptyQuarantine());
    expect(rec[0].reason).toMatch(/failed 2\/5|2 of 5/i);
    expect(rec[0].reason).toMatch(/88/);
  });

  it('uses a stable timestamp string (ISO 8601)', () => {
    const rec = recommendQuarantine([res()], emptyQuarantine());
    expect(rec[0].addedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
