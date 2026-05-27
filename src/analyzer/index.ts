import type { ScoredResult, Analysis } from '../types.js';
import type { LLMProvider } from './providers/types.js';

export type AnalyzedResult = ScoredResult & { analysis?: Analysis };

export async function analyzeFailures(
  scored: ScoredResult[],
  provider: LLMProvider,
): Promise<AnalyzedResult[]> {
  const results: AnalyzedResult[] = [];

  for (const item of scored) {
    if (item.verdict === 'passing') {
      results.push({ ...item });
      continue;
    }

    try {
      const analysis = await provider.analyze({
        testName: item.testName,
        suite: item.suite,
        failureMessage: item.failureMessage ?? '',
        stackTrace: item.stackTrace ?? '',
      });
      results.push({ ...item, analysis });
    } catch (err) {
      results.push({
        ...item,
        analysis: {
          rootCauseCategory: 'unknown',
          explanation: `Analysis failed: ${err instanceof Error ? err.message : String(err)}`,
          suggestedFix: '',
          confidence: 'low',
        },
      });
    }
  }

  return results;
}
