import { XMLParser } from 'fast-xml-parser';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import type { TestResult, TestRunSummary } from '../types.js';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => name === 'testsuite' || name === 'testcase' || name === 'failure',
});

export function parseJUnitXML(xml: string, sourceFile?: string): TestRunSummary {
  const parsed = xmlParser.parse(xml);
  const root = parsed.testsuites ?? parsed.testsuite;
  const results: TestResult[] = [];

  const suites: any[] = root.testsuite ?? [root];

  for (const suite of suites) {
    const suiteName = suite['@_name'] ?? 'unknown';
    const testcases: any[] = suite.testcase ?? [];

    for (const tc of testcases) {
      const testName = tc['@_name']?.replace(/&gt;/g, '>') ?? 'unknown';
      const className = tc['@_classname'] ?? suiteName;
      const duration = parseFloat(tc['@_time'] ?? '0');
      const failures: any[] = tc.failure ?? [];
      const isSkipped = tc.skipped !== undefined;

      if (failures.length === 0) {
        results.push({
          testName,
          suite: suiteName,
          className,
          status: isSkipped ? 'skipped' : 'passed',
          duration,
          retryIndex: 0,
        });
      } else {
        for (let i = 0; i < failures.length; i++) {
          const failure = failures[i];
          const message = typeof failure === 'string'
            ? failure
            : failure['@_message'] ?? '';
          const trace = typeof failure === 'string'
            ? failure
            : failure['#text'] ?? failure['@_message'] ?? '';

          results.push({
            testName,
            suite: suiteName,
            className,
            status: 'failed',
            duration,
            failureMessage: message,
            stackTrace: trace,
            retryIndex: i,
          });
        }
      }
    }
  }

  return {
    file: sourceFile ?? 'unknown',
    timestamp: root['@_timestamp'] ?? suites[0]?.['@_timestamp'],
    totalTests: parseInt(root['@_tests'] ?? `${results.length}`),
    failures: parseInt(root['@_failures'] ?? '0'),
    errors: parseInt(root['@_errors'] ?? '0'),
    skipped: parseInt(root['@_skipped'] ?? '0'),
    duration: parseFloat(root['@_time'] ?? '0'),
    results,
  };
}

export function parseJUnitXMLFiles(dir: string): TestRunSummary[] {
  const files = readdirSync(dir).filter((f) => f.endsWith('.xml'));
  return files.map((file) => {
    const content = readFileSync(path.join(dir, file), 'utf-8');
    return parseJUnitXML(content, file);
  });
}
