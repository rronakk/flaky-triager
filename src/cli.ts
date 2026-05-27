import { parseJUnitXMLFiles } from './parser/index.js';

const [command, ...args] = process.argv.slice(2);

if (command === 'parse') {
  const dir = args[0];
  if (!dir) {
    console.error('Usage: flaky-triager parse <directory>');
    process.exit(1);
  }

  const summaries = parseJUnitXMLFiles(dir);
  for (const summary of summaries) {
    console.log(`\n--- ${summary.file} ---`);
    console.log(`Tests: ${summary.totalTests} | Failures: ${summary.failures} | Duration: ${summary.duration.toFixed(2)}s`);
    for (const result of summary.results) {
      const icon = result.status === 'passed' ? 'PASS' : 'FAIL';
      const retry = result.retryIndex > 0 ? ` (retry ${result.retryIndex})` : '';
      console.log(`  ${icon} ${result.suite} > ${result.testName}${retry}`);
      if (result.failureMessage) {
        console.log(`       ${result.failureMessage}`);
      }
    }
  }
} else {
  console.log('Usage: flaky-triager <parse|score|analyze> <directory>');
}
