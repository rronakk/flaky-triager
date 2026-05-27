import type { TestResult, ScoredResult, Verdict } from '../types.js';
import type { TestRunRecord } from '../history/types.js';
import { testKeyFor } from '../history/types.js';

const HISTORY_WINDOW = 5;

interface HistorySignal {
  upgrade: Verdict | null;
  flakinessScore: number;
}

function readHistorySignal(records: TestRunRecord[]): HistorySignal {
  const recent = records.slice(0, HISTORY_WINDOW);
  if (recent.length === 0) return { upgrade: null, flakinessScore: 0 };

  const hasPass = recent.some((r) => r.verdict === 'passing');
  const hasFail = recent.some((r) => r.verdict === 'real_break' || r.verdict === 'flaky');
  const hasIncon = recent.some((r) => r.verdict === 'inconclusive');

  if (hasPass && (hasFail || hasIncon)) {
    const passCount = recent.filter((r) => r.verdict === 'passing').length;
    const failureRatio = (recent.length - passCount) / recent.length;
    return { upgrade: 'flaky', flakinessScore: Math.round(70 + (1 - failureRatio) * 30) };
  }

  if (!hasPass && recent.length >= 2) {
    return { upgrade: 'real_break', flakinessScore: 10 };
  }

  return { upgrade: null, flakinessScore: 0 };
}

export function scoreTestResults(
  results: TestResult[],
  history?: Map<string, TestRunRecord[]>,
): ScoredResult[] {
  const grouped = new Map<string, TestResult[]>();
  for (const result of results) {
    const key = testKeyFor(result.suite, result.testName);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(result);
  }

  const scored: ScoredResult[] = [];

  for (const [key, attempts] of grouped) {
    const sorted = [...attempts].sort((a, b) => a.retryIndex - b.retryIndex);
    const failures = sorted.filter((a) => a.status === 'failed');
    const passes = sorted.filter((a) => a.status === 'passed');
    const hasFailed = failures.length > 0;
    const hasPassed = passes.length > 0;
    const sameSHADivergence = hasFailed && hasPassed;

    let verdict: Verdict;
    let flakinessScore: number;

    if (!hasFailed) {
      verdict = 'passing';
      flakinessScore = 0;
    } else if (sameSHADivergence) {
      verdict = 'flaky';
      const failureRatio = failures.length / sorted.length;
      flakinessScore = Math.round(70 + (1 - failureRatio) * 30);
    } else {
      verdict = 'inconclusive';
      flakinessScore = 20;
    }

    if (verdict === 'inconclusive' && history) {
      const records = history.get(key);
      if (records && records.length > 0) {
        const signal = readHistorySignal(records);
        if (signal.upgrade) {
          verdict = signal.upgrade;
          flakinessScore = signal.flakinessScore;
        }
      }
    }

    const firstFailure = failures[0];
    scored.push({
      testName: sorted[0].testName,
      suite: sorted[0].suite,
      verdict,
      flakinessScore,
      sameSHADivergence,
      totalRuns: sorted.length,
      failures: failures.length,
      passes: passes.length,
      failureMessage: firstFailure?.failureMessage,
      stackTrace: firstFailure?.stackTrace,
    });
  }

  return scored;
}
