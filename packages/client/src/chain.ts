/**
 * Transfer Chains — multi-hop data pipelines between agents.
 *
 * A chain is a sequence of Transfer Descriptors executed in order.
 * The output of each step becomes the input of the next.
 *
 * Example: fetch from API A → transform via API B → deliver to API C
 *
 * ```
 * Agent A (data source)  →  Agent B (transformer)  →  Agent C (destination)
 *        fetch                   push+fetch                push
 * ```
 *
 * MCP orchestrates the chain. Data flows directly between endpoints.
 */

import type { TransferDescriptor } from '@tomcp/types'
import { handleDescriptor, type HandleOptions } from './handler.js'
import type { ExecutionResult } from './executor.js'
import { tracer } from './trace.js'

export interface ChainStep {
  /** Human-readable label for this step */
  label: string
  /** The Transfer Descriptor for this step */
  descriptor: TransferDescriptor
  /**
   * Transform function applied to the output before passing to the next step.
   * Receives the parsed output and returns the data for the next step.
   * If not provided, the raw output is passed through.
   */
  transform?: (output: unknown) => unknown
}

export interface ChainResult {
  /** Whether all steps completed successfully */
  success: boolean
  /** Results of each step */
  steps: Array<{
    label: string
    result: ExecutionResult
    duration_ms: number
  }>
  /** Final output of the chain (output of the last step) */
  finalOutput: unknown
  /** Total duration across all steps */
  total_duration_ms: number
}

/**
 * Execute a chain of transfers in sequence.
 *
 * Each step's output is available to the next step via the transform function.
 * If any step fails, the chain stops and returns partial results.
 */
export async function executeChain(
  steps: ChainStep[],
  opts?: HandleOptions,
): Promise<ChainResult> {
  const startTime = Date.now()
  const stepResults: ChainResult['steps'] = []
  let lastOutput: unknown = null

  console.error(`[chain] Starting ${steps.length}-step transfer chain`)

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    const stepStart = Date.now()

    console.error(`[chain] Step ${i + 1}/${steps.length}: ${step.label}`)

    const result = await handleDescriptor(step.descriptor, opts)

    const duration_ms = Date.now() - stepStart
    stepResults.push({ label: step.label, result, duration_ms })

    if (!result.success) {
      console.error(`[chain] Step ${i + 1} failed — chain aborted`)
      return {
        success: false,
        steps: stepResults,
        finalOutput: null,
        total_duration_ms: Date.now() - startTime,
      }
    }

    // Apply transform if provided
    lastOutput = step.transform
      ? step.transform(result.parsedOutput)
      : result.parsedOutput

    console.error(`[chain] Step ${i + 1} complete (${duration_ms}ms)`)
  }

  const total_duration_ms = Date.now() - startTime
  console.error(`[chain] Chain complete — ${steps.length} steps in ${total_duration_ms}ms`)

  return {
    success: true,
    steps: stepResults,
    finalOutput: lastOutput,
    total_duration_ms,
  }
}

/**
 * Build a simple fetch→transform→deliver chain from descriptors.
 */
export function buildChain(steps: Array<{
  label: string
  descriptor: TransferDescriptor
  transform?: (output: unknown) => unknown
}>): ChainStep[] {
  return steps
}

/**
 * Utility: create a passthrough chain step (no transform).
 */
export function chainStep(label: string, descriptor: TransferDescriptor): ChainStep {
  return { label, descriptor }
}
