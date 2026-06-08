import { testKeyFor, type TestRunRecord } from '../history/types.js';
import type { Quarantine } from './file.js';

export const RECOMMEND_MIN_PASSES = 5;

export interface RecommendUnQuarantineOptions {
  minPasses?: number;
}

export interface UnQuarantineRemoval {
  suite: string;
  testName: string;
}

/**
 * Looks at history for each currently quarantined test and recommends removal
 * when the most recent N records are GENUINE passes — i.e. verdict='passing'
 * AND not a filter-junit demotion (wasSkipped !== true).
 *
 * History records are expected in most-recent-first order, matching
 * HistoryStore.getHistory's contract.
 */
export function recommendUnQuarantine(
  quarantine: Quarantine,
  history: Map<string, TestRunRecord[]>,
  opts: RecommendUnQuarantineOptions = {},
): UnQuarantineRemoval[] {
  const minPasses = opts.minPasses ?? RECOMMEND_MIN_PASSES;
  const removals: UnQuarantineRemoval[] = [];

  for (const entry of quarantine.entries) {
    const key = testKeyFor(entry.suite, entry.testName);
    const records = history.get(key) ?? [];
    if (records.length < minPasses) continue;

    let streak = 0;
    for (const r of records) {
      if (r.verdict === 'passing' && r.wasSkipped !== true) {
        streak++;
        if (streak >= minPasses) break;
      } else {
        break;
      }
    }
    if (streak >= minPasses) {
      removals.push({ suite: entry.suite, testName: entry.testName });
    }
  }
  return removals;
}
