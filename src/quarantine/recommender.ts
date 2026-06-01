import type { AnalyzedResult } from '../analyzer/index.js';
import { isQuarantined, type Quarantine, type QuarantineEntry } from './file.js';

export const RECOMMEND_MIN_SCORE = 70;

export interface RecommendOptions {
  minScore?: number;
  now?: () => Date;
}

export function recommendQuarantine(
  results: AnalyzedResult[],
  quarantine: Quarantine,
  opts: RecommendOptions = {},
): QuarantineEntry[] {
  const minScore = opts.minScore ?? RECOMMEND_MIN_SCORE;
  const now = opts.now ?? (() => new Date());
  const addedAt = now().toISOString();

  const candidates: QuarantineEntry[] = [];
  for (const r of results) {
    if (r.verdict !== 'flaky') continue;
    if (r.flakinessScore < minScore) continue;
    if (isQuarantined(quarantine, r.suite, r.testName)) continue;

    candidates.push({
      suite: r.suite,
      testName: r.testName,
      addedAt,
      verdict: r.verdict,
      flakinessScore: r.flakinessScore,
      reason: `Failed ${r.failures}/${r.totalRuns} runs (flakiness score ${r.flakinessScore}).${
        r.analysis ? ` ${r.analysis.rootCauseCategory}: ${r.analysis.explanation}` : ''
      }`,
    });
  }
  return candidates;
}
