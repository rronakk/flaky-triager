import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { readQuarantineFile } from './quarantine/file.js';
import { filterJunitXml } from './quarantine/filterJunit.js';

const [xmlPath, quarantinePath = '.flaky-quarantine.json'] = process.argv.slice(2);

if (!xmlPath) {
  console.error('Usage: filter-junit <xml-file-or-dir> [quarantine-file]');
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
console.log(`Total demoted: ${totalSkipped}`);
