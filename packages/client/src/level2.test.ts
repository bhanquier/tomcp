import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { createHmac } from 'node:crypto'
import { handleDescriptor } from './handler.js'
import { createCodeCache } from './code-cache.js'
import { tracer } from './trace.js'
import { buildDescriptor } from '@tomcp/server'
import type { TransferDescriptor } from '@tomcp/types'

/**
 * Level 2 integration tests — requires GEMINI_API_KEY or ANTHROPIC_API_KEY.
 * Skipped automatically if no LLM API key is available.
 */

const HAS_LLM = !!(process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY)

let server: Server
let port: number

before(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url!, `http://localhost`)

    // Simple JSON API (no auth)
    if (url.pathname === '/simple') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify([
        { id: 1, city: 'Paris', country: 'France' },
        { id: 2, city: 'London', country: 'UK' },
        { id: 3, city: 'Tokyo', country: 'Japan' },
      ]))
      return
    }

    // API with custom auth header
    if (url.pathname === '/authed') {
      const token = req.headers['x-custom-token']
      if (token !== 'secret-123') {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'unauthorized' }))
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'authenticated', data: [10, 20, 30] }))
      return
    }

    // Paginated API (2 pages)
    if (url.pathname === '/paged') {
      const page = parseInt(url.searchParams.get('page') || '1', 10)
      const items = page === 1
        ? [{ id: 1 }, { id: 2 }, { id: 3 }]
        : [{ id: 4 }, { id: 5 }]
      const hasNext = page === 1

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ items, page, next_page: hasNext ? 2 : null }))
      return
    }

    res.writeHead(404)
    res.end('not found')
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

describe('Level 2 — LLM code generation (requires API key)', { skip: !HAS_LLM }, () => {

  it('should fetch simple JSON API via LLM-generated code', async () => {
    const descriptor: TransferDescriptor = {
      $schema: 'tomcp/v0.1',
      transfer_id: '00000000-0000-0000-0000-000000000010',
      mode: 'fetch',
      protocol: 'custom-simple',
      endpoint: `http://localhost:${port}/simple`,
      format: 'json',
      fallback: 'inline',
      description: {
        tier: 'high',
        text: `## Simple JSON API

GET the endpoint. No authentication needed. Response is a JSON array of objects with id, city, country fields.

Print the JSON array to stdout.`,
      },
      sandbox: {
        runtime: 'node',
        timeout_ms: 15_000,
        allowed_hosts: [`localhost:${port}`],
      },
    }

    const result = await handleDescriptor(descriptor)
    assert.equal(result.success, true, `Expected success but got: ${result.sandboxResult.stderr}`)

    const output = result.parsedOutput as any[]
    assert.ok(Array.isArray(output), 'Output should be an array')
    assert.equal(output.length, 3)
    assert.equal(output[0].city, 'Paris')
  })

  it('should handle custom auth header via LLM-generated code', async () => {
    const descriptor: TransferDescriptor = {
      $schema: 'tomcp/v0.1',
      transfer_id: '00000000-0000-0000-0000-000000000011',
      mode: 'fetch',
      protocol: 'custom-authed',
      endpoint: `http://localhost:${port}/authed`,
      format: 'json',
      fallback: 'inline',
      description: {
        tier: 'high',
        text: `## Authenticated API

GET the endpoint with a custom header: \`X-Custom-Token: secret-123\`

The response is JSON: \`{ "status": "authenticated", "data": [10, 20, 30] }\`

Print the response JSON to stdout.`,
      },
      sandbox: {
        runtime: 'node',
        timeout_ms: 15_000,
        allowed_hosts: [`localhost:${port}`],
      },
    }

    const result = await handleDescriptor(descriptor)
    assert.equal(result.success, true, `Expected success but got: ${result.sandboxResult.stderr}`)

    const output = result.parsedOutput as any
    assert.equal(output.status, 'authenticated')
    assert.deepEqual(output.data, [10, 20, 30])
  })

  it('should paginate via LLM-generated code', async () => {
    const descriptor: TransferDescriptor = {
      $schema: 'tomcp/v0.1',
      transfer_id: '00000000-0000-0000-0000-000000000012',
      mode: 'fetch',
      protocol: 'custom-paged',
      endpoint: `http://localhost:${port}/paged`,
      format: 'json',
      fallback: 'inline',
      description: {
        tier: 'high',
        text: `## Paginated API

GET \`{endpoint}?page=N\` starting with page=1.

Response: \`{ "items": [...], "page": N, "next_page": N+1 | null }\`

Keep fetching while next_page is not null. Concatenate all items arrays.

Print the complete array of all items to stdout as JSON.`,
      },
      sandbox: {
        runtime: 'node',
        timeout_ms: 15_000,
        allowed_hosts: [`localhost:${port}`],
      },
    }

    const result = await handleDescriptor(descriptor)
    assert.equal(result.success, true, `Expected success but got: ${result.sandboxResult.stderr}`)

    const output = result.parsedOutput as any[]
    assert.ok(Array.isArray(output), 'Output should be an array')
    assert.equal(output.length, 5, 'Should have all 5 items from 2 pages')
  })

  it('Level 1.5: second call uses cache, zero LLM tokens', async () => {
    const cache = createCodeCache()
    tracer.clear()

    const descriptor: TransferDescriptor = {
      $schema: 'tomcp/v0.1',
      transfer_id: '00000000-0000-0000-0000-000000000013',
      mode: 'fetch',
      protocol: 'custom-cache-test',
      endpoint: `http://localhost:${port}/simple`,
      format: 'json',
      fallback: 'inline',
      description: {
        tier: 'high',
        text: `GET the endpoint. No auth. Response is JSON array. Print to stdout.`,
      },
      sandbox: {
        runtime: 'node',
        timeout_ms: 15_000,
        allowed_hosts: [`localhost:${port}`],
      },
    }

    // First call: Level 2 (LLM generates code)
    const r1 = await handleDescriptor(descriptor, { cache })
    assert.equal(r1.success, true)

    const traces1 = tracer.getTraces()
    const lastTrace1 = traces1[traces1.length - 1]
    assert.equal(lastTrace1.level, '2', 'First call should be Level 2')

    // Second call: Level 1.5 (cached code, zero LLM)
    const r2 = await handleDescriptor(descriptor, { cache })
    assert.equal(r2.success, true)

    const traces2 = tracer.getTraces()
    const lastTrace2 = traces2[traces2.length - 1]
    assert.equal(lastTrace2.level, '1.5', 'Second call should be Level 1.5 (cache hit)')
    assert.equal(lastTrace2.cache_hit, true)

    // Both should return the same data
    assert.deepEqual(r1.parsedOutput, r2.parsedOutput)
  })
})
