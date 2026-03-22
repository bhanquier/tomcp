import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createCodeCache, type CodeCacheInterface } from './code-cache.js'

describe('CodeCache', () => {
  let cache: CodeCacheInterface

  beforeEach(() => {
    cache = createCodeCache()
  })

  it('should set and get a cache entry (cache hit)', async () => {
    const desc = 'Fetch JSON from REST API'
    const code = 'console.log("hello")'
    await cache.set(desc, code, 'https')

    const entry = await cache.get(desc)
    assert.ok(entry)
    assert.equal(entry.code, code)
    assert.equal(entry.protocol, 'https')
  })

  it('should return undefined on cache miss', async () => {
    const result = await cache.get('nonexistent description')
    assert.equal(result, undefined)
  })

  it('should invalidate a cache entry', async () => {
    const desc = 'Some protocol description'
    await cache.set(desc, 'code', 'https')
    assert.ok(await cache.get(desc))

    const deleted = await cache.invalidate(desc)
    assert.equal(deleted, true)
    assert.equal(await cache.get(desc), undefined)
  })

  it('should return false when invalidating nonexistent entry', async () => {
    const deleted = await cache.invalidate('nonexistent')
    assert.equal(deleted, false)
  })

  it('should increment hits counter on get', async () => {
    const desc = 'Counting hits'
    await cache.set(desc, 'code', 'https')

    await cache.get(desc)
    await cache.get(desc)
    const entry = await cache.get(desc)

    assert.ok(entry)
    assert.equal(entry.hits, 3)
  })

  it('should produce stable hashes for the same input', () => {
    const h1 = cache.hash('same input')
    const h2 = cache.hash('same input')
    assert.equal(h1, h2)
  })

  it('should produce different hashes for different inputs', () => {
    const h1 = cache.hash('input A')
    const h2 = cache.hash('input B')
    assert.notEqual(h1, h2)
  })

  it('should return correct stats', async () => {
    await cache.set('desc1', 'code1', 'https')
    await cache.set('desc2', 'code2', 'grpc')

    const s = await cache.stats()
    assert.equal(s.size, 2)
    assert.equal(s.entries.length, 2)
  })

  it('should clear all entries', async () => {
    await cache.set('desc1', 'code1', 'https')
    await cache.set('desc2', 'code2', 'grpc')
    await cache.clear()

    const s = await cache.stats()
    assert.equal(s.size, 0)
  })
})
