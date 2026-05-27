import { describe, it, expect } from 'vitest';
import { analyzeFailures } from '../../src/analyzer/index.js';
import type { ScoredResult } from '../../src/types.js';
import type { LLMProvider } from '../../src/analyzer/providers/types.js';

const mockProvider: LLMProvider = {
  name: 'mock',
  async analyze(context) {
    return {
      rootCauseCategory: 'race_condition',
      explanation: `Mock analysis for ${context.testName}`,
      suggestedFix: 'Add await',
      confidence: 'high' as const,
    };
  },
};

function makeScoredResult(overrides: Partial<ScoredResult> = {}): ScoredResult {
  return {
    testName: 'test',
    suite: 'suite',
    verdict: 'flaky',
    flakinessScore: 85,
    sameSHADivergence: true,
    totalRuns: 3,
    failures: 1,
    passes: 2,
    failureMessage: 'expected undefined to be defined',
    stackTrace: 'at test.ts:42',
    ...overrides,
  };
}

describe('analyzeFailures', () => {
  it('analyzes flaky tests and returns results with analysis', async () => {
    const scored = [makeScoredResult({ testName: 'flaky test', verdict: 'flaky' })];
    const results = await analyzeFailures(scored, mockProvider);
    expect(results).toHaveLength(1);
    expect(results[0].analysis).toBeDefined();
    expect(results[0].analysis!.rootCauseCategory).toBe('race_condition');
  });

  it('analyzes inconclusive tests', async () => {
    const scored = [makeScoredResult({ testName: 'unknown test', verdict: 'inconclusive' })];
    const results = await analyzeFailures(scored, mockProvider);
    expect(results).toHaveLength(1);
    expect(results[0].analysis).toBeDefined();
  });

  it('skips passing tests', async () => {
    const scored = [makeScoredResult({ testName: 'good test', verdict: 'passing' })];
    const results = await analyzeFailures(scored, mockProvider);
    expect(results).toHaveLength(1);
    expect(results[0].analysis).toBeUndefined();
  });

  it('handles provider errors gracefully', async () => {
    const errorProvider: LLMProvider = {
      name: 'error',
      async analyze() {
        throw new Error('API error');
      },
    };
    const scored = [makeScoredResult({ verdict: 'flaky' })];
    const results = await analyzeFailures(scored, errorProvider);
    expect(results).toHaveLength(1);
    expect(results[0].analysis?.rootCauseCategory).toBe('unknown');
    expect(results[0].analysis?.confidence).toBe('low');
    expect(results[0].analysis?.explanation).toContain('API error');
  });
});
