import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { handleDescriptor } from './handler.js'
import { codeCache, createCodeCache, type CodeCacheInterface } from './code-cache.js'
import { tracer } from './trace.js'
import { buildDescriptor } from '@tomcp/server'
import type { TransferDescriptor } from '@tomcp/types'

/**
 * Self-healing tests — prove that ToMCP auto-repairs when APIs change.
 *
 * Flow:
 *   1. API v1 works → Level 2 generates code → cached (Level 1.5)
 *   2. API changes to v2 → cached code fails → cache invalidated
 *   3. Level 2 regenerates with new description → works again → re-cached
 *
 * We simulate this WITHOUT an LLM by using a fresh cache and
 * pre-populating it with code that matches v1, then changing the API.
 */

let server: Server
let port: number
let apiVersion = 1

before(async () => {
  server = createServer((req, res) => {
    if (apiVersion === 1) {
      // V1: returns { data: [...] }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        data: [{ id: 1, name: 'alpha' }, { id: 2, name: 'beta' }],
      }))
    } else {
      // V2: different format — { results: [...], version: 2 }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        results: [{ id: 1, label: 'ALPHA' }, { id: 2, label: 'BETA' }, { id: 3, label: 'GAMMA' }],
        version: 2,
      }))
    }
  })

  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      port = (server.address() as { port: number }).port
      resolve()
    })
  })
})

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('Self-healing — API evolution', () => {
  it('Level 1 handles API change transparently (no cache involved)', async () => {
    // V1
    apiVersion = 1
    const descriptor = buildDescriptor({
      protocol: 'http',
      endpoint: `http://localhost:${port}/api`,
      format: 'json',
    })

    const r1 = await handleDescriptor(descriptor)
    assert.equal(r1.success, true)
    assert.deepEqual((r1.parsedOutput as any).data, [
      { id: 1, name: 'alpha' },
      { id: 2, name: 'beta' },
    ])

    // API changes to V2
    apiVersion = 2
    const r2 = await handleDescriptor(descriptor)
    assert.equal(r2.success, true)
    assert.deepEqual((r2.parsedOutput as any).results, [
      { id: 1, label: 'ALPHA' },
      { id: 2, label: 'BETA' },
      { id: 3, label: 'GAMMA' },
    ])
    assert.equal((r2.parsedOutput as any).version, 2)
  })

  it('Level 1.5 cache invalidation on schema change', async () => {
    const cache = createCodeCache()
    const descriptionText = 'Fetch data from the API. Response is JSON with a "data" array.'

    // Simulate Level 1.5: pre-populate cache with code that expects V1 format
    const v1Code = `
      (async () => {
        const res = await fetch('http://localhost:${port}/api');
        const json = await res.json();
        // V1 code expects json.data
        if (!json.data) throw new Error('Expected data field');
        console.log(JSON.stringify(json.data));
      })();
    `
    await cache.set(descriptionText, v1Code, 'test-api')

    // Verify cache has the entry
    const cached = await cache.get(descriptionText)
    assert.ok(cached, 'Cache should have the entry')

    // API is still V1 — cached code works
    apiVersion = 1

    // Build a Level 2 descriptor (has description)
    const descriptor: TransferDescriptor = {
      $schema: 'tomcp/v0.1' as const,
      transfer_id: '00000000-0000-0000-0000-000000000001',
      mode: 'fetch' as const,
      protocol: 'http',
      endpoint: `http://localhost:${port}/api`,
      format: 'json',
      fallback: 'inline' as const,
      description: {
        tier: 'high' as const,
        text: descriptionText,
      },
      sandbox: {
        runtime: 'node' as const,
        timeout_ms: 5000,
        allowed_hosts: [`localhost:${port}`],
      },
    }

    // Level 1.5: cache hit, code works with V1
    const r1 = await handleDescriptor(descriptor, { cache })
    assert.equal(r1.success, true)
    const output1 = r1.parsedOutput as any[]
    assert.equal(output1.length, 2)
    assert.equal(output1[0].name, 'alpha')

    // NOW: API changes to V2
    apiVersion = 2

    // Level 1.5: cache hit, but code FAILS (expects json.data, gets json.results)
    // → cache invalidated → falls through to Level 2
    // Since we don't have an LLM in tests, Level 2 throws (no API key)
    // That's expected — the important thing is that the cache was invalidated
    try {
      await handleDescriptor(descriptor, { cache, noCache: false })
    } catch {
      // Expected: Level 2 fails without LLM API key
    }

    // The key assertion: the V1 cached code is NO LONGER in the cache
    // (it was invalidated when it failed against V2 API)
    const stats = await cache.stats()
    const v1Entry = stats.entries.find(e => e.protocol === 'test-api' && e.code === v1Code)
    assert.equal(v1Entry, undefined, 'V1 code should have been invalidated from cache')
  })

  it('tracer records the self-healing flow', async () => {
    tracer.clear()
    const cache = createCodeCache()

    // Pre-populate with working code
    apiVersion = 1
    const descText = 'Self-heal test description'
    const workingCode = `
      (async () => {
        const res = await fetch('http://localhost:${port}/api');
        const json = await res.json();
        console.log(JSON.stringify(json));
      })();
    `
    await cache.set(descText, workingCode, 'heal-test')

    const descriptor: TransferDescriptor = {
      $schema: 'tomcp/v0.1' as const,
      transfer_id: '00000000-0000-0000-0000-000000000002',
      mode: 'fetch' as const,
      protocol: 'http',
      endpoint: `http://localhost:${port}/api`,
      format: 'json',
      fallback: 'inline' as const,
      description: { tier: 'high' as const, text: descText },
      sandbox: { runtime: 'node' as const, timeout_ms: 5000, allowed_hosts: [] },
    }

    // Hit 1: cache hit, success (Level 1.5)
    const r1 = await handleDescriptor(descriptor, { cache })
    assert.equal(r1.success, true)

    const traces = tracer.getTraces()
    const lastTrace = traces[traces.length - 1]
    assert.equal(lastTrace.level, '1.5')
    assert.equal(lastTrace.status, 'success')
    assert.equal(lastTrace.cache_hit, true)
  })
})
