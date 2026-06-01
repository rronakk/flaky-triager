import { parseJUnitXMLFiles } from './parser/index.js';
import { scoreTestResults } from './scorer/index.js';
import { analyzeFailures } from './analyzer/index.js';
import { createClaudeProvider } from './analyzer/providers/claude.js';
import { formatReport, type ReportFormat } from './reporter/index.js';
import { FirestoreHistoryStore, testKeyFor } from './history/index.js';
import { readQuarantineFile } from './quarantine/file.js';
import { filterJunitXml } from './quarantine/filterJunit.js';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

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
} else if (command === 'analyze') {
  const dir = args[0];
  if (!dir) {
    console.error('Usage: flaky-triager analyze <directory>');
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set. Export it before running `analyze`.');
    process.exit(1);
  }

  const summaries = parseJUnitXMLFiles(dir);
  const allResults = summaries.flatMap((s) => s.results);
  const scored = scoreTestResults(allResults);
  const provider = createClaudeProvider();
  const analyzed = await analyzeFailures(scored, provider);

  for (const r of analyzed) {
    if (r.verdict === 'passing') continue;
    console.log(`\n${'='.repeat(60)}`);
    console.log(`${r.verdict.toUpperCase()} [${r.flakinessScore}] ${r.suite} > ${r.testName}`);
    if (r.analysis) {
      console.log(`Category:    ${r.analysis.rootCauseCategory}`);
      console.log(`Confidence:  ${r.analysis.confidence}`);
      console.log(`Explanation: ${r.analysis.explanation}`);
      console.log(`Fix:         ${r.analysis.suggestedFix}`);
    }
  }
} else if (command === 'report') {
  const dir = args[0];
  const formatArg = (args[1] ?? 'cli') as ReportFormat;
  if (!dir) {
    console.error('Usage: flaky-triager report <directory> [markdown|cli|json]');
    process.exit(1);
  }
  if (!['markdown', 'cli', 'json'].includes(formatArg)) {
    console.error(`Unknown format "${formatArg}". Use markdown, cli, or json.`);
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set. Export it before running `report`.');
    process.exit(1);
  }

  const summaries = parseJUnitXMLFiles(dir);
  const allResults = summaries.flatMap((s) => s.results);
  const scored = scoreTestResults(allResults);
  const provider = createClaudeProvider();
  const analyzed = await analyzeFailures(scored, provider);
  console.log(formatReport(analyzed, formatArg));
} else if (command === 'filter-junit') {
  const xmlPath = args[0];
  const quarantinePath = args[1] ?? '.flaky-quarantine.json';
  if (!xmlPath) {
    console.error('Usage: flaky-triager filter-junit <xml-file-or-dir> [quarantine-file]');
    console.error('  Rewrites the JUnit XML so quarantined-test failures become skipped.');
    console.error('  Files are modified in place.');
    process.exit(1);
  }
  const q = readQuarantineFile(resolve(quarantinePath));
  const targets: string[] = [];
  const xmlAbs = resolve(xmlPath);
  if (statSync(xmlAbs).isDirectory()) {
    for (const f of readdirSync(xmlAbs)) {
      if (f.endsWith('.xml')) targets.push(join(xmlAbs, f));
    }
  } else {
    targets.push(xmlAbs);
  }
  let totalSkipped = 0;
  for (const file of targets) {
    const xml = readFileSync(file, 'utf-8');
    const { xml: out, skippedCount } = filterJunitXml(xml, q);
    if (skippedCount > 0) {
      writeFileSync(file, out, 'utf-8');
      console.log(`  ${file}: demoted ${skippedCount} quarantined failure(s) to skipped`);
      totalSkipped += skippedCount;
    }
  }
  console.log(`\nTotal demoted: ${totalSkipped}`);
} else if (command === 'history') {
  const suite = args[0];
  const testName = args[1];
  const limit = args[2] ? Number(args[2]) : 20;
  if (!suite || !testName) {
    console.error('Usage: flaky-triager history <suite> <test-name> [limit]');
    console.error('Requires GOOGLE_APPLICATION_CREDENTIALS to point at a Firestore-enabled GCP service account.');
    process.exit(1);
  }

  const store = new FirestoreHistoryStore();
  const records = await store.getHistory(testKeyFor(suite, testName), limit);
  if (records.length === 0) {
    console.log(`No history found for ${suite} > ${testName}`);
  } else {
    console.log(`History for ${suite} > ${testName} (${records.length} records, newest first):\n`);
    for (const r of records) {
      const verdictTag = { passing: 'PASS', flaky: 'FLKY', real_break: 'BREAK', inconclusive: '????' }[r.verdict];
      console.log(`  ${verdictTag} ${r.timestamp} ${r.sha.slice(0, 8)} (${r.branch})`);
      if (r.failureMessage) {
        console.log(`        ${r.failureMessage}`);
      }
    }
  }
} else {
  console.log('Usage: flaky-triager <parse|score|analyze|report|history|filter-junit> ...');
}
