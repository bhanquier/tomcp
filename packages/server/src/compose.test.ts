import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { compose } from './compose.js'
import { registerBuiltins } from './marketplace.js'

describe('Protocol Composition', () => {
  it('should compose two marketplace protocols', () => {
    registerBuiltins()

    const descriptor = compose({
      steps: [
        { protocol_id: 'oauth2-bearer', label: 'Authenticate' },
        { protocol_id: 'http-paginated', label: 'Fetch paginated data' },
      ],
      endpoint: 'https://api.example.com/data',
    })

    assert.equal(descriptor.protocol, 'composed-2-steps')
    assert.ok(descriptor.description)
    assert.ok(descriptor.description.text.includes('Step 1: Authenticate'))
    assert.ok(descriptor.description.text.includes('Step 2: Fetch paginated data'))
    assert.ok(descriptor.description.text.includes('Bearer'))
    assert.ok(descriptor.description.text.includes('cursor'))
  })

  it('should compose with inline descriptions', () => {
    const descriptor = compose({
      steps: [
        {
          label: 'Get HMAC token',
          description: 'POST to {AUTH_URL} with API key to get a short-lived HMAC token.',
          variables: { AUTH_URL: 'https://auth.acme.com/token' },
        },
        {
          label: 'Fetch data',
          description: 'GET {DATA_URL} with X-HMAC-Token header.',
          variables: { DATA_URL: 'https://api.acme.com/export' },
        },
      ],
      endpoint: 'https://api.acme.com/export',
    })

    assert.ok(descriptor.description)
    // Variables should be injected
    assert.ok(descriptor.description.text.includes('https://auth.acme.com/token'))
    assert.ok(descriptor.description.text.includes('https://api.acme.com/export'))
    // Should NOT contain the placeholder
    assert.ok(!descriptor.description.text.includes('{AUTH_URL}'))
  })

  it('should collect allowed hosts from all steps', () => {
    const descriptor = compose({
      steps: [
        {
          label: 'Auth',
          description: 'Call auth service',
          variables: { URL: 'https://auth.example.com/token' },
        },
        {
          label: 'Fetch',
          description: 'Call data service',
          variables: { URL: 'https://data.example.com/api' },
        },
      ],
      endpoint: 'https://api.example.com/main',
    })

    assert.ok(descriptor.sandbox)
    const hosts = descriptor.sandbox.allowed_hosts
    assert.ok(hosts.includes('api.example.com'))
    assert.ok(hosts.includes('auth.example.com'))
    assert.ok(hosts.includes('data.example.com'))
  })

  it('should mix marketplace and inline steps', () => {
    registerBuiltins()

    const descriptor = compose({
      steps: [
        { protocol_id: 'oauth2-bearer', label: 'Standard OAuth2' },
        {
          label: 'Custom proprietary fetch',
          description: 'Use X-Acme-Secret header with HMAC signing to fetch /v2/export',
        },
        { protocol_id: 'csv-download', label: 'Parse CSV response' },
      ],
      endpoint: 'https://api.acme.com/v2/export',
    })

    assert.equal(descriptor.protocol, 'composed-3-steps')
    assert.ok(descriptor.description)
    assert.ok(descriptor.description.text.includes('Step 1: Standard OAuth2'))
    assert.ok(descriptor.description.text.includes('Step 2: Custom proprietary fetch'))
    assert.ok(descriptor.description.text.includes('Step 3: Parse CSV response'))
  })
})
