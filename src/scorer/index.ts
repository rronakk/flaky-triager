import type { TestResult, ScoredResult, Verdict } from '../types.js';

export function scoreTestResults(results: TestResult[]): ScoredResult[] {
  const grouped = new Map<string, TestResult[]>();
  for (const result of results) {
    const key = `${result.suite}::${result.testName}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(result);
  }

  const scored: ScoredResult[] = [];

  for (const [, attempts] of grouped) {
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
