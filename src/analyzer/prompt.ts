import type { FailureContext } from '../types.js';

export const ROOT_CAUSE_CATEGORIES = [
  'race_condition',
  'test_order_dependency',
  'external_dependency',
  'resource_contention',
  'time_sensitive',
  'random_data',
  'concurrency',
  'floating_point',
  'ui_timing',
  'genuine_bug',
  'stale_test',
  'dependency_break',
  'unknown',
] as const;

export const SYSTEM_PROMPT = `You are an expert test reliability engineer analyzing a failing test. Your job is to determine the root cause and classify it.

Classify the failure into one of these categories:
- race_condition: async timing race between operations
- test_order_dependency: depends on state set by another test
- external_dependency: network/service/IO failure outside the test
- resource_contention: file/port/db lock contention
- time_sensitive: depends on clock or time-of-day
- random_data: unseeded randomness leaks into assertions
- concurrency: shared state mutated by parallel work inside the test
- floating_point: arithmetic precision boundary
- ui_timing: element not rendered / clicked before paint
- genuine_bug: real defect in product code, not test code
- stale_test: test assertions out of date with intended behavior after a code change
- dependency_break: library/SDK version mismatch
- unknown: insufficient evidence to classify

Be specific. Cite the message/stack content that drove your decision. Keep the explanation to 2-3 sentences and the fix to 1-2 sentences.`;

export const ANALYSIS_JSON_SCHEMA = {
  type: 'object',
  properties: {
    rootCauseCategory: {
      type: 'string',
      enum: ROOT_CAUSE_CATEGORIES,
    },
    explanation: {
      type: 'string',
      description: 'Why this test failed and what the root cause is',
    },
    suggestedFix: {
      type: 'string',
      description: 'Concrete suggestion for fixing this test',
    },
    confidence: {
      type: 'string',
      enum: ['high', 'medium', 'low'],
    },
  },
  required: ['rootCauseCategory', 'explanation', 'suggestedFix', 'confidence'],
  additionalProperties: false,
} as const;

export function buildUserPrompt(context: FailureContext): string {
  const sections = [
    `## Test\n${context.suite} > ${context.testName}`,
    `## Failure Message\n\`\`\`\n${context.failureMessage}\n\`\`\``,
    `## Stack Trace\n\`\`\`\n${context.stackTrace}\n\`\`\``,
  ];
  if (context.testSourceCode) {
    sections.push(`## Test Source\n\`\`\`typescript\n${context.testSourceCode}\n\`\`\``);
  }
  if (context.relevantDiff) {
    sections.push(`## Recent Diff\n\`\`\`diff\n${context.relevantDiff}\n\`\`\``);
  }
  return sections.join('\n\n');
}
