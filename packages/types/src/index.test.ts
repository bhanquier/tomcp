import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  TransferDescriptorSchema,
  DescriptionTierSchema,
  SandboxConfigSchema,
  StreamConfigSchema,
  AuthSchema,
  NegotiateInputSchema,
  ConfirmReceiptInputSchema,
} from './index.js'

describe('TransferDescriptorSchema', () => {
  const validDescriptor = {
    $schema: 'tomcp/v0.1' as const,
    transfer_id: '550e8400-e29b-41d4-a716-446655440000',
    mode: 'fetch' as const,
    protocol: 'https',
    endpoint: 'https://api.example.com/data',
    format: 'json',
    fallback: 'inline' as const,
  }

  it('should parse a valid descriptor', () => {
    const result = TransferDescriptorSchema.parse(validDescriptor)
    assert.equal(result.$schema, 'tomcp/v0.1')
    assert.equal(result.mode, 'fetch')
    assert.equal(result.protocol, 'https')
    assert.equal(result.endpoint, 'https://api.example.com/data')
  })

  it('should reject missing required fields', () => {
    assert.throws(() => {
      TransferDescriptorSchema.parse({
        $schema: 'tomcp/v0.1',
        // missing transfer_id, mode, protocol, endpoint, format
      })
    })
  })

  it('should reject invalid mode', () => {
    assert.throws(() => {
      TransferDescriptorSchema.parse({
        ...validDescriptor,
        mode: 'invalid',
      })
    })
  })

  it('should reject invalid $schema', () => {
    assert.throws(() => {
      TransferDescriptorSchema.parse({
        ...validDescriptor,
        $schema: 'wrong/v1',
      })
    })
  })

  it('should reject invalid transfer_id (not a UUID)', () => {
    assert.throws(() => {
      TransferDescriptorSchema.parse({
        ...validDescriptor,
        transfer_id: 'not-a-uuid',
      })
    })
  })

  it('should accept optional fields', () => {
    const result = TransferDescriptorSchema.parse({
      ...validDescriptor,
      method: 'GET',
      compression: 'gzip',
      size_hint: 1024,
      expires: '2026-12-31T23:59:59Z',
      checksum: 'abc123',
    })
    assert.equal(result.method, 'GET')
    assert.equal(result.compression, 'gzip')
    assert.equal(result.size_hint, 1024)
  })

  it('should default fallback to inline', () => {
    const { fallback, ...withoutFallback } = validDescriptor
    const result = TransferDescriptorSchema.parse(withoutFallback)
    assert.equal(result.fallback, 'inline')
  })
})

describe('DescriptionTierSchema', () => {
  it('should accept valid tiers', () => {
    assert.equal(DescriptionTierSchema.parse('high'), 'high')
    assert.equal(DescriptionTierSchema.parse('mid'), 'mid')
    assert.equal(DescriptionTierSchema.parse('full'), 'full')
  })

  it('should reject invalid tier', () => {
    assert.throws(() => DescriptionTierSchema.parse('low'))
  })
})

describe('SandboxConfigSchema', () => {
  it('should parse valid config', () => {
    const result = SandboxConfigSchema.parse({
      runtime: 'node',
      allowed_hosts: ['api.example.com'],
    })
    assert.equal(result.runtime, 'node')
    assert.equal(result.timeout_ms, 30_000) // default
    assert.deepEqual(result.allowed_hosts, ['api.example.com'])
  })

  it('should reject invalid runtime', () => {
    assert.throws(() =>
      SandboxConfigSchema.parse({
        runtime: 'ruby',
        allowed_hosts: [],
      })
    )
  })
})

describe('AuthSchema', () => {
  it('should parse bearer auth', () => {
    const result = AuthSchema.parse({ type: 'bearer', value: 'tok_123' })
    assert.equal(result.type, 'bearer')
    assert.equal(result.value, 'tok_123')
  })

  it('should parse header auth with custom header name', () => {
    const result = AuthSchema.parse({
      type: 'header',
      value: 'secret',
      header_name: 'X-API-Key',
    })
    assert.equal(result.header_name, 'X-API-Key')
  })
})

describe('NegotiateInputSchema', () => {
  it('should parse valid input', () => {
    const result = NegotiateInputSchema.parse({
      scenario: 'export-data',
      client_capabilities: { runtimes: ['node'] },
    })
    assert.equal(result.scenario, 'export-data')
    assert.equal(result.tier, 'high') // default
  })
})

describe('ConfirmReceiptInputSchema', () => {
  it('should parse valid confirmation', () => {
    const result = ConfirmReceiptInputSchema.parse({
      transfer_id: '550e8400-e29b-41d4-a716-446655440000',
      status: 'success',
      records_received: 42,
    })
    assert.equal(result.status, 'success')
    assert.equal(result.records_received, 42)
  })
})
