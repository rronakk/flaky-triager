import { describe, it, expect, beforeEach } from 'vitest';
import { createHistoryStore, type InitLogger } from '../../src/history/init.js';

function makeLogger(): InitLogger & { info_msgs: string[]; warning_msgs: string[] } {
  const info_msgs: string[] = [];
  const warning_msgs: string[] = [];
  return {
    info: (m) => info_msgs.push(m),
    warning: (m) => warning_msgs.push(m),
    info_msgs,
    warning_msgs,
  };
}

describe('createHistoryStore', () => {
  let log: ReturnType<typeof makeLogger>;
  beforeEach(() => {
    log = makeLogger();
  });

  it('returns undefined and logs an info message when credentials are empty', async () => {
    const store = await createHistoryStore({ credentialsJson: '', log });
    expect(store).toBeUndefined();
    expect(log.info_msgs.some((m) => m.includes('without history'))).toBe(true);
    expect(log.warning_msgs).toHaveLength(0);
  });

  it('returns undefined and logs an info message when credentials are whitespace-only', async () => {
    const store = await createHistoryStore({ credentialsJson: '   \n  ', log });
    expect(store).toBeUndefined();
    expect(log.info_msgs.some((m) => m.includes('without history'))).toBe(true);
  });

  it('returns undefined when credentials field is omitted entirely', async () => {
    const store = await createHistoryStore({ log });
    expect(store).toBeUndefined();
    expect(log.info_msgs.some((m) => m.includes('without history'))).toBe(true);
  });

  it('returns undefined and logs a warning when credentials are not valid JSON', async () => {
    const store = await createHistoryStore({ credentialsJson: 'not json at all', log });
    expect(store).toBeUndefined();
    expect(log.warning_msgs.some((m) => m.includes('not valid JSON'))).toBe(true);
    expect(log.warning_msgs.some((m) => m.includes('without history'))).toBe(true);
  });

  it('never throws — wraps firebase-admin init failures in a warning', async () => {
    // Pass a syntactically valid JSON object that is NOT a valid service account.
    // firebase-admin's credential.cert() should reject it; createHistoryStore must
    // catch and return undefined instead of propagating the error.
    const store = await createHistoryStore({
      credentialsJson: JSON.stringify({ not: 'a service account' }),
      log,
    });
    expect(store).toBeUndefined();
    expect(log.warning_msgs.length).toBeGreaterThan(0);
  });
});
