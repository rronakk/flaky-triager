import { describe, it, expect } from 'vitest';
import { scoreTestResults } from '../../src/scorer/index.js';
import type { TestResult } from '../../src/types.js';
import type { TestRunRecord } from '../../src/history/types.js';
import { testKeyFor } from '../../src/history/types.js';

function histRec(overrides: Partial<TestRunRecord> = {}): TestRunRecord {
  return {
    sha: 'sha',
    branch: 'main',
    timestamp: '2026-05-27T10:00:00Z',
    testName: 'broken test',
    suite: 'suite',
    verdict: 'inconclusive',
    failureMessage: 'error',
    ...overrides,
  };
}

function makeResult(overrides: Partial<TestResult> = {}): TestResult {
  return {
    testName: 'test',
    suite: 'suite',
    className: 'class',
    status: 'passed',
    duration: 0.1,
    retryIndex: 0,
    ...overrides,
  };
}

describe('scoreTestResults', () => {
  it('marks a test as passing when it passes on first run', () => {
    const results = [makeResult({ testName: 'always passes', status: 'passed' })];
    const scored = scoreTestResults(results);
    expect(scored).toHaveLength(1);
    expect(scored[0].verdict).toBe('passing');
    expect(scored[0].flakinessScore).toBe(0);
  });

  it('marks a test as flaky when it fails then passes on retry (same SHA)', () => {
    const results = [
      makeResult({ testName: 'flaky test', status: 'failed', retryIndex: 0, failureMessage: 'timeout' }),
      makeResult({ testName: 'flaky test', status: 'passed', retryIndex: 1 }),
    ];
    const scored = scoreTestResults(results);
    expect(scored).toHaveLength(1);
    expect(scored[0].verdict).toBe('flaky');
    expect(scored[0].sameSHADivergence).toBe(true);
    expect(scored[0].flakinessScore).toBeGreaterThan(70);
  });

  it('marks a test as inconclusive when it fails all retries', () => {
    const results = [
      makeResult({ testName: 'broken test', status: 'failed', retryIndex: 0, failureMessage: 'error' }),
      makeResult({ testName: 'broken test', status: 'failed', retryIndex: 1, failureMessage: 'error' }),
      makeResult({ testName: 'broken test', status: 'failed', retryIndex: 2, failureMessage: 'error' }),
    ];
    const scored = scoreTestResults(results);
    expect(scored).toHaveLength(1);
    expect(scored[0].verdict).toBe('inconclusive');
    expect(scored[0].sameSHADivergence).toBe(false);
  });

  it('handles multiple tests in a single run', () => {
    const results = [
      makeResult({ testName: 'good test', status: 'passed', suite: 'a' }),
      makeResult({ testName: 'flaky test', status: 'failed', suite: 'b', retryIndex: 0 }),
      makeResult({ testName: 'flaky test', status: 'passed', suite: 'b', retryIndex: 1 }),
      makeResult({ testName: 'broken test', status: 'failed', suite: 'c', retryIndex: 0 }),
      makeResult({ testName: 'broken test', status: 'failed', suite: 'c', retryIndex: 1 }),
    ];
    const scored = scoreTestResults(results);
    expect(scored).toHaveLength(3);
    expect(scored.find((s) => s.testName === 'good test')?.verdict).toBe('passing');
    expect(scored.find((s) => s.testName === 'flaky test')?.verdict).toBe('flaky');
    expect(scored.find((s) => s.testName === 'broken test')?.verdict).toBe('inconclusive');
  });

  it('only reports failed tests (not passing tests) in scored output', () => {
    const results = [
      makeResult({ testName: 'good test', status: 'passed' }),
      makeResult({ testName: 'flaky test', status: 'failed', retryIndex: 0 }),
      makeResult({ testName: 'flaky test', status: 'passed', retryIndex: 1 }),
    ];
    const scored = scoreTestResults(results);
    const passing = scored.filter((s) => s.verdict === 'passing');
    const flaky = scored.filter((s) => s.verdict === 'flaky');
    expect(passing).toHaveLength(1);
    expect(flaky).toHaveLength(1);
  });

  it('sets wasSkipped=true when an attempt was skipped (e.g., filter-junit demotion)', () => {
    const results = [
      makeResult({ testName: 'quarantined test', status: 'skipped' }),
    ];
    const scored = scoreTestResults(results);
    expect(scored).toHaveLength(1);
    expect(scored[0].wasSkipped).toBe(true);
    expect(scored[0].verdict).toBe('passing');
  });

  it('omits wasSkipped when no attempt was skipped', () => {
    const results = [makeResult({ testName: 'normal pass', status: 'passed' })];
    const scored = scoreTestResults(results);
    expect(scored[0].wasSkipped).toBeUndefined();
  });

  it('preserves failure message from the first failure', () => {
    const results = [
      makeResult({ testName: 'test', status: 'failed', retryIndex: 0, failureMessage: 'first error', stackTrace: 'at line 5' }),
      makeResult({ testName: 'test', status: 'passed', retryIndex: 1 }),
    ];
    const scored = scoreTestResults(results);
    expect(scored[0].failureMessage).toBe('first error');
    expect(scored[0].stackTrace).toBe('at line 5');
  });
});

