/**
 * Protocol Composition — combine multiple protocol descriptions into one.
 *
 * An agent needs to: authenticate via OAuth2, then paginate through
 * a REST API, then parse the CSV response. Instead of three separate
 * transfers, compose them into a single Level 2 description that the
 * LLM executes as one script.
 *
 * This is where Level 2 gets creative: the LLM doesn't just follow
 * one protocol — it synthesizes multiple protocols into a coherent
 * implementation.
 */

import { randomUUID } from 'node:crypto'
import { marketplace, type ProtocolEntry } from './marketplace.js'
import type { TransferDescriptor } from '@tomcp/types'

export interface CompositionStep {
  /** Protocol ID from marketplace, or inline description */
  protocol_id?: string
  /** Inline description (overrides marketplace lookup) */
  description?: string
  /** Label for this step in the composed description */
  label: string
  /** Variables to inject (e.g., { "TOKEN_URL": "https://..." }) */
  variables?: Record<string, string>
}

export interface ComposeOptions {
  /** Steps to compose, in execution order */
  steps: CompositionStep[]
  /** Target endpoint for the final transfer */
  endpoint: string
  /** Auth for the endpoint */
  auth?: { type: 'bearer' | 'header'; value: string; header_name?: string }
  /** Expected output format */
  format?: string
  /** Sandbox config */
  sandbox?: { runtime: 'node' | 'python'; timeout_ms: number; allowed_hosts: string[] }
}

/**
 * Compose multiple protocol descriptions into a single Transfer Descriptor.
 *
 * Each step's description is merged into one comprehensive guide that
 * the LLM executes as a single script.
 */
export function compose(opts: ComposeOptions): TransferDescriptor {
  const sections: string[] = [
    '## Composed Protocol',
    '',
    `This transfer combines ${opts.steps.length} protocol steps into one script.`,
    `Execute ALL steps in order within a single Node.js script.`,
    '',
  ]

  for (let i = 0; i < opts.steps.length; i++) {
    const step = opts.steps[i]
    const stepNum = i + 1

    sections.push(`### Step ${stepNum}: ${step.label}`)
    sections.push('')

    // Get description from marketplace or inline
    let description = step.description
    if (!description && step.protocol_id) {
      const entry = marketplace.get(step.protocol_id)
      if (entry) {
        description = entry.tiers.high
      } else {
        description = `(Protocol "${step.protocol_id}" not found in marketplace)`
      }
    }

    if (description) {
      // Inject variables
      let processed = description
      if (step.variables) {
        for (const [key, value] of Object.entries(step.variables)) {
          processed = processed.replaceAll(`{${key}}`, value)
        }
      }
      sections.push(processed)
    }

    sections.push('')
  }

  sections.push('### Final Output')
  sections.push('Print the final result to stdout as JSON.')
  sections.push('The result should reflect the output of the LAST step.')

  // Collect all allowed hosts from steps
  const allHosts = new Set(opts.sandbox?.allowed_hosts ?? [])
  if (opts.endpoint) {
    try {
      allHosts.add(new URL(opts.endpoint).host)
    } catch { /* not a valid URL, skip */ }
  }
  for (const step of opts.steps) {
    if (step.variables) {
      for (const value of Object.values(step.variables)) {
        try {
          allHosts.add(new URL(value).host)
        } catch { /* not a URL */ }
      }
    }
  }

  return {
    $schema: 'tomcp/v0.1',
    transfer_id: randomUUID(),
    mode: 'fetch',
    protocol: `composed-${opts.steps.length}-steps`,
    endpoint: opts.endpoint,
    format: opts.format ?? 'json',
    fallback: 'error',
    auth: opts.auth,
    description: {
      tier: 'high',
      text: sections.join('\n'),
    },
    sandbox: {
      runtime: opts.sandbox?.runtime ?? 'node',
      timeout_ms: opts.sandbox?.timeout_ms ?? 60_000,
      allowed_hosts: Array.from(allHosts),
    },
  }
}
