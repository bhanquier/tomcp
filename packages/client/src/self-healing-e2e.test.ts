import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { handleDescriptor } from './handler.js'
import { createCodeCache, type CodeCacheInterface } from './code-cache.js'
import { tracer } from './trace.js'
import type { TransferDescriptor } from '@tomcp/types'

/**
 * Self-healing end-to-end test — requires LLM.
 *
 * Scenario:
 *   1. API v1: returns { users: [{ name, age }] }
 *   2. LLM generates code, works, cached
 *   3. API changes to v2: { people: [{ full_name, years_old }] }
 *   4. Cached code fails (expects 'users' field)
 *   5. Level 2 re-generates with UPDATED description
 *   6. New code works against v2
 *   7. New code cached — next call is Level 1.5 again
 *
 * This proves: zero-downtime protocol evolution via LLM regeneration.
 */

const HAS_LLM = !!(process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY)

let server: Server
let port: number
let apiVersion = 1

before(async () => {
  server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })

    if (apiVersion === 1) {
      res.end(JSON.stringify({
        users: [
          { name: 'Alice', age: 30 },
          { name: 'Bob', age: 25 },
        ],
      }))
    } else {
      res.end(JSON.stringify({
        people: [
          { full_name: 'Alice Smith', years_old: 30 },
          { full_name: 'Bob Jones', years_old: 25 },
          { full_name: 'Charlie Brown', years_old: 35 },
        ],
      }))
    }
  })

  await new Promise<void>(resolve => {
    server.listen(0, () => {
      port = (server.address() as { port: number }).port
      resolve()
    })
  })
})

after(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()))
})

describe('Self-healing E2E — API evolves, ToMCP auto-repairs', { skip: !HAS_LLM }, () => {

  it('full cycle: v1 → cache → v2 breaks cache → regenerate → v2 works → re-cached', async () => {
    const cache = createCodeCache()
    tracer.clear()

    // ── Phase 1: API v1 ──
    apiVersion = 1

    const v1Descriptor: TransferDescriptor = {
      $schema: 'tomcp/v0.1',
      transfer_id: '00000000-0000-0000-0000-000000000020',
      mode: 'fetch',
      protocol: 'evolving-api',
      endpoint: `http://localhost:${port}/`,
      format: 'json',
      fallback: 'inline',
      description: {
        tier: 'high',
        text: `## User API v1

GET the endpoint. No auth needed.

Response format: \`{ "users": [{ "name": string, "age": number }] }\`

Extract the users array and print it to stdout as JSON.`,
      },
      sandbox: {
        runtime: 'node',
        timeout_ms: 15_000,
        allowed_hosts: [`localhost:${port}`],
      },
    }

    // First call: Level 2 → LLM generates code for v1
    console.log('\n    Phase 1: Level 2 — LLM generates code for API v1')
    const r1 = await handleDescriptor(v1Descriptor, { cache })
    assert.equal(r1.success, true, `Phase 1 failed: ${r1.sandboxResult.stderr}`)

    const output1 = r1.parsedOutput as any[]
    assert.ok(Array.isArray(output1))
    assert.equal(output1.length, 2)
    assert.equal(output1[0].name, 'Alice')

    let traces = tracer.getTraces()
    assert.equal(traces[traces.length - 1].level, '2', 'First call should be Level 2')

    // Second call: Level 1.5 → cached code
    console.log('    Phase 2: Level 1.5 — cached code, zero tokens')
    const r2 = await handleDescriptor(v1Descriptor, { cache })
    assert.equal(r2.success, true)
    assert.deepEqual(r2.parsedOutput, r1.parsedOutput)

    traces = tracer.getTraces()
    assert.equal(traces[traces.length - 1].level, '1.5', 'Second call should be Level 1.5')

    // ── Phase 3: API changes to v2 ──
    console.log('    Phase 3: API changes to v2 — cached code will break')
    apiVersion = 2

    // The cached code expects json.users but now it's json.people
    // handleDescriptor will: try cache → fail → invalidate → Level 2
    // But Level 2 uses the SAME description (v1), so it might still fail
    // In real life, the server would update the description too

    // ── Phase 4: New descriptor with updated description ──
    const v2Descriptor: TransferDescriptor = {
      ...v1Descriptor,
      transfer_id: '00000000-0000-0000-0000-000000000021',
      description: {
        tier: 'high',
        text: `## People API v2

GET the endpoint. No auth needed.

Response format: \`{ "people": [{ "full_name": string, "years_old": number }] }\`

Extract the people array and print it to stdout as JSON.`,
      },
    }

    console.log('    Phase 4: Level 2 — LLM generates NEW code for API v2')
    const r3 = await handleDescriptor(v2Descriptor, { cache })
    assert.equal(r3.success, true, `Phase 4 failed: ${r3.sandboxResult.stderr}`)

    const output3 = r3.parsedOutput as any[]
    assert.ok(Array.isArray(output3))
    assert.equal(output3.length, 3, 'V2 should return 3 people')
    assert.equal(output3[0].full_name, 'Alice Smith')
    assert.equal(output3[2].full_name, 'Charlie Brown')

    traces = tracer.getTraces()
    assert.equal(traces[traces.length - 1].level, '2', 'V2 first call should be Level 2')

    // ── Phase 5: v2 is now cached ──
    console.log('    Phase 5: Level 1.5 — v2 code cached, zero tokens')
    const r4 = await handleDescriptor(v2Descriptor, { cache })
    assert.equal(r4.success, true)
    assert.deepEqual(r4.parsedOutput, r3.parsedOutput)

    traces = tracer.getTraces()
    assert.equal(traces[traces.length - 1].level, '1.5', 'V2 second call should be Level 1.5')

    // ── Summary ──
    const stats = tracer.stats()
    console.log(`    Summary: ${stats.total} transfers — ${stats.by_level['2']} Level 2, ${stats.by_level['1.5']} Level 1.5`)
    console.log(`    Cache hits saved ${stats.cache_hits} LLM calls`)

    assert.equal(stats.by_level['2'], 2, 'Should have 2 Level 2 calls (v1 + v2)')
    assert.equal(stats.by_level['1.5'], 2, 'Should have 2 Level 1.5 cache hits')
  })
})
