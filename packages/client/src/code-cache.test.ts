import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createCodeCache, type CodeCacheInterface } from './code-cache.js'

describe('CodeCache', () => {
  let cache: CodeCacheInterface

  beforeEach(() => {
    cache = createCodeCache()
  })

  it('should set and get a cache entry (cache hit)', () => {
    const desc = 'Fetch JSON from REST API'
    const code = 'console.log("hello")'
    cache.set(desc, code, 'https')

    const entry = cache.get(desc)
    assert.ok(entry)
    assert.equal(entry.code, code)
    assert.equal(entry.protocol, 'https')
  })

  it('should return undefined on cache miss', () => {
    const result = cache.get('nonexistent description')
    assert.equal(result, undefined)
  })

  it('should invalidate a cache entry', () => {
    const desc = 'Some protocol description'
    cache.set(desc, 'code', 'https')
    assert.ok(cache.get(desc))

    const deleted = cache.invalidate(desc)
    assert.equal(deleted, true)
    assert.equal(cache.get(desc), undefined)
  })

  it('should return false when invalidating nonexistent entry', () => {
    const deleted = cache.invalidate('nonexistent')
    assert.equal(deleted, false)
  })

  it('should increment hits counter on get', () => {
    const desc = 'Counting hits'
    cache.set(desc, 'code', 'https')

    cache.get(desc)
    cache.get(desc)
    const entry = cache.get(desc)

    assert.ok(entry)
    assert.equal(entry.hits, 3) // 3 gets = 3 hits
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

  it('should return correct stats', () => {
    cache.set('desc1', 'code1', 'https')
    cache.set('desc2', 'code2', 'grpc')

    const s = cache.stats() as { size: number; entries: unknown[] }
    assert.equal(s.size, 2)
    assert.equal(s.entries.length, 2)
  })

  it('should clear all entries', () => {
    cache.set('desc1', 'code1', 'https')
    cache.set('desc2', 'code2', 'grpc')
    cache.clear()

    const s = cache.stats() as { size: number; entries: unknown[] }
    assert.equal(s.size, 0)
  })
})
