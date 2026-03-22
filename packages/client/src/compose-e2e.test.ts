import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { handleDescriptor } from './handler.js'
import { compose, registerBuiltins } from '@tomcp/server'

/**
 * Composition E2E test — requires LLM.
 *
 * A mock service with:
 *   1. /auth → returns a token
 *   2. /data?token=X&page=N → paginated data (requires token from step 1)
 *
 * The LLM must generate ONE script that does both steps.
 */

const HAS_LLM = !!(process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY)

let server: Server
let port: number
const VALID_TOKEN = 'tok_abc123'

before(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url!, `http://localhost`)

    // Step 1: Auth endpoint — returns a token
    if (url.pathname === '/auth') {
      const apiKey = req.headers['x-api-key']
      if (apiKey !== 'my-secret-key') {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'invalid api key' }))
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ token: VALID_TOKEN, expires_in: 3600 }))
      return
    }

    // Step 2: Data endpoint — requires token, paginated
    if (url.pathname === '/data') {
      const token = url.searchParams.get('token')
      if (token !== VALID_TOKEN) {
        res.writeHead(403, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'invalid token' }))
        return
      }

      const page = parseInt(url.searchParams.get('page') || '1', 10)
      const items = page === 1
        ? [{ id: 1, product: 'Widget A', price: 9.99 }, { id: 2, product: 'Widget B', price: 19.99 }]
        : [{ id: 3, product: 'Widget C', price: 29.99 }]

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        items,
        page,
        next_page: page === 1 ? 2 : null,
        total: 3,
      }))
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

  registerBuiltins()
})

after(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()))
})

describe('Protocol Composition E2E — LLM combines auth + pagination', { skip: !HAS_LLM }, () => {

  it('should authenticate then paginate in a single generated script', async () => {
    const descriptor = compose({
      steps: [
        {
          label: 'Authenticate with API key',
          description: `POST to http://localhost:${port}/auth with header X-Api-Key: my-secret-key

Response: { "token": "...", "expires_in": 3600 }

Save the token for the next step.`,
        },
        {
          label: 'Fetch paginated product data',
          description: `GET http://localhost:${port}/data?token={TOKEN}&page={N}

Where {TOKEN} is the token from step 1.
Start with page=1.
Response: { "items": [...], "page": N, "next_page": N+1 | null }
Keep fetching while next_page is not null.
Concatenate all items arrays.`,
        },
      ],
      endpoint: `http://localhost:${port}`,
      sandbox: {
        runtime: 'node',
        timeout_ms: 20_000,
        allowed_hosts: [`localhost:${port}`],
      },
    })

    console.log('\n    Composed description:')
    console.log(`    ${descriptor.description!.text.split('\n').length} lines, ${descriptor.protocol}`)

    const result = await handleDescriptor(descriptor)
    assert.equal(result.success, true, `Failed: ${result.sandboxResult.stderr}`)

    const output = result.parsedOutput as any[]
    assert.ok(Array.isArray(output), `Expected array, got: ${typeof result.parsedOutput}`)
    assert.equal(output.length, 3, `Expected 3 products, got ${output.length}`)
    assert.equal(output[0].product, 'Widget A')
    assert.equal(output[2].product, 'Widget C')
    assert.equal(output[1].price, 19.99)

    console.log('    Result: 3 products fetched via auth + 2-page pagination')
    console.log(`    Generated: ${result.generatedCode.split('\n').length} lines of code`)
  })
})
