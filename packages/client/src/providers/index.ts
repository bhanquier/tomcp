export type { LLMProvider } from './types.js'
export { createGeminiProvider, type GeminiProviderOptions } from './gemini.js'
export { createAnthropicProvider, type AnthropicProviderOptions } from './anthropic.js'

import type { LLMProvider } from './types.js'
import { createGeminiProvider } from './gemini.js'
import { createAnthropicProvider } from './anthropic.js'

/**
 * Auto-detect LLM provider from environment variables.
 * Prefers GEMINI_API_KEY, falls back to ANTHROPIC_API_KEY.
 */
export function autoDetectProvider(): LLMProvider {
  if (process.env.GEMINI_API_KEY) return createGeminiProvider()
  if (process.env.ANTHROPIC_API_KEY) return createAnthropicProvider()
  throw new Error('No LLM API key found. Set GEMINI_API_KEY or ANTHROPIC_API_KEY.')
}
