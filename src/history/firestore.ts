import * as crypto from 'node:crypto';
import { testKeyFor, type HistoryStore, type TestRunRecord } from './types.js';

export interface FirestoreLike {
  collection(path: string): CollectionLike;
}

export interface CollectionLike {
  doc(id: string): DocLike;
  orderBy(field: string, dir: 'desc' | 'asc'): QueryLike;
}

export interface DocLike {
  collection(path: string): CollectionLike;
  set(data: Record<string, unknown>): Promise<unknown>;
}

export interface QueryLike {
  limit(n: number): QueryLike;
  get(): Promise<QuerySnapshotLike>;
}

export interface QuerySnapshotLike {
  docs: Array<{ data(): Record<string, unknown> }>;
}

export interface FirestoreHistoryStoreOptions {
  rootCollection?: string;
  firestore?: FirestoreLike;
}

function hashTestKey(testKey: string): string {
  return crypto.createHash('sha1').update(testKey).digest('hex');
}

export class FirestoreHistoryStore implements HistoryStore {
  private readonly rootCollection: string;
  private firestore: FirestoreLike | undefined;

  constructor(opts: FirestoreHistoryStoreOptions = {}) {
    this.rootCollection = opts.rootCollection ?? 'test-history';
    this.firestore = opts.firestore;
  }

  private async getDb(): Promise<FirestoreLike> {
    if (this.firestore) return this.firestore;
    const admin = await import('firebase-admin');
    if (admin.apps.length === 0) {
      admin.initializeApp();
    }
    this.firestore = admin.firestore() as unknown as FirestoreLike;
    return this.firestore;
  }

  async saveResults(sha: string, branch: string, records: TestRunRecord[]): Promise<void> {
    const db = await this.getDb();
    await Promise.all(
      records.map((r) => {
        const testKey = testKeyFor(r.suite, r.testName);
        const docId = hashTestKey(testKey);
        return db
          .collection(this.rootCollection)
          .doc(docId)
          .collection('runs')
          .doc(sha)
          .set({ ...r, sha, branch, testKey });
      }),
    );
  }

  async getHistory(testKey: string, limit: number): Promise<TestRunRecord[]> {
    const db = await this.getDb();
    const docId = hashTestKey(testKey);
    const snap = await db
      .collection(this.rootCollection)
      .doc(docId)
      .collection('runs')
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .get();
    return snap.docs.map((d) => d.data() as unknown as TestRunRecord);
  }
}
