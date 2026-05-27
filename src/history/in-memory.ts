import { testKeyFor, type HistoryStore, type TestRunRecord } from './types.js';

export class InMemoryHistoryStore implements HistoryStore {
  private byTestKey = new Map<string, Map<string, TestRunRecord>>();

  async saveResults(sha: string, _branch: string, records: TestRunRecord[]): Promise<void> {
    for (const r of records) {
      const key = testKeyFor(r.suite, r.testName);
      let bySha = this.byTestKey.get(key);
      if (!bySha) {
        bySha = new Map();
        this.byTestKey.set(key, bySha);
      }
      bySha.set(sha, r);
    }
  }

  async getHistory(testKey: string, limit: number): Promise<TestRunRecord[]> {
    const bySha = this.byTestKey.get(testKey);
    if (!bySha) return [];
    const all = [...bySha.values()].sort((a, b) =>
      a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0,
    );
    return all.slice(0, limit);
  }
}
