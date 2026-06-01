import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import type { Quarantine } from './file.js';

interface TestCase {
  '@_classname'?: string;
  '@_name'?: string;
  failure?: unknown;
  skipped?: unknown;
}

interface TestSuite {
  '@_name'?: string;
  '@_failures'?: string | number;
  '@_skipped'?: string | number;
  testcase?: TestCase | TestCase[];
}

interface Parsed {
  testsuites?: {
    '@_failures'?: string | number;
    '@_skipped'?: string | number;
    testsuite?: TestSuite | TestSuite[];
  };
  testsuite?: TestSuite | TestSuite[];
  '?xml'?: unknown;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  ignoreDeclaration: false,
  preserveOrder: false,
});

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: true,
  suppressEmptyNode: false,
});

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function matchesQuarantine(
  suiteName: string,
  testCase: TestCase,
  quarantineKeys: Set<string>,
): boolean {
  const testName = testCase['@_name'] ?? '';
  const classname = testCase['@_classname'] ?? '';
  return (
    quarantineKeys.has(`${classname}::${testName}`) ||
    quarantineKeys.has(`${suiteName}::${testName}`)
  );
}

export interface FilterResult {
  xml: string;
  skippedCount: number;
}

export function filterJunitXml(xml: string, quarantine: Quarantine): FilterResult {
  if (quarantine.entries.length === 0) {
    return { xml, skippedCount: 0 };
  }

  const quarantineKeys = new Set(quarantine.entries.map((e) => `${e.suite}::${e.testName}`));
  const parsed = parser.parse(xml) as Parsed;

  let skippedCount = 0;
  const root = parsed.testsuites ?? parsed;
  const suites = toArray(parsed.testsuites?.testsuite ?? parsed.testsuite);

  for (const suite of suites) {
    const suiteName = suite['@_name'] ?? '';
    const testcases = toArray(suite.testcase);
    let suiteSkippedAdded = 0;

    for (const tc of testcases) {
      if (!tc.failure) continue;
      if (matchesQuarantine(suiteName, tc, quarantineKeys)) {
        delete tc.failure;
        tc.skipped = { '@_message': 'quarantined by flaky-triager' };
        suiteSkippedAdded++;
      }
    }

    if (suiteSkippedAdded > 0) {
      const currentFailures = Number(suite['@_failures'] ?? 0);
      const currentSkipped = Number(suite['@_skipped'] ?? 0);
      suite['@_failures'] = String(Math.max(0, currentFailures - suiteSkippedAdded));
      suite['@_skipped'] = String(currentSkipped + suiteSkippedAdded);
      skippedCount += suiteSkippedAdded;
    }
  }

  if (skippedCount > 0 && parsed.testsuites) {
    const ts = parsed.testsuites;
    const currentFailures = Number(ts['@_failures'] ?? 0);
    const currentSkipped = Number(ts['@_skipped'] ?? 0);
    ts['@_failures'] = String(Math.max(0, currentFailures - skippedCount));
    ts['@_skipped'] = String(currentSkipped + skippedCount);
  }

  const output = builder.build(parsed) as string;
  return { xml: output, skippedCount };
}
