import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider } from './types.js';
import type { FailureContext, Analysis } from '../../types.js';
import { ANALYSIS_JSON_SCHEMA, SYSTEM_PROMPT, buildUserPrompt } from '../prompt.js';

export interface ClaudeProviderOptions {
  apiKey?: string;
  model?: string;
}

export function createClaudeProvider(options: ClaudeProviderOptions = {}): LLMProvider {
  const client = new Anthropic({ apiKey: options.apiKey });
  const model = options.model ?? 'claude-opus-4-7';

  return {
    name: 'claude',
    async analyze(context: FailureContext): Promise<Analysis> {
      const response = await client.messages.create({
        model,
        max_tokens: 1024,
        system: [
          {
            type: 'text',
            text: SYSTEM_PROMPT,
            cache_control: { type: 'ephemeral' },
          },
        ],
        output_config: {
          format: {
            type: 'json_schema',
            schema: ANALYSIS_JSON_SCHEMA,
          },
        },
        messages: [{ role: 'user', content: buildUserPrompt(context) }],
      });

      const textBlock = response.content.find((b) => b.type === 'text');
      if (!textBlock || textBlock.type !== 'text') {
        throw new Error('Claude response contained no text block');
      }
      return JSON.parse(textBlock.text) as Analysis;
    },
  };
}
