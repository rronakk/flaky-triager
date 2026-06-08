import type { Verdict } from '../types.js';

export interface TestRunRecord {
  sha: string;
  branch: string;
  timestamp: string;
  testName: string;
  suite: string;
  verdict: Verdict;
  failureMessage?: string;
  /** True when at least one attempt this run was demoted to skipped (e.g. by filter-junit). */
  wasSkipped?: boolean;
}

export interface HistoryStore {
  saveResults(sha: string, branch: string, records: TestRunRecord[]): Promise<void>;
  getHistory(testKey: string, limit: number): Promise<TestRunRecord[]>;
}

export function testKeyFor(suite: string, testName: string): string {
  return `${suite}::${testName}`;
}
