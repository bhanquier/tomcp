import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildDescriptor } from './descriptor.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

describe('buildDescriptor', () => {
  const minimalOpts = {
    protocol: 'https',
    endpoint: 'https://api.example.com/data',
    description: {
      tier: 'high' as const,
      text: 'Fetch JSON data from the API',
    },
  }

  it('should build a descriptor with minimal options', () => {
    const d = buildDescriptor(minimalOpts)
    assert.equal(d.$schema, 'tomcp/v0.1')
    assert.equal(d.protocol, 'https')
    assert.equal(d.endpoint, 'https://api.example.com/data')
  })

  it('should generate a valid UUID for transfer_id', () => {
    const d = buildDescriptor(minimalOpts)
    assert.match(d.transfer_id, UUID_RE)
  })

  it('should generate unique transfer_ids', () => {
    const d1 = buildDescriptor(minimalOpts)
    const d2 = buildDescriptor(minimalOpts)
    assert.notEqual(d1.transfer_id, d2.transfer_id)
  })

  it('should default mode to fetch', () => {
    const d = buildDescriptor(minimalOpts)
    assert.equal(d.mode, 'fetch')
  })

  it('should default format to json', () => {
    const d = buildDescriptor(minimalOpts)
    assert.equal(d.format, 'json')
  })

  it('should default fallback to inline', () => {
    const d = buildDescriptor(minimalOpts)
    assert.equal(d.fallback, 'inline')
  })

  it('should default sandbox runtime to node', () => {
    const d = buildDescriptor(minimalOpts)
    assert.equal(d.sandbox?.runtime, 'node')
    assert.equal(d.sandbox?.timeout_ms, 30_000)
    assert.deepEqual(d.sandbox?.allowed_hosts, [])
  })

  it('should build a descriptor with full options', () => {
    const d = buildDescriptor({
      mode: 'push',
      protocol: 'https',
      endpoint: 'https://api.example.com/upload',
      method: 'PUT',
      auth: { type: 'bearer', value: 'tok_123' },
      format: 'csv',
      compression: 'gzip',
      size_hint: 2048,
      expires: '2026-12-31T23:59:59Z',
      checksum: 'sha256:abc',
      fallback: 'error',
      description: {
        tier: 'full',
        text: 'Upload CSV data',
        examples: ['example1'],
        constraints: ['max 10MB'],
      },
      sandbox: {
        runtime: 'python',
        timeout_ms: 60_000,
        allowed_hosts: ['api.example.com'],
      },
      stream: {
        reconnect: true,
        buffer_size: 4096,
        end_signal: 'END',
      },
    })

    assert.equal(d.mode, 'push')
    assert.equal(d.method, 'PUT')
    assert.equal(d.auth?.type, 'bearer')
    assert.equal(d.format, 'csv')
    assert.equal(d.compression, 'gzip')
    assert.equal(d.size_hint, 2048)
    assert.equal(d.fallback, 'error')
    assert.equal(d.sandbox?.runtime, 'python')
    assert.equal(d.sandbox?.timeout_ms, 60_000)
    assert.deepEqual(d.sandbox?.allowed_hosts, ['api.example.com'])
    assert.equal(d.stream?.reconnect, true)
    assert.equal(d.stream?.end_signal, 'END')
  })
})
