import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// We cannot easily reset the singleton, so we import the class via a fresh module approach.
// Instead, we test against the exported singleton and call unpublish to clean up.
import { marketplace } from './marketplace.js'

function makeEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'test-proto',
    name: 'Test Protocol',
    publisher: 'tester',
    version: '1.0.0',
    tags: ['test', 'json'],
    tiers: { high: 'Test description for high tier' },
    defaults: {
      protocol: 'https',
      format: 'json',
      mode: 'fetch' as const,
    },
    ...overrides,
  }
}

describe('ProtocolMarketplace', () => {
  // Clean up test entries before each test
  beforeEach(() => {
    marketplace.unpublish('test-proto')
    marketplace.unpublish('test-proto-2')
    marketplace.unpublish('other-proto')
  })

  it('should publish and get a protocol entry', () => {
    const entry = marketplace.publish(makeEntry())
    assert.equal(entry.id, 'test-proto')
    assert.equal(entry.name, 'Test Protocol')
    assert.ok(entry.published_at)
    assert.ok(entry.description_hash)

    const fetched = marketplace.get('test-proto')
    assert.ok(fetched)
    assert.equal(fetched.id, 'test-proto')
  })

  it('should return undefined for unknown id', () => {
    const result = marketplace.get('nonexistent')
    assert.equal(result, undefined)
  })

  it('should search by tag', () => {
    marketplace.publish(makeEntry())
    marketplace.publish(makeEntry({ id: 'other-proto', tags: ['other'] }))

    const results = marketplace.search({ tag: 'test' })
    assert.equal(results.length, 1)
    assert.equal(results[0].id, 'test-proto')
  })

  it('should search by query (matches id and name)', () => {
    marketplace.publish(makeEntry())

    const byId = marketplace.search({ query: 'test-proto' })
    assert.ok(byId.length >= 1)

    const byName = marketplace.search({ query: 'Test Protocol' })
    assert.ok(byName.length >= 1)
  })

  it('should search by publisher', () => {
    marketplace.publish(makeEntry())
    marketplace.publish(makeEntry({ id: 'other-proto', publisher: 'other-pub' }))

    const results = marketplace.search({ publisher: 'tester' })
    assert.equal(results.length, 1)
    assert.equal(results[0].publisher, 'tester')
  })

  it('should replace entry when newer version is published', () => {
    marketplace.publish(makeEntry({ version: '1.0.0' }))
    const updated = marketplace.publish(makeEntry({ version: '2.0.0', name: 'Updated Protocol' }))
    assert.equal(updated.name, 'Updated Protocol')
    assert.equal(updated.version, '2.0.0')

    const fetched = marketplace.get('test-proto')
    assert.equal(fetched?.version, '2.0.0')
  })

  it('should NOT replace entry when older or same version is published', () => {
    marketplace.publish(makeEntry({ version: '2.0.0', name: 'Newer' }))
    const result = marketplace.publish(makeEntry({ version: '1.0.0', name: 'Older' }))
    // Should return existing entry (the newer one)
    assert.equal(result.name, 'Newer')
    assert.equal(result.version, '2.0.0')
  })

  it('should unpublish a protocol', () => {
    marketplace.publish(makeEntry())
    assert.ok(marketplace.get('test-proto'))

    const deleted = marketplace.unpublish('test-proto')
    assert.equal(deleted, true)
    assert.equal(marketplace.get('test-proto'), undefined)
  })

  it('should return false when unpublishing nonexistent entry', () => {
    const deleted = marketplace.unpublish('nonexistent')
    assert.equal(deleted, false)
  })

  it('should return correct stats', () => {
    marketplace.publish(makeEntry())
    marketplace.publish(makeEntry({ id: 'test-proto-2', publisher: 'tester', tags: ['test', 'api'] }))

    const stats = marketplace.stats()
    assert.ok(stats.total >= 2)
    assert.ok(stats.by_publisher['tester'] >= 2)
    assert.ok(stats.by_tag['test'] >= 2)
  })
})
