import { describe, it, expect } from 'vitest';
import { parseJUnitXML, parseJUnitXMLFiles } from '../../src/parser/index.js';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const fixture = (name: string) =>
  readFileSync(path.join(__dirname, '..', 'fixtures', name), 'utf-8');

describe('parseJUnitXML', () => {
  it('parses an all-passing test suite', () => {
    const result = parseJUnitXML(fixture('all-pass.xml'));
    expect(result.totalTests).toBe(3);
    expect(result.failures).toBe(0);
    expect(result.results).toHaveLength(3);
    expect(result.results.every((r) => r.status === 'passed')).toBe(true);
    expect(result.results.every((r) => r.retryIndex === 0)).toBe(true);
  });

  it('parses a test with a single failure (no retries)', () => {
    const result = parseJUnitXML(fixture('flaky-retry-pass.xml'));
    const cacheTests = result.results.filter(
      (r) => r.testName === 'taskService - cache (FLAKY: async race condition) > should populate cache after creating a task'
    );
    expect(cacheTests).toHaveLength(1);
    expect(cacheTests[0].status).toBe('failed');
    expect(cacheTests[0].retryIndex).toBe(0);
    expect(cacheTests[0].failureMessage).toContain('expected undefined to be defined');
  });

  it('parses a real failure with 3 retry attempts (all failed)', () => {
    const result = parseJUnitXML(fixture('real-failure.xml'));
    const filterTests = result.results.filter(
      (r) => r.testName === 'filterTasks (REAL FAILURE: genuine bug) > should return only done tasks when filtering by done'
    );
    expect(filterTests).toHaveLength(3);
    expect(filterTests.every((r) => r.status === 'failed')).toBe(true);
    expect(filterTests[0].retryIndex).toBe(0);
    expect(filterTests[1].retryIndex).toBe(1);
    expect(filterTests[2].retryIndex).toBe(2);
  });

  it('extracts failure messages and stack traces', () => {
    const result = parseJUnitXML(fixture('real-failure.xml'));
    const failed = result.results.find((r) => r.status === 'failed');
    expect(failed?.failureMessage).toContain('expected');
    expect(failed?.stackTrace).toContain('taskFilter.test.ts');
  });

  it('extracts test duration', () => {
    const result = parseJUnitXML(fixture('all-pass.xml'));
    result.results.forEach((r) => {
      expect(r.duration).toBeGreaterThan(0);
    });
  });

  it('sets suite name from testsuite', () => {
    const result = parseJUnitXML(fixture('all-pass.xml'));
    const validationTests = result.results.filter(
      (r) => r.suite === 'tests/unit/validation.test.ts'
    );
    expect(validationTests).toHaveLength(2);
  });

  it('handles mixed results with both single and triple failures', () => {
    const result = parseJUnitXML(fixture('mixed-results.xml'));

    const passing = result.results.filter((r) => r.status === 'passed');
    const failed = result.results.filter((r) => r.status === 'failed');

    expect(passing).toHaveLength(4);

    const cacheFailures = failed.filter((r) =>
      r.testName.includes('cache')
    );
    expect(cacheFailures).toHaveLength(1);
    expect(cacheFailures[0].retryIndex).toBe(0);

    const refactorFailures = failed.filter((r) =>
      r.testName.includes('getTasksByIds')
    );
    expect(refactorFailures).toHaveLength(3);
    expect(refactorFailures.map((r) => r.retryIndex)).toEqual([0, 1, 2]);
  });
});

describe('parseJUnitXMLFiles', () => {
  it('parses multiple XML files from a directory', () => {
    const fixtureDir = path.join(__dirname, '..', 'fixtures');
    const results = parseJUnitXMLFiles(fixtureDir);
    expect(results.length).toBe(4);
    results.forEach((r) => {
      expect(r.file).toBeDefined();
      expect(r.results.length).toBeGreaterThan(0);
    });
  });
});
