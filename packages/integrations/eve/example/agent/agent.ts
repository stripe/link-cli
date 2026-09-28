import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { defineAgent } from 'eve';

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

export default defineAgent({
  model: openrouter('openai/gpt-6-luna'),
  modelContextWindowTokens: 1_000_000,
});
