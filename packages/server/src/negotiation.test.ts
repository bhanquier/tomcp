import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { negotiate, createOffer, selectBestCandidate, type ClientCapabilities } from './negotiation.js'
import { buildDescriptor } from './descriptor.js'

describe('Protocol Negotiation', () => {
  const httpsCandidate = buildDescriptor({
    protocol: 'https',
    endpoint: 'https://cdn.example.com/data.json',
    format: 'json',
  })

  const webtorrentCandidate = buildDescriptor({
    protocol: 'webtorrent',
    endpoint: 'magnet:?xt=urn:btih:abc123',
    format: 'binary',
    description: {
      tier: 'high' as const,
      text: 'Use webtorrent to download...',
    },
    sandbox: { runtime: 'node' as const, timeout_ms: 60000, allowed_hosts: [] },
  })

  const grpcCandidate = buildDescriptor({
    protocol: 'grpc',
    endpoint: 'grpc://api.example.com:50051',
    format: 'binary',
    description: {
      tier: 'full' as const,
      text: 'Connect to gRPC service...',
    },
    sandbox: { runtime: 'python' as const, timeout_ms: 30000, allowed_hosts: [] },
  })

  it('selects Level 1 when client supports the protocol', () => {
    const client: ClientCapabilities = {
      protocols: ['https', 'fs'],
      level2: false,
    }

    const { selected, reason } = negotiate(
      [webtorrentCandidate, httpsCandidate, grpcCandidate],
      client,
    )

    assert.ok(selected)
    assert.equal(selected.protocol, 'https')
    assert.ok(reason.includes('Level 1'))
  })

  it('selects Level 2 when client has LLM but not native support', () => {
    const client: ClientCapabilities = {
      protocols: ['fs'],  // doesn't know https or webtorrent
      level2: true,
      runtimes: ['node'],
    }

    const { selected, reason } = negotiate(
      [webtorrentCandidate, httpsCandidate, grpcCandidate],
      client,
    )

    assert.ok(selected)
    assert.equal(selected.protocol, 'webtorrent')  // first with description + matching runtime
    assert.ok(reason.includes('Level 2'))
  })

  it('respects runtime compatibility for Level 2', () => {
    const client: ClientCapabilities = {
      protocols: [],
      level2: true,
      runtimes: ['python'],  // only Python
    }

    const { selected, reason } = negotiate(
      [webtorrentCandidate, grpcCandidate],  // webtorrent=node, grpc=python
      client,
    )

    assert.ok(selected)
    assert.equal(selected.protocol, 'grpc')  // only grpc has python runtime
    assert.ok(reason.includes('Level 2'))
  })

  it('falls back to inline when no protocol matches', () => {
    const client: ClientCapabilities = {
      protocols: [],
      level2: false,
    }

    const inlineCandidate = buildDescriptor({
      protocol: 'custom-exotic',
      endpoint: 'exotic://data',
      format: 'json',
      fallback: 'inline' as const,
    })

    const { selected } = negotiate([inlineCandidate], client)
    assert.ok(selected)
    assert.equal(selected.fallback, 'inline')
  })

  it('returns null when nothing matches', () => {
    const client: ClientCapabilities = {
      protocols: [],
      level2: false,
    }

    const noFallback = buildDescriptor({
      protocol: 'exotic',
      endpoint: 'exotic://data',
      format: 'binary',
      fallback: 'error' as const,
    })

    const { selected, reason } = negotiate([noFallback], client)
    assert.equal(selected, null)
    assert.ok(reason.includes('No compatible'))
  })

  it('prefers Level 1 over Level 2 even when Level 2 is available', () => {
    const client: ClientCapabilities = {
      protocols: ['https'],
      level2: true,
      runtimes: ['node'],
    }

    // webtorrent is first but needs Level 2, https is second but Level 1
    const { selected } = negotiate(
      [webtorrentCandidate, httpsCandidate],
      client,
    )

    assert.ok(selected)
    assert.equal(selected.protocol, 'https')  // Level 1 wins
  })

  it('server priority matters within same level', () => {
    const client: ClientCapabilities = {
      protocols: ['https', 'fs'],
      level2: false,
    }

    const fsCandidate = buildDescriptor({
      protocol: 'fs',
      endpoint: '/tmp/data.json',
      format: 'json',
    })

    // Server prefers fs over https
    const { selected } = negotiate([fsCandidate, httpsCandidate], client)
    assert.ok(selected)
    assert.equal(selected.protocol, 'fs')  // server's first choice
  })
})