describe('scoreTestResults — with history', () => {
  it('upgrades inconclusive to flaky when history shows mixed pass/fail across distinct SHAs', () => {
    const current = [
      makeResult({ testName: 'broken test', suite: 'suite', status: 'failed', retryIndex: 0, failureMessage: 'error' }),
    ];
    const key = testKeyFor('suite', 'broken test');
    const history = new Map<string, TestRunRecord[]>();
    history.set(key, [
      histRec({ sha: 'h1', verdict: 'passing' }),
      histRec({ sha: 'h2', verdict: 'inconclusive' }),
      histRec({ sha: 'h3', verdict: 'passing' }),
    ]);
    const scored = scoreTestResults(current, history);
    expect(scored[0].verdict).toBe('flaky');
    expect(scored[0].flakinessScore).toBeGreaterThan(0);
  });

  it('upgrades inconclusive to real_break when history shows consistent failures across recent SHAs', () => {
    const current = [
      makeResult({ testName: 'broken test', suite: 'suite', status: 'failed', retryIndex: 0, failureMessage: 'error' }),
    ];
    const key = testKeyFor('suite', 'broken test');
    const history = new Map<string, TestRunRecord[]>();
    history.set(key, [
      histRec({ sha: 'h1', verdict: 'inconclusive' }),
      histRec({ sha: 'h2', verdict: 'real_break' }),
      histRec({ sha: 'h3', verdict: 'inconclusive' }),
    ]);
    const scored = scoreTestResults(current, history);
    expect(scored[0].verdict).toBe('real_break');
  });

  it('does not change a flaky verdict when history is provided', () => {
    const current = [
      makeResult({ testName: 'flaky', suite: 'suite', status: 'failed', retryIndex: 0, failureMessage: 'oops' }),
      makeResult({ testName: 'flaky', suite: 'suite', status: 'passed', retryIndex: 1 }),
    ];
    const key = testKeyFor('suite', 'flaky');
    const history = new Map<string, TestRunRecord[]>();
    history.set(key, [
      histRec({ sha: 'h1', testName: 'flaky', verdict: 'real_break' }),
      histRec({ sha: 'h2', testName: 'flaky', verdict: 'real_break' }),
    ]);
    const scored = scoreTestResults(current, history);
    expect(scored[0].verdict).toBe('flaky');
  });

  it('does not change a passing verdict when history is provided', () => {
    const current = [makeResult({ testName: 'good', status: 'passed' })];
    const key = testKeyFor('suite', 'good');
    const history = new Map<string, TestRunRecord[]>();
    history.set(key, [histRec({ testName: 'good', verdict: 'real_break' })]);
    const scored = scoreTestResults(current, history);
    expect(scored[0].verdict).toBe('passing');
  });

  it('leaves inconclusive as inconclusive when history has no records for that test', () => {
    const current = [
      makeResult({ testName: 'unknown', status: 'failed', retryIndex: 0, failureMessage: 'error' }),
    ];
    const history = new Map<string, TestRunRecord[]>();
    const scored = scoreTestResults(current, history);
    expect(scored[0].verdict).toBe('inconclusive');
  });

  it('leaves inconclusive as inconclusive when history shows only inconclusive entries (no signal)', () => {
    const current = [
      makeResult({ testName: 'unknown', suite: 'suite', status: 'failed', retryIndex: 0, failureMessage: 'error' }),
    ];
    const key = testKeyFor('suite', 'unknown');
    const history = new Map<string, TestRunRecord[]>();
    history.set(key, [
      histRec({ sha: 'h1', testName: 'unknown', verdict: 'inconclusive' }),
    ]);
    const scored = scoreTestResults(current, history);
    expect(scored[0].verdict).toBe('inconclusive');
  });
});
