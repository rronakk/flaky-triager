import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryHistoryStore } from '../../src/history/in-memory.js';
import { testKeyFor, type TestRunRecord } from '../../src/history/types.js';

function rec(overrides: Partial<TestRunRecord> = {}): TestRunRecord {
  return {
    sha: 'abc123',
    branch: 'main',
    timestamp: '2026-05-27T10:00:00Z',
    testName: 'flaky test',
    suite: 'cache.ts',
    verdict: 'flaky',
    failureMessage: 'timeout',
    ...overrides,
  };
}

describe('InMemoryHistoryStore', () => {
  let store: InMemoryHistoryStore;
  beforeEach(() => {
    store = new InMemoryHistoryStore();
  });

  it('returns an empty list when no history exists', async () => {
    const out = await store.getHistory(testKeyFor('s', 't'), 10);
    expect(out).toEqual([]);
  });

  it('saves and retrieves a record by test key', async () => {
    const r = rec();
    await store.saveResults('abc123', 'main', [r]);
    const out = await store.getHistory(testKeyFor(r.suite, r.testName), 10);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ sha: 'abc123', verdict: 'flaky', testName: 'flaky test' });
  });

  it('returns records most-recent-first by timestamp', async () => {
    const older = rec({ sha: 'old', timestamp: '2026-05-20T10:00:00Z' });
    const newer = rec({ sha: 'new', timestamp: '2026-05-27T10:00:00Z' });
    await store.saveResults('old', 'main', [older]);
    await store.saveResults('new', 'main', [newer]);
    const out = await store.getHistory(testKeyFor(older.suite, older.testName), 10);
    expect(out.map((r) => r.sha)).toEqual(['new', 'old']);
  });

  it('honors the limit parameter', async () => {
    for (let i = 0; i < 5; i++) {
      await store.saveResults(`sha${i}`, 'main', [
        rec({ sha: `sha${i}`, timestamp: `2026-05-2${i}T10:00:00Z` }),
      ]);
    }
    const out = await store.getHistory(testKeyFor('cache.ts', 'flaky test'), 3);
    expect(out).toHaveLength(3);
  });

  it('keys records by suite + testName so unrelated tests do not collide', async () => {
    await store.saveResults('abc', 'main', [
      rec({ sha: 'abc', testName: 'A', suite: 's' }),
      rec({ sha: 'abc', testName: 'B', suite: 's' }),
    ]);
    const a = await store.getHistory(testKeyFor('s', 'A'), 10);
    const b = await store.getHistory(testKeyFor('s', 'B'), 10);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0].testName).toBe('A');
    expect(b[0].testName).toBe('B');
  });

  it('overwrites a record when the same (sha, testKey) is saved again', async () => {
    await store.saveResults('abc', 'main', [rec({ sha: 'abc', verdict: 'flaky' })]);
    await store.saveResults('abc', 'main', [rec({ sha: 'abc', verdict: 'real_break' })]);
    const out = await store.getHistory(testKeyFor('cache.ts', 'flaky test'), 10);
    expect(out).toHaveLength(1);
    expect(out[0].verdict).toBe('real_break');
  });
});
