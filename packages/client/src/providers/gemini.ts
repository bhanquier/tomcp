import type { LLMProvider } from './types.js'

export interface GeminiProviderOptions {
  apiKey?: string
  model?: string
}

export function createGeminiProvider(opts?: GeminiProviderOptions): LLMProvider {
  return {
    name: 'Gemini 2.5 Flash',
    async generateCode(prompt: string): Promise<string> {
      const { GoogleGenAI } = await import('@google/genai')
      const apiKey = opts?.apiKey ?? process.env.GEMINI_API_KEY
      if (!apiKey) throw new Error('GEMINI_API_KEY not set and no apiKey provided')
      const genai = new GoogleGenAI({ apiKey })
      const response = await genai.models.generateContent({
        model: opts?.model ?? 'gemini-2.5-flash',
        contents: prompt,
        config: { maxOutputTokens: 8192 },
      })
      const text = response.text
      if (!text) throw new Error('No text response from Gemini')
      return text
    },
  }
}
