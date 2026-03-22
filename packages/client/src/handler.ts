import type { TransferDescriptor } from '@tomcp/types'
import type { LLMProvider } from './providers/types.js'
import { executeTransfer, type ExecutionResult, type ExecuteOptions } from './executor.js'
import { isLevel1, executeLevel1 } from './level1.js'
import { codeCache } from './code-cache.js'
import { executeSandboxed } from './sandbox.js'

export interface HandleOptions {
  provider?: LLMProvider
  systemPrompt?: string
  retryCount?: number
  /** Disable the code cache (Level 1.5). Default: false (cache enabled). */
  noCache?: boolean
}

/**
 * Handle a Transfer Descriptor end-to-end.
 *
 * Three levels:
 *   Level 1:   No description → native handler (http, fs)
 *   Level 1.5: Description present + cached code → replay without LLM
 *   Level 2:   Description present, no cache → LLM generates code
 *
 * After a successful Level 2 execution, the code is cached (Level 1.5).
 * If cached code fails, the cache is invalidated and Level 2 runs again.
 */
export async function handleDescriptor(
  descriptor: TransferDescriptor,
  opts?: HandleOptions,
): Promise<ExecutionResult> {
  // ── Level 1: no description → native handler ──
  if (isLevel1(descriptor)) {
    console.error(`  [handler] Level 1 transfer (${descriptor.protocol}) — native`)
    const sandboxResult = await executeLevel1(descriptor)
    return buildResult(descriptor, '(Level 1 — native handler)', sandboxResult.stdout, sandboxResult)
  }

  const descriptionText = descriptor.description!.text

  // ── Level 1.5: cached code → replay ──
  if (!opts?.noCache) {
    const cached = codeCache.get(descriptionText)
    if (cached) {
      console.error(`  [handler] Level 1.5 transfer (${descriptor.protocol}) — cached code (${cached.hits} hits)`)
      const sandboxResult = await executeSandboxed({
        code: cached.code,
        runtime: descriptor.sandbox?.runtime ?? 'node',
        timeout_ms: descriptor.sandbox?.timeout_ms ?? 30_000,
      })

      if (sandboxResult.exitCode === 0 && sandboxResult.stdout.trim()) {
        // Cache hit succeeded
        return buildResult(descriptor, cached.code, sandboxResult.stdout, sandboxResult)
      }

      // Cache hit failed — invalidate and fall through to Level 2
      console.error(`  [handler] Cached code failed — invalidating and falling back to Level 2`)
      codeCache.invalidate(descriptionText)
    }
  }

  // ── Level 2: LLM generates code ──
  console.error(`  [handler] Level 2 transfer (${descriptor.protocol}) — LLM code generation`)
  const result = await executeTransfer(descriptor, {
    provider: opts?.provider,
    systemPrompt: opts?.systemPrompt,
    retryCount: opts?.retryCount,
  })

  // Cache successful code for future Level 1.5 use
  if (result.success && !opts?.noCache) {
    codeCache.set(descriptionText, result.generatedCode, descriptor.protocol)
    console.error(`  [handler] Code cached for future Level 1.5 use (hash: ${codeCache.hash(descriptionText)})`)
  }

  return result
}

// ── Helper ──

function buildResult(
  descriptor: TransferDescriptor,
  generatedCode: string,
  stdout: string,
  sandboxResult: { stdout: string; stderr: string; exitCode: number; timedOut: boolean },
): ExecutionResult {
  let parsedOutput: unknown = null
  let success = false

  if (sandboxResult.exitCode === 0 && stdout.trim()) {
    try {
      parsedOutput = JSON.parse(stdout.trim())
      success = true
    } catch {
      parsedOutput = stdout.trim()
      success = true
    }
  }

  return { descriptor, generatedCode, sandboxResult, parsedOutput, success }
}
