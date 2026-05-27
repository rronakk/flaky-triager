import { describe, it, expect, beforeEach } from 'vitest';
import {
  FirestoreHistoryStore,
  type CollectionLike,
  type DocLike,
  type FirestoreLike,
  type QueryLike,
  type QuerySnapshotLike,
} from '../../src/history/firestore.js';
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

class FakeFirestore implements FirestoreLike {
  readonly writes: Array<{ path: string; data: Record<string, unknown> }> = [];
  readonly reads: Array<{ path: string; orderBy?: [string, 'desc' | 'asc']; limit?: number }> = [];
  readonly storage = new Map<string, Map<string, Record<string, unknown>>>();

  collection(path: string): CollectionLike {
    return this.makeCollection(path);
  }

  private makeCollection(path: string): CollectionLike {
    const self = this;
    return {
      doc(id: string): DocLike {
        const docPath = `${path}/${id}`;
        return {
          collection(sub: string): CollectionLike {
            return self.makeCollection(`${docPath}/${sub}`);
          },
          async set(data: Record<string, unknown>) {
            self.writes.push({ path: docPath, data });
            const parent = self.storage.get(path) ?? new Map();
            parent.set(id, data);
            self.storage.set(path, parent);
            return undefined;
          },
        };
      },
      orderBy(field: string, dir: 'desc' | 'asc'): QueryLike {
        return self.makeQuery(path, [field, dir]);
      },
    };
  }

  private makeQuery(path: string, orderBy?: [string, 'desc' | 'asc'], limit?: number): QueryLike {
    const self = this;
    return {
      limit(n: number) {
        return self.makeQuery(path, orderBy, n);
      },
      async get(): Promise<QuerySnapshotLike> {
        self.reads.push({ path, orderBy, limit });
        const parent = self.storage.get(path) ?? new Map();
        let docs = [...parent.values()];
        if (orderBy) {
          const [field, dir] = orderBy;
          docs = docs.sort((a, b) => {
            const av = String(a[field] ?? '');
            const bv = String(b[field] ?? '');
            if (av === bv) return 0;
            return dir === 'desc' ? (av < bv ? 1 : -1) : av < bv ? -1 : 1;
          });
        }
        if (limit !== undefined) docs = docs.slice(0, limit);
        return { docs: docs.map((d) => ({ data: () => d })) };
      },
    };
  }
}

describe('FirestoreHistoryStore', () => {
  let fake: FakeFirestore;
  let store: FirestoreHistoryStore;
  beforeEach(() => {
    fake = new FakeFirestore();
    store = new FirestoreHistoryStore({ firestore: fake });
  });

  it('writes one document per record under test-history/{hash}/runs/{sha}', async () => {
    await store.saveResults('abc123', 'main', [rec()]);
    expect(fake.writes).toHaveLength(1);
    expect(fake.writes[0].path).toMatch(/^test-history\/[0-9a-f]{40}\/runs\/abc123$/);
    expect(fake.writes[0].data).toMatchObject({
      sha: 'abc123',
      branch: 'main',
      verdict: 'flaky',
      testKey: 'cache.ts::flaky test',
    });
  });

  it('uses a stable hash for the test doc id so the same test maps to the same doc', async () => {
    await store.saveResults('a', 'main', [rec({ sha: 'a' })]);
    await store.saveResults('b', 'main', [rec({ sha: 'b' })]);
    const docIds = fake.writes.map((w) => w.path.split('/')[1]);
    expect(docIds[0]).toEqual(docIds[1]);
  });

  it('keeps unrelated tests in different documents', async () => {
    await store.saveResults('a', 'main', [
      rec({ testName: 'A', suite: 's' }),
      rec({ testName: 'B', suite: 's' }),
    ]);
    const docIds = new Set(fake.writes.map((w) => w.path.split('/')[1]));
    expect(docIds.size).toBe(2);
  });

  it('getHistory orders by timestamp desc and applies the limit', async () => {
    await store.saveResults('old', 'main', [rec({ sha: 'old', timestamp: '2026-05-20T10:00:00Z' })]);
    await store.saveResults('new', 'main', [rec({ sha: 'new', timestamp: '2026-05-27T10:00:00Z' })]);
    const out = await store.getHistory(testKeyFor('cache.ts', 'flaky test'), 5);
    expect(out.map((r) => r.sha)).toEqual(['new', 'old']);
    const lastRead = fake.reads.at(-1)!;
    expect(lastRead.orderBy).toEqual(['timestamp', 'desc']);
    expect(lastRead.limit).toBe(5);
  });

  it('returns an empty array when no history is stored', async () => {
    const out = await store.getHistory(testKeyFor('nothing', 'here'), 5);
    expect(out).toEqual([]);
  });

  it('respects a custom rootCollection', async () => {
    const custom = new FirestoreHistoryStore({ firestore: fake, rootCollection: 'my-runs' });
    await custom.saveResults('abc', 'main', [rec()]);
    expect(fake.writes[0].path.startsWith('my-runs/')).toBe(true);
  });
});
