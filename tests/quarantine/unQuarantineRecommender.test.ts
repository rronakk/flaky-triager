import { describe, it, expect } from 'vitest';
import {
  recommendUnQuarantine,
  RECOMMEND_MIN_PASSES,
} from '../../src/quarantine/unQuarantineRecommender.js';
import { addEntries, emptyQuarantine, type QuarantineEntry } from '../../src/quarantine/file.js';
import { testKeyFor, type TestRunRecord } from '../../src/history/types.js';

function entry(overrides: Partial<QuarantineEntry> = {}): QuarantineEntry {
  return {
    suite: 'tests/foo.test.ts',
    testName: 'quarantined thing',
    addedAt: '2026-06-01T00:00:00Z',
    verdict: 'flaky',
    flakinessScore: 85,
    reason: 'q',
    ...overrides,
  };
}

function rec(overrides: Partial<TestRunRecord> = {}): TestRunRecord {
  return {
    sha: 'sha',
    branch: 'main',
    timestamp: '2026-06-08T10:00:00Z',
    testName: 'quarantined thing',
    suite: 'tests/foo.test.ts',
    verdict: 'passing',
    ...overrides,
  };
}

describe('recommendUnQuarantine', () => {
  it('recommends removal when a quarantined test has N consecutive genuine passes', () => {
    const q = addEntries(emptyQuarantine(), [entry()]);
    const history = new Map<string, TestRunRecord[]>();
    const records: TestRunRecord[] = [];
    for (let i = 0; i < RECOMMEND_MIN_PASSES; i++) {
      records.push(rec({ sha: `s${i}`, timestamp: `2026-06-0${i}T10:00:00Z` }));
    }
    // most-recent-first (descending) — same order getHistory returns
    records.reverse();
    history.set(testKeyFor('tests/foo.test.ts', 'quarantined thing'), records);
    const removals = recommendUnQuarantine(q, history);
    expect(removals).toEqual([
      { suite: 'tests/foo.test.ts', testName: 'quarantined thing' },
    ]);
  });

  it('does NOT recommend removal when a recent record is a skipped demotion (still flaky)', () => {
    const q = addEntries(emptyQuarantine(), [entry()]);
    const history = new Map<string, TestRunRecord[]>();
    const records = [
      rec({ sha: 'newest', timestamp: '2026-06-08T10:00:00Z', wasSkipped: true }),
      rec({ sha: 's1', timestamp: '2026-06-07T10:00:00Z' }),
      rec({ sha: 's2', timestamp: '2026-06-06T10:00:00Z' }),
    ];
    history.set(testKeyFor('tests/foo.test.ts', 'quarantined thing'), records);
    const removals = recommendUnQuarantine(q, history, { minPasses: 3 });
    expect(removals).toHaveLength(0);
  });

  it('does NOT recommend when fewer than minPasses consecutive passes are present', () => {
    const q = addEntries(emptyQuarantine(), [entry()]);
    const history = new Map<string, TestRunRecord[]>();
    history.set(testKeyFor('tests/foo.test.ts', 'quarantined thing'), [
      rec({ sha: 'a', timestamp: '2026-06-08T10:00:00Z' }),
      rec({ sha: 'b', timestamp: '2026-06-07T10:00:00Z' }),
    ]);
    const removals = recommendUnQuarantine(q, history, { minPasses: 5 });
    expect(removals).toHaveLength(0);
  });

  it('counts only the leading streak of passes (stops at first non-pass)', () => {
    const q = addEntries(emptyQuarantine(), [entry()]);
    const history = new Map<string, TestRunRecord[]>();
    history.set(testKeyFor('tests/foo.test.ts', 'quarantined thing'), [
      rec({ sha: 'newest', timestamp: '2026-06-08T10:00:00Z' }),
      rec({ sha: 's1', timestamp: '2026-06-07T10:00:00Z' }),
      rec({ sha: 's2', timestamp: '2026-06-06T10:00:00Z', verdict: 'inconclusive' }),
      rec({ sha: 's3', timestamp: '2026-06-05T10:00:00Z' }),
      rec({ sha: 's4', timestamp: '2026-06-04T10:00:00Z' }),
    ]);
    const removals = recommendUnQuarantine(q, history, { minPasses: 3 });
    expect(removals).toHaveLength(0);
  });

  it('does NOT recommend when the quarantined test has no history yet', () => {
    const q = addEntries(emptyQuarantine(), [entry()]);
    const history = new Map<string, TestRunRecord[]>();
    const removals = recommendUnQuarantine(q, history, { minPasses: 3 });
    expect(removals).toHaveLength(0);
  });

  it('returns multiple removals when several quarantined tests qualify', () => {
    const q = addEntries(emptyQuarantine(), [
      entry({ testName: 'a' }),
      entry({ testName: 'b' }),
      entry({ testName: 'c' }),
    ]);
    const history = new Map<string, TestRunRecord[]>();
    const makePasses = (testName: string) =>
      [0, 1, 2].map((i) =>
        rec({ testName, sha: `s${i}`, timestamp: `2026-06-0${8 - i}T10:00:00Z` }),
      );
    history.set(testKeyFor('tests/foo.test.ts', 'a'), makePasses('a'));
    history.set(testKeyFor('tests/foo.test.ts', 'c'), makePasses('c'));
    const removals = recommendUnQuarantine(q, history, { minPasses: 3 });
    expect(removals.map((r) => r.testName).sort()).toEqual(['a', 'c']);
  });

  it('does NOT recommend when current run is in history as inconclusive even if older runs passed', () => {
    const q = addEntries(emptyQuarantine(), [entry()]);
    const history = new Map<string, TestRunRecord[]>();
    history.set(testKeyFor('tests/foo.test.ts', 'quarantined thing'), [
      rec({ sha: 'newest', timestamp: '2026-06-08T10:00:00Z', verdict: 'inconclusive' }),
      rec({ sha: 's1', timestamp: '2026-06-07T10:00:00Z' }),
      rec({ sha: 's2', timestamp: '2026-06-06T10:00:00Z' }),
      rec({ sha: 's3', timestamp: '2026-06-05T10:00:00Z' }),
    ]);
    const removals = recommendUnQuarantine(q, history, { minPasses: 3 });
    expect(removals).toHaveLength(0);
  });
});
