import * as fs from 'node:fs';
import type { Verdict } from '../types.js';

export interface QuarantineEntry {
  suite: string;
  testName: string;
  addedAt: string;
  verdict: Verdict;
  flakinessScore: number;
  reason: string;
}

export interface Quarantine {
  version: 1;
  entries: QuarantineEntry[];
}

export function emptyQuarantine(): Quarantine {
  return { version: 1, entries: [] };
}

export function readQuarantineFile(path: string): Quarantine {
  if (!fs.existsSync(path)) return emptyQuarantine();
  const raw = fs.readFileSync(path, 'utf-8');
  try {
    const parsed = JSON.parse(raw) as Quarantine;
    if (!Array.isArray(parsed.entries)) {
      return { version: 1, entries: [] };
    }
    return { version: 1, entries: parsed.entries };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse quarantine file at ${path}: ${msg}`);
  }
}

export function writeQuarantineFile(path: string, q: Quarantine): void {
  fs.writeFileSync(path, JSON.stringify(q, null, 2) + '\n', 'utf-8');
}

export function isQuarantined(q: Quarantine, suite: string, testName: string): boolean {
  return q.entries.some((e) => e.suite === suite && e.testName === testName);
}

export function addEntries(q: Quarantine, entries: QuarantineEntry[]): Quarantine {
  const out = [...q.entries];
  const seen = new Set(out.map((e) => `${e.suite}::${e.testName}`));
  for (const e of entries) {
    const key = `${e.suite}::${e.testName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return { version: 1, entries: out };
}

export function removeEntries(
  q: Quarantine,
  keys: Array<{ suite: string; testName: string }>,
): Quarantine {
  const remove = new Set(keys.map((k) => `${k.suite}::${k.testName}`));
  return {
    version: 1,
    entries: q.entries.filter((e) => !remove.has(`${e.suite}::${e.testName}`)),
  };
}
