/**
 * Protocol Negotiation — server offers multiple transfer options,
 * client picks the best one based on its capabilities.
 *
 * Like SDP offer/answer in WebRTC: server proposes candidates,
 * client selects. But deterministic and structured.
 *
 * Example:
 *   Server: "I can serve this data via HTTPS, WebTorrent, or SSE"
 *   Client: "I support HTTPS and SSE, not WebTorrent"
 *   Result: HTTPS selected (first match by priority)
 */

import type { TransferDescriptor } from '@tomcp/types'

export interface TransferOffer {
  /** Multiple transfer options, ordered by server preference (best first) */
  candidates: TransferDescriptor[]
}

export interface ClientCapabilities {
  /** Protocols the client can handle natively (Level 1) */
  protocols: string[]
  /** Whether the client supports Level 2 (LLM code generation) */
  level2: boolean
  /** Available runtimes for Level 2 */
  runtimes?: ('node' | 'python' | 'shell')[]
  /** Max payload size the client can handle inline */
  max_inline_bytes?: number
  /** Preferred format */
  preferred_format?: string
}

/**
 * Create a transfer offer with multiple candidates.
 */
export function createOffer(candidates: TransferDescriptor[]): TransferOffer {
  return { candidates }
}

/**
 * Select the best transfer candidate based on client capabilities.
 *
 * Priority:
 *   1. Level 1 match (client knows the protocol) — fastest, most reliable
 *   2. Level 2 match (client can learn the protocol) — if Level 2 supported
 *   3. First candidate with fallback: inline — last resort
 *
 * Returns the selected descriptor, or null if no match.
 */
export function selectBestCandidate(
  offer: TransferOffer,
  client: ClientCapabilities,
): TransferDescriptor | null {
  // Pass 1: Level 1 — client natively supports the protocol
  for (const candidate of offer.candidates) {
    if (client.protocols.includes(candidate.protocol)) {
      return candidate
    }
  }

  // Pass 2: Level 2 — client can learn via LLM
  if (client.level2) {
    for (const candidate of offer.candidates) {
      if (candidate.description?.text) {
        // Check runtime compatibility
        const candidateRuntime = candidate.sandbox?.runtime ?? 'node'
        const clientRuntimes = client.runtimes ?? ['node']
        if (clientRuntimes.includes(candidateRuntime)) {
          return candidate
        }
      }
    }
  }

  // Pass 3: fallback inline
  for (const candidate of offer.candidates) {
    if (candidate.fallback === 'inline') {
      return candidate
    }
  }

  return null
}

/**
 * Negotiate the best transfer: create offer + select in one step.
 */
export function negotiate(
  candidates: TransferDescriptor[],
  client: ClientCapabilities,
): { selected: TransferDescriptor | null; reason: string } {
  const offer = createOffer(candidates)
  const selected = selectBestCandidate(offer, client)

  if (!selected) {
    return { selected: null, reason: 'No compatible transfer option found' }
  }

  const isLevel1 = client.protocols.includes(selected.protocol)
  const reason = isLevel1
    ? `Level 1: client natively supports "${selected.protocol}"`
    : selected.description?.text
      ? `Level 2: client will learn "${selected.protocol}" via LLM`
      : `Fallback: inline transfer`

  return { selected, reason }
}
