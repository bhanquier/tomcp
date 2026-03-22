export interface LLMProvider {
  name: string
  generateCode(prompt: string): Promise<string>
}
