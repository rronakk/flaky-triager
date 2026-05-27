import type { FailureContext, Analysis } from '../../types.js';

export interface LLMProvider {
  name: string;
  analyze(context: FailureContext): Promise<Analysis>;
}
