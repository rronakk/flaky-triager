import { describe, it, expect } from 'vitest';
import { formatReport, REPORT_MARKER } from '../../src/reporter/index.js';
import type { AnalyzedResult } from '../../src/analyzer/index.js';

function makeAnalyzed(overrides: Partial<AnalyzedResult> = {}): AnalyzedResult {
  return {
    testName: 'cache get returns stored value',
    suite: 'cache.ts',
    verdict: 'flaky',
    flakinessScore: 90,
    sameSHADivergence: true,
    totalRuns: 2,
    failures: 1,
    passes: 1,
    failureMessage: 'Timeout: expected 1 to be 0',
    stackTrace: 'at cache.test.ts:42',
    analysis: {
      rootCauseCategory: 'timing',
      explanation: 'Cache expiry races with assertion.',
      suggestedFix: 'Use fake timers or await invalidation.',
      confidence: 'high',
    },
    ...overrides,
  };
}

describe('formatReport — markdown', () => {
  it('includes the report marker comment so the Action can find/update it', () => {
    const md = formatReport([makeAnalyzed()], 'markdown');
    expect(md).toContain(REPORT_MARKER);
  });

  it('renders a summary table with counts per verdict', () => {
    const results: AnalyzedResult[] = [
      makeAnalyzed({ testName: 'flaky1', verdict: 'flaky' }),
      makeAnalyzed({ testName: 'flaky2', verdict: 'flaky' }),
      makeAnalyzed({ testName: 'broke', verdict: 'real_break' }),
      makeAnalyzed({ testName: 'unknown', verdict: 'inconclusive' }),
      makeAnalyzed({ testName: 'ok', verdict: 'passing', analysis: undefined }),
    ];
    const md = formatReport(results, 'markdown');
    expect(md).toMatch(/\|\s*Flaky\s*\|\s*2\s*\|/);
    expect(md).toMatch(/\|\s*Real break\s*\|\s*1\s*\|/);
    expect(md).toMatch(/\|\s*Inconclusive\s*\|\s*1\s*\|/);
    expect(md).toMatch(/\|\s*Passing\s*\|\s*1\s*\|/);
  });

  it('includes a verdict badge, score, explanation, and fix for each failing test', () => {
    const md = formatReport([makeAnalyzed()], 'markdown');
    expect(md).toContain('FLAKY');
    expect(md).toContain('90');
    expect(md).toContain('Cache expiry races with assertion.');
    expect(md).toContain('Use fake timers or await invalidation.');
    expect(md).toContain('cache get returns stored value');
  });

  it('uses collapsible details for each failing test', () => {
    const md = formatReport([makeAnalyzed()], 'markdown');
    expect(md).toContain('<details>');
    expect(md).toContain('</details>');
    expect(md).toContain('<summary>');
  });

  it('omits passing tests from the per-test detail list', () => {
    const results: AnalyzedResult[] = [
      makeAnalyzed({ testName: 'flaky one', verdict: 'flaky' }),
      makeAnalyzed({ testName: 'ok one', verdict: 'passing', analysis: undefined }),
    ];
    const md = formatReport(results, 'markdown');
    expect(md).toContain('flaky one');
    expect(md).not.toContain('ok one');
  });

  it('shows a clean message when there are no failing tests', () => {
    const results: AnalyzedResult[] = [
      makeAnalyzed({ testName: 'ok one', verdict: 'passing', analysis: undefined }),
    ];
    const md = formatReport(results, 'markdown');
    expect(md).toContain(REPORT_MARKER);
    expect(md.toLowerCase()).toMatch(/no flaky|all (tests )?passed|clean/);
  });

  it('falls back gracefully when analysis is missing for a failing test', () => {
    const md = formatReport(
      [makeAnalyzed({ verdict: 'flaky', analysis: undefined })],
      'markdown',
    );
    expect(md).toContain('FLAKY');
    expect(md).toContain('cache get returns stored value');
  });

  it('escapes raw HTML in failure messages to prevent injection', () => {
    const md = formatReport(
      [
        makeAnalyzed({
          failureMessage: '<script>alert(1)</script>',
          analysis: {
            rootCauseCategory: 'timing',
            explanation: 'safe',
            suggestedFix: 'safe',
            confidence: 'high',
          },
        }),
      ],
      'markdown',
    );
    expect(md).not.toContain('<script>alert(1)</script>');
  });
});

describe('formatReport — cli', () => {
  it('returns a string with verdict, score, and explanation', () => {
    const out = formatReport([makeAnalyzed()], 'cli');
    expect(out).toContain('FLAKY');
    expect(out).toContain('90');
    expect(out).toContain('Cache expiry races with assertion.');
  });

  it('omits passing tests', () => {
    const out = formatReport(
      [
        makeAnalyzed({ testName: 'flaky one', verdict: 'flaky' }),
        makeAnalyzed({ testName: 'ok one', verdict: 'passing', analysis: undefined }),
      ],
      'cli',
    );
    expect(out).toContain('flaky one');
    expect(out).not.toContain('ok one');
  });
});

describe('formatReport — json', () => {
  it('returns a JSON string with summary and results', () => {
    const out = formatReport([makeAnalyzed()], 'json');
    const parsed = JSON.parse(out);
    expect(parsed.summary).toEqual({
      total: 1,
      flaky: 1,
      realBreaks: 0,
      inconclusive: 0,
      passing: 0,
    });
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0].verdict).toBe('flaky');
    expect(parsed.results[0].analysis.rootCauseCategory).toBe('timing');
  });

  it('counts each verdict correctly', () => {
    const results: AnalyzedResult[] = [
      makeAnalyzed({ verdict: 'flaky' }),
      makeAnalyzed({ verdict: 'real_break' }),
      makeAnalyzed({ verdict: 'real_break' }),
      makeAnalyzed({ verdict: 'inconclusive' }),
      makeAnalyzed({ verdict: 'passing', analysis: undefined }),
    ];
    const out = formatReport(results, 'json');
    const parsed = JSON.parse(out);
    expect(parsed.summary).toEqual({
      total: 5,
      flaky: 1,
      realBreaks: 2,
      inconclusive: 1,
      passing: 1,
    });
  });
});
