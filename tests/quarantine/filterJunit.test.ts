import { describe, it, expect } from 'vitest';
import { filterJunitXml } from '../../src/quarantine/filterJunit.js';
import { emptyQuarantine, addEntries } from '../../src/quarantine/file.js';

function entry(suite: string, testName: string) {
  return {
    suite,
    testName,
    addedAt: '2026-05-30T00:00:00Z',
    verdict: 'flaky' as const,
    flakinessScore: 85,
    reason: 'q',
  };
}

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8" ?>
<testsuites name="vitest tests" tests="3" failures="2" errors="0" time="0.5">
  <testsuite name="tests/foo.test.ts" tests="3" failures="2" errors="0" skipped="0" time="0.5">
    <testcase classname="tests/foo.test.ts" name="passes always" time="0.1"></testcase>
    <testcase classname="tests/foo.test.ts" name="flaky thing" time="0.2">
      <failure message="timeout" type="AssertionError">timeout details</failure>
    </testcase>
    <testcase classname="tests/foo.test.ts" name="real failure" time="0.2">
      <failure message="broken" type="AssertionError">broken details</failure>
    </testcase>
  </testsuite>
</testsuites>`;

describe('filterJunitXml', () => {
  it('demotes failures to skipped for quarantined tests', () => {
    const q = addEntries(emptyQuarantine(), [entry('tests/foo.test.ts', 'flaky thing')]);
    const result = filterJunitXml(SAMPLE_XML, q);
    expect(result.skippedCount).toBe(1);
    expect(result.xml).toContain('<skipped');
    expect(result.xml).toMatch(/<skipped[^/]*quarantined by flaky-triager/);
    expect(result.xml).not.toMatch(/<failure[^>]*>timeout details/);
  });

  it('leaves non-quarantined failures alone', () => {
    const q = addEntries(emptyQuarantine(), [entry('tests/foo.test.ts', 'flaky thing')]);
    const result = filterJunitXml(SAMPLE_XML, q);
    expect(result.xml).toMatch(/name="real failure"/);
    expect(result.xml).toMatch(/<failure[^>]*>broken details/);
  });

  it('updates the testsuites/testsuite failure counts after demotion', () => {
    const q = addEntries(emptyQuarantine(), [entry('tests/foo.test.ts', 'flaky thing')]);
    const result = filterJunitXml(SAMPLE_XML, q);
    expect(result.xml).toMatch(/<testsuites[^>]*failures="1"/);
    expect(result.xml).toMatch(/<testsuite[^>]*failures="1"/);
    expect(result.xml).toMatch(/<testsuite[^>]*skipped="1"/);
  });

  it('is a no-op when nothing matches the quarantine list', () => {
    const q = addEntries(emptyQuarantine(), [entry('tests/other.test.ts', 'nope')]);
    const result = filterJunitXml(SAMPLE_XML, q);
    expect(result.skippedCount).toBe(0);
    expect(result.xml).toMatch(/<failure[^>]*>timeout details/);
    expect(result.xml).toMatch(/<failure[^>]*>broken details/);
  });

  it('matches on either suite name OR classname', () => {
    const xml = `<?xml version="1.0"?>
<testsuites tests="1" failures="1">
  <testsuite name="renamed-suite" tests="1" failures="1">
    <testcase classname="tests/foo.test.ts" name="flaky thing">
      <failure message="x" type="X">x</failure>
    </testcase>
  </testsuite>
</testsuites>`;
    const q = addEntries(emptyQuarantine(), [entry('tests/foo.test.ts', 'flaky thing')]);
    const result = filterJunitXml(xml, q);
    expect(result.skippedCount).toBe(1);
  });
});
