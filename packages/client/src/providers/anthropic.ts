import type { LLMProvider } from './types.js'

export interface AnthropicProviderOptions {
  apiKey?: string
  model?: string
}

export function createAnthropicProvider(opts?: AnthropicProviderOptions): LLMProvider {
  return {
    name: 'Claude Sonnet',
    async generateCode(prompt: string): Promise<string> {
      const { default: Anthropic } = await import('@anthropic-ai/sdk')
      const apiKey = opts?.apiKey ?? process.env.ANTHROPIC_API_KEY
      if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set and no apiKey provided')
      const client = new Anthropic({ apiKey })
      const response = await client.messages.create({
        model: opts?.model ?? 'claude-sonnet-4-20250514',
        max_tokens: 8192,
        system: prompt.split('\n\n')[0],  // First paragraph as system
        messages: [{ role: 'user', content: prompt }],
      })
      const textBlock = response.content.find((b) => b.type === 'text')
      if (!textBlock || textBlock.type !== 'text') throw new Error('No text response from Anthropic')
      return textBlock.text
    },
  }
}
