import { parseJUnitXMLFiles } from './parser/index.js';
import { scoreTestResults } from './scorer/index.js';

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
} else if (command === 'score') {
  const dir = args[0];
  if (!dir) {
    console.error('Usage: flaky-triager score <directory>');
    process.exit(1);
  }
  const summaries = parseJUnitXMLFiles(dir);
  const allResults = summaries.flatMap((s) => s.results);
  const scored = scoreTestResults(allResults);

  for (const s of scored) {
    const icon = { passing: 'PASS', flaky: 'FLKY', real_break: 'BREAK', inconclusive: '????' }[s.verdict];
    console.log(`  ${icon} [${s.flakinessScore}] ${s.suite} > ${s.testName} (${s.verdict})`);
    if (s.failureMessage) {
      console.log(`       ${s.failureMessage}`);
    }
  }

  const flaky = scored.filter((s) => s.verdict === 'flaky').length;
  const inconclusive = scored.filter((s) => s.verdict === 'inconclusive').length;
  console.log(`\nSummary: ${scored.length} tests | ${flaky} flaky | ${inconclusive} inconclusive`);
} else {
  console.log('Usage: flaky-triager <parse|score|analyze> <directory>');
}
