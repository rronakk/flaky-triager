import { describe, it } from 'vitest';

/**
 * Planted intermittent flake for validating the flaky-triager's
 * recommender + PR-creator path.
 *
 * Why `retry: 0`: vitest's default JUnit reporter only records the FINAL
 * outcome of a retried test. If the test fails attempt 1 and passes
 * attempt 2, the XML shows it as passing with no failure element — our
 * scorer would see no within-run divergence and classify it as passing.
 * Disabling retries on this test means its actual outcome (pass OR fail)
 * lands in the XML. Across runs, history accumulates mixed pass/fail,
 * and the Phase 7 history upgrade promotes inconclusive verdicts to
 * flaky after 2-3 runs.
 *
 * Delete this file to remove the planted flake.
 */
describe('intermittent flake (planted for triager validation)', () => {
  // Keeping the same test name as the earlier Math.random version preserves
  // the testKey, so the Firestore history (which has multiple passing AND
  // inconclusive records from prior runs) carries over. With current verdict
  // = inconclusive + history showing pass+incon, the scorer's upgrade rule
  // fires → verdict = flaky → recommender → quarantine PR.
  it('fails about half the time, no retries', { retry: 0 }, () => {
    throw new Error('Planted failure (deterministic) — validates quarantine PR creation');
  });
});
