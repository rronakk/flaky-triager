import { describe, it } from 'vitest';

/**
 * Intentionally non-deterministic test for validating the flaky-triager's
 * quarantine recommendation pipeline. Math.random() < 0.5 throws, so with
 * vitest's retry: 2 (configured in vitest.config.ts), a single run will
 * exhibit same-SHA pass-then-fail divergence — verdict=flaky — about 75%
 * of the time. Delete this file to remove the planted flake.
 */
describe('genuinely flaky (planted for triager validation)', () => {
  it('flakes about half the time via Math.random', () => {
    if (Math.random() < 0.5) {
      throw new Error('Random flake — planted to exercise flaky-triager');
    }
  });
});
