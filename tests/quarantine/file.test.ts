import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  readQuarantineFile,
  writeQuarantineFile,
  isQuarantined,
  addEntries,
  removeEntries,
  emptyQuarantine,
  type QuarantineEntry,
} from '../../src/quarantine/file.js';

function tmpFile(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quarantine-test-'));
  return path.join(dir, name);
}

function entry(overrides: Partial<QuarantineEntry> = {}): QuarantineEntry {
  return {
    suite: 'tests/unit/foo.test.ts',
    testName: 'should do X',
    addedAt: '2026-05-30T14:00:00Z',
    verdict: 'flaky',
    flakinessScore: 85,
    reason: 'Failed intermittently',
    ...overrides,
  };
}

describe('readQuarantineFile', () => {
  it('returns an empty quarantine when the file does not exist', () => {
    const q = readQuarantineFile(tmpFile('missing.json'));
    expect(q).toEqual({ version: 1, entries: [] });
  });

  it('parses an existing file', () => {
    const p = tmpFile('q.json');
    fs.writeFileSync(p, JSON.stringify({ version: 1, entries: [entry()] }));
    const q = readQuarantineFile(p);
    expect(q.entries).toHaveLength(1);
    expect(q.entries[0].testName).toBe('should do X');
  });

  it('throws a clear error on malformed JSON', () => {
    const p = tmpFile('bad.json');
    fs.writeFileSync(p, '{ not valid json');
    expect(() => readQuarantineFile(p)).toThrow(/quarantine file/i);
  });
});

describe('writeQuarantineFile', () => {
  it('writes a JSON file that round-trips', () => {
    const p = tmpFile('q.json');
    const q = { version: 1 as const, entries: [entry()] };
    writeQuarantineFile(p, q);
    const back = readQuarantineFile(p);
    expect(back).toEqual(q);
  });

  it('formats output as pretty JSON for human review', () => {
    const p = tmpFile('q.json');
    writeQuarantineFile(p, { version: 1, entries: [entry()] });
    const raw = fs.readFileSync(p, 'utf-8');
    expect(raw).toContain('\n');
    expect(raw).toContain('  ');
  });
});

describe('isQuarantined', () => {
  let q: ReturnType<typeof emptyQuarantine>;
  beforeEach(() => {
    q = { version: 1 as const, entries: [entry({ suite: 's', testName: 't' })] };
  });

  it('returns true for a matching entry', () => {
    expect(isQuarantined(q, 's', 't')).toBe(true);
  });

  it('returns false for a non-matching entry', () => {
    expect(isQuarantined(q, 's', 'other')).toBe(false);
    expect(isQuarantined(q, 'other', 't')).toBe(false);
  });

  it('returns false on an empty quarantine', () => {
    expect(isQuarantined(emptyQuarantine(), 's', 't')).toBe(false);
  });
});

describe('addEntries', () => {
  it('appends new entries', () => {
    const q = addEntries(emptyQuarantine(), [entry({ testName: 'a' }), entry({ testName: 'b' })]);
    expect(q.entries).toHaveLength(2);
  });

  it('returns the same object reference shape but does not mutate the original', () => {
    const original = emptyQuarantine();
    const after = addEntries(original, [entry()]);
    expect(original.entries).toHaveLength(0);
    expect(after.entries).toHaveLength(1);
  });

  it('does not add a duplicate when (suite, testName) already exists', () => {
    const q = addEntries(emptyQuarantine(), [entry({ suite: 's', testName: 't' })]);
    const q2 = addEntries(q, [entry({ suite: 's', testName: 't', reason: 'different' })]);
    expect(q2.entries).toHaveLength(1);
  });

  it('deduplicates within the input list itself', () => {
    const q = addEntries(emptyQuarantine(), [
      entry({ suite: 's', testName: 't' }),
      entry({ suite: 's', testName: 't' }),
    ]);
    expect(q.entries).toHaveLength(1);
  });
});

describe('removeEntries', () => {
  it('removes entries by (suite, testName)', () => {
    const q = addEntries(emptyQuarantine(), [
      entry({ suite: 's', testName: 'a' }),
      entry({ suite: 's', testName: 'b' }),
    ]);
    const q2 = removeEntries(q, [{ suite: 's', testName: 'a' }]);
    expect(q2.entries.map((e) => e.testName)).toEqual(['b']);
  });

  it('is a no-op when the key is not present', () => {
    const q = addEntries(emptyQuarantine(), [entry({ suite: 's', testName: 'a' })]);
    const q2 = removeEntries(q, [{ suite: 's', testName: 'missing' }]);
    expect(q2.entries).toHaveLength(1);
  });

  it('does not mutate the input', () => {
    const q = addEntries(emptyQuarantine(), [entry({ suite: 's', testName: 'a' })]);
    removeEntries(q, [{ suite: 's', testName: 'a' }]);
    expect(q.entries).toHaveLength(1);
  });
});
