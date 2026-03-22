import type { TransferDescriptor } from '@tomcp/types'
import type { LLMProvider } from './providers/types.js'
import { executeTransfer, type ExecutionResult, type ExecuteOptions } from './executor.js'
import { isLevel1, executeLevel1 } from './level1.js'
import { codeCache, type CodeCacheInterface } from './code-cache.js'
import { executeSandboxed } from './sandbox.js'
import { tracer } from './trace.js'

export interface HandleOptions {
  provider?: LLMProvider
  systemPrompt?: string
  retryCount?: number
  /** Disable the code cache (Level 1.5). Default: false (cache enabled). */
  noCache?: boolean
  /** Custom cache implementation (e.g. RedisCodeCache). Defaults to in-memory singleton. */
  cache?: CodeCacheInterface
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
  const cache = opts?.cache ?? codeCache

  // ── Level 1: no description → native handler ──
  if (isLevel1(descriptor)) {
    console.error(`  [handler] Level 1 transfer (${descriptor.protocol}) — native`)
    const trace = tracer.start({
      transfer_id: descriptor.transfer_id,
      protocol: descriptor.protocol,
      mode: descriptor.mode,
      level: '1',
    })
    try {
      const sandboxResult = await executeLevel1(descriptor)
      const result = buildResult(descriptor, '(Level 1 — native handler)', sandboxResult.stdout, sandboxResult)
      tracer.complete(trace, {
        status: result.success ? 'success' : 'failure',
        bytes_received: sandboxResult.stdout.length,
        error: result.success ? undefined : sandboxResult.stderr?.slice(0, 500),
      })
      return result
    } catch (err) {
      tracer.complete(trace, { status: 'failure', error: String(err) })
      throw err
    }
  }

  const descriptionText = descriptor.description!.text

  // ── Level 1.5: cached code → replay ──
  if (!opts?.noCache) {
    const cached = await cache.get(descriptionText)
    if (cached) {
      console.error(`  [handler] Level 1.5 transfer (${descriptor.protocol}) — cached code (${cached.hits} hits)`)
      const cacheTrace = tracer.start({
        transfer_id: descriptor.transfer_id,
        protocol: descriptor.protocol,
        mode: descriptor.mode,
        level: '1.5',
        cache_hit: true,
        cache_hash: cache.hash(descriptionText),
      })
      const sandboxResult = await executeSandboxed({
        code: cached.code,
        runtime: descriptor.sandbox?.runtime ?? 'node',
        timeout_ms: descriptor.sandbox?.timeout_ms ?? 30_000,
      })

      if (sandboxResult.exitCode === 0 && sandboxResult.stdout.trim()) {
        // Cache hit succeeded
        const result = buildResult(descriptor, cached.code, sandboxResult.stdout, sandboxResult)
        tracer.complete(cacheTrace, {
          status: 'success',
          code_lines: cached.code.split('\n').length,
          bytes_received: sandboxResult.stdout.length,
        })
        return result
      }

      // Cache hit failed — invalidate and fall through to Level 2
      console.error(`  [handler] Cached code failed — invalidating and falling back to Level 2`)
      tracer.complete(cacheTrace, {
        status: 'failure',
        error: sandboxResult.stderr?.slice(0, 500) || 'cached code produced no output',
      })
      await cache.invalidate(descriptionText)
    }
  }

  // ── Level 2: LLM generates code ──
  console.error(`  [handler] Level 2 transfer (${descriptor.protocol}) — LLM code generation`)
  const provider = opts?.provider
  const l2Trace = tracer.start({
    transfer_id: descriptor.transfer_id,
    protocol: descriptor.protocol,
    mode: descriptor.mode,
    level: '2',
    provider: provider?.name,
  })

  try {
    const result = await executeTransfer(descriptor, {
      provider,
      systemPrompt: opts?.systemPrompt,
      retryCount: opts?.retryCount,
    })

    tracer.complete(l2Trace, {
      status: result.success ? 'success' : 'failure',
      code_lines: result.generatedCode.split('\n').length,
      bytes_received: result.sandboxResult.stdout.length,
      error: result.success ? undefined : result.sandboxResult.stderr?.slice(0, 500),
    })

    // Cache successful code for future Level 1.5 use
    if (result.success && !opts?.noCache) {
      await cache.set(descriptionText, result.generatedCode, descriptor.protocol)
      console.error(`  [handler] Code cached for future Level 1.5 use (hash: ${cache.hash(descriptionText)})`)
    }

    return result
  } catch (err) {
    tracer.complete(l2Trace, { status: 'failure', error: String(err) })
    throw err
  }
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
