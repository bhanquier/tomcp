import type { TransferDescriptor } from '@tomcp/types'
import type { LLMProvider } from './providers/types.js'
import { autoDetectProvider } from './providers/index.js'
import { executeSandboxed, type SandboxResult } from './sandbox.js'

const DEFAULT_SYSTEM_PROMPT = `You are a code generator. You receive a protocol description and must generate executable Node.js code (ESM, using import syntax) that performs the described data transfer.

CRITICAL RULES:
- Output ONLY valid JavaScript code. No markdown, no backticks, no explanations, no comments before or after the code.
- The very first character of your output must be the start of the code (e.g. "import" or "(async").
- Use only Node.js built-in modules (http, https, crypto, buffer, etc.)
- Print the final result to stdout using console.log(JSON.stringify(result))
- The code must be a complete, self-contained, FINISHED script. Do not truncate or abbreviate.
- Wrap everything in an async IIFE: (async () => { ... })()
- Handle errors by printing to stderr and exiting with code 1
- ALWAYS output the COMPLETE code. Never use "..." or "// rest of code" shortcuts.`

export interface ExecutionResult {
  descriptor: TransferDescriptor
  generatedCode: string
  sandboxResult: SandboxResult
  parsedOutput: unknown
  success: boolean
}

export interface ExecuteOptions {
  provider?: LLMProvider
  systemPrompt?: string
  retryCount?: number
}

export async function executeTransfer(
  descriptor: TransferDescriptor,
  opts?: ExecuteOptions,
): Promise<ExecutionResult> {
  const provider = opts?.provider ?? autoDetectProvider()
  const systemPrompt = opts?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT

  if (opts?.retryCount && opts.retryCount > 0) {
    console.error(`  [executor] Retry attempt ${opts.retryCount} for ${descriptor.protocol}`)
  }

  // Step 1: Build prompt
  const userPrompt = buildPrompt(descriptor, systemPrompt)

  // Step 2: Call LLM
  console.error(`  [executor] Using ${provider.name}`)
  console.error(`  [executor] Generating ${descriptor.sandbox.runtime} code...`)
  const rawCode = await provider.generateCode(userPrompt)
  const generatedCode = stripMarkdownFences(rawCode)
  console.error(`  [executor] Generated ${generatedCode.split('\n').length} lines of code`)

  // Step 3: Execute in sandbox
  console.error(`  [executor] Executing in sandbox (timeout: ${descriptor.sandbox.timeout_ms}ms)...`)
  const sandboxResult = await executeSandboxed({
    code: generatedCode,
    runtime: descriptor.sandbox.runtime,
    timeout_ms: descriptor.sandbox.timeout_ms,
  })

  if (sandboxResult.stderr) {
    console.error(`  [executor] Sandbox stderr: ${sandboxResult.stderr.slice(0, 200)}`)
  }

  // Step 4: Parse output
  let parsedOutput: unknown = null
  let success = false

  if (sandboxResult.exitCode === 0 && sandboxResult.stdout.trim()) {
    try {
      parsedOutput = JSON.parse(sandboxResult.stdout.trim())
      success = true
    } catch {
      console.error(`  [executor] Failed to parse stdout as JSON`)
      parsedOutput = sandboxResult.stdout.trim()
      success = true
    }
  }

  if (sandboxResult.timedOut) {
    console.error(`  [executor] Sandbox timed out after ${descriptor.sandbox.timeout_ms}ms`)
  }

  return { descriptor, generatedCode, sandboxResult, parsedOutput, success }
}

function buildPrompt(descriptor: TransferDescriptor, systemPrompt: string): string {
  const parts = [
    systemPrompt,
    '',
    '# Transfer Protocol Description',
    '',
    `Protocol: ${descriptor.protocol}`,
    `Mode: ${descriptor.mode}`,
    `Endpoint: ${descriptor.endpoint}`,
    `Format: ${descriptor.format}`,
    '',
    descriptor.description.text,
  ]

  if (descriptor.description.constraints?.length) {
    parts.push('', '## Constraints')
    for (const c of descriptor.description.constraints) {
      parts.push(`- ${c}`)
    }
  }

  if (descriptor.description.examples?.length) {
    parts.push('', '## Example')
    for (const e of descriptor.description.examples) {
      parts.push(`\`${e}\``)
    }
  }

  parts.push(
    '',
    '## Task',
    'Generate a complete, self-contained Node.js ESM script that performs this transfer.',
    'The script must print the result to stdout as JSON.',
    'Use only Node.js built-in modules.',
  )

  return parts.join('\n')
}

function stripMarkdownFences(text: string): string {
  let code = text.trim()
  if (code.startsWith('```')) {
    code = code.replace(/^```(?:javascript|js|mjs|typescript|ts)?\n?/, '').replace(/\n?```$/, '')
  }
  return code
}
