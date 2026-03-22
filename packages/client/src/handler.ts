import type { TransferDescriptor } from '@tomcp/types'
import type { LLMProvider } from './providers/types.js'
import { executeTransfer, type ExecutionResult, type ExecuteOptions } from './executor.js'
import { isLevel1, executeLevel1 } from './level1.js'

export interface HandleOptions {
  provider?: LLMProvider
  systemPrompt?: string
  retryCount?: number
}

/**
 * Handle a Transfer Descriptor end-to-end.
 * Automatically detects Level 1 (native) vs Level 2 (LLM-driven).
 */
export async function handleDescriptor(
  descriptor: TransferDescriptor,
  opts?: HandleOptions,
): Promise<ExecutionResult> {
  // Level 1: no description → use native handler
  if (isLevel1(descriptor)) {
    console.error(`  [handler] Level 1 transfer (${descriptor.protocol}) — no LLM needed`)
    const sandboxResult = await executeLevel1(descriptor)

    let parsedOutput: unknown = null
    let success = false

    if (sandboxResult.exitCode === 0 && sandboxResult.stdout.trim()) {
      try {
        parsedOutput = JSON.parse(sandboxResult.stdout.trim())
        success = true
      } catch {
        parsedOutput = sandboxResult.stdout.trim()
        success = true
      }
    }

    return {
      descriptor,
      generatedCode: '(Level 1 — native handler, no code generated)',
      sandboxResult,
      parsedOutput,
      success,
    }
  }

  // Level 2: description present → use LLM
  console.error(`  [handler] Level 2 transfer (${descriptor.protocol}) — LLM code generation`)
  return executeTransfer(descriptor, {
    provider: opts?.provider,
    systemPrompt: opts?.systemPrompt,
    retryCount: opts?.retryCount,
  })
}
