import { describe, it } from 'vitest';

/**
 * Deterministic flake for validating the flaky-triager. Always fails on
 * the first attempt within a test run, then passes on retry — guarantees
 * same-SHA pass/fail divergence so the scorer classifies this as flaky on
 * every run, no Math.random dice-rolling. Delete this file to remove the
 * planted flake.
 *
 * The module-level `didFailOnce` flag persists across vitest's retry
 * attempts (same worker process, same module instance) but resets between
 * runs.
 */
let didFailOnce = false;

describe('deterministic flake (planted for triager validation)', () => {
  it('fails on first attempt, passes on retry', () => {
    if (!didFailOnce) {
      didFailOnce = true;
      throw new Error('Planted: deterministic first-attempt failure for triager');
    }
  });
});
