import { describe, it, expect } from 'vitest';
import { scoreTestResults } from '../../src/scorer/index.js';
import type { TestResult } from '../../src/types.js';

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
