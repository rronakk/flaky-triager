import type { ScoredResult } from '../types.js';
import type { TestRunRecord } from './types.js';

export { InMemoryHistoryStore } from './in-memory.js';
export { FirestoreHistoryStore } from './firestore.js';
export type { HistoryStore, TestRunRecord } from './types.js';
export { testKeyFor } from './types.js';

export function recordsFromScored(
  scored: ScoredResult[],
  meta: { sha: string; branch: string; timestamp?: string },
): TestRunRecord[] {
  const timestamp = meta.timestamp ?? new Date().toISOString();
  return scored.map((s) => ({
    sha: meta.sha,
    branch: meta.branch,
    timestamp,
    testName: s.testName,
    suite: s.suite,
    verdict: s.verdict,
    failureMessage: s.failureMessage,
  }));
}
