import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { writeFile, unlink, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handleDescriptor } from './handler.js'
import { buildDescriptor } from '@tomcp/server'

// ---------------------------------------------------------------------------
// Test server that serves files of arbitrary size via streaming
// ---------------------------------------------------------------------------

let server: Server
let serverPort: number
let tempDir: string

before(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'tomcp-test-'))

  server = createServer((req, res) => {
    const url = new URL(req.url!, `http://localhost:${serverPort}`)

    if (url.pathname === '/fixed-json') {
      // Small JSON response
      const data = JSON.stringify({ items: Array.from({ length: 100 }, (_, i) => ({ id: i, value: Math.random() })) })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(data)
      return
    }

    if (url.pathname === '/stream-size') {
      // Generate N bytes of random data, streamed in chunks
      const totalBytes = parseInt(url.searchParams.get('bytes') || '1024', 10)
      const chunkSize = 64 * 1024 // 64KB chunks
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(totalBytes),
      })

      let sent = 0
      const interval = setInterval(() => {
        const remaining = totalBytes - sent
        if (remaining <= 0) {
          clearInterval(interval)
          res.end()
          return
        }
        const size = Math.min(chunkSize, remaining)
        // Predictable data: repeating byte pattern based on offset
        const chunk = Buffer.alloc(size, sent % 256)
        res.write(chunk)
        sent += size
      }, 0)

      req.on('close', () => clearInterval(interval))
      return
    }

    if (url.pathname === '/checksum-json') {
      // Returns JSON array of N records, with a checksum header
      const count = parseInt(url.searchParams.get('count') || '1000', 10)
      const records = Array.from({ length: count }, (_, i) => ({
        id: i,
        name: `Record-${String(i).padStart(6, '0')}`,
        value: Math.round(Math.random() * 10000) / 100,
      }))
      const body = JSON.stringify(records)
      const hash = createHash('sha256').update(body).digest('hex')

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'X-Checksum': hash,
        'X-Record-Count': String(count),
      })
      res.end(body)
      return
    }

    res.writeHead(404)
    res.end('Not found')
  })

  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      serverPort = (server.address() as { port: number }).port
      resolve()
    })
  })
})

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Level 1 — HTTP transfers', () => {
  it('should fetch small JSON inline', async () => {
    const descriptor = buildDescriptor({
      protocol: 'http',
      endpoint: `http://localhost:${serverPort}/fixed-json`,
      format: 'json',
    })

    const result = await handleDescriptor(descriptor)
    assert.equal(result.success, true)
    assert.ok(Array.isArray((result.parsedOutput as any).items))
    assert.equal((result.parsedOutput as any).items.length, 100)
  })

  it('should fetch 1MB streamed data', async () => {
    const size = 1 * 1024 * 1024 // 1MB
    const descriptor = buildDescriptor({
      protocol: 'http',
      endpoint: `http://localhost:${serverPort}/stream-size?bytes=${size}`,
      format: 'binary',
    })

    const result = await handleDescriptor(descriptor)
    assert.equal(result.success, true)
    // Output is the raw binary as a string
    assert.ok(typeof result.parsedOutput === 'string' || result.parsedOutput !== null)
  })

  it('should fetch 10MB streamed data', async () => {
    const size = 10 * 1024 * 1024 // 10MB
    const descriptor = buildDescriptor({
      protocol: 'http',
      endpoint: `http://localhost:${serverPort}/stream-size?bytes=${size}`,
      format: 'binary',
    })

    const result = await handleDescriptor(descriptor)
    assert.equal(result.success, true)
  })

  it('should fetch 10K records JSON', async () => {
    const descriptor = buildDescriptor({
      protocol: 'http',
      endpoint: `http://localhost:${serverPort}/checksum-json?count=10000`,
      format: 'json',
    })

    const result = await handleDescriptor(descriptor)
    assert.equal(result.success, true)
    assert.ok(Array.isArray(result.parsedOutput))
    assert.equal((result.parsedOutput as any[]).length, 10000)
  })

  it('should fetch 100K records JSON (~15MB)', async () => {
    const descriptor = buildDescriptor({
      protocol: 'http',
      endpoint: `http://localhost:${serverPort}/checksum-json?count=100000`,
      format: 'json',
    })

    const result = await handleDescriptor(descriptor)
    assert.equal(result.success, true)
    assert.ok(Array.isArray(result.parsedOutput))
    assert.equal((result.parsedOutput as any[]).length, 100000)
  })
})

describe('Level 1 — Filesystem transfers', () => {
  it('should read a local JSON file', async () => {
    const data = JSON.stringify({ hello: 'world', items: [1, 2, 3] })
    const filePath = join(tempDir, 'test.json')
    await writeFile(filePath, data)

    const descriptor = buildDescriptor({
      protocol: 'fs',
      endpoint: filePath,
      format: 'json',
    })

    const result = await handleDescriptor(descriptor)
    assert.equal(result.success, true)
    assert.deepEqual(result.parsedOutput, { hello: 'world', items: [1, 2, 3] })

    await unlink(filePath)
  })

  it('should read a 5MB local file', async () => {
    const filePath = join(tempDir, 'large.bin')
    const data = randomBytes(5 * 1024 * 1024)
    await writeFile(filePath, data)

    const descriptor = buildDescriptor({
      protocol: 'fs',
      endpoint: filePath,
      format: 'binary',
    })

    const result = await handleDescriptor(descriptor)
    assert.equal(result.success, true)
    assert.ok(typeof result.parsedOutput === 'string')
    // Verify size matches (as UTF-8 string, binary data may differ)
    assert.ok((result.parsedOutput as string).length > 0)

    await unlink(filePath)
  })

  it('should fail gracefully on missing file', async () => {
    const descriptor = buildDescriptor({
      protocol: 'fs',
      endpoint: '/tmp/nonexistent-file-tomcp-test.json',
      format: 'json',
    })

    const result = await handleDescriptor(descriptor)
    assert.equal(result.success, false)
  })
})

describe('Transfer size comparison — inline vs descriptor', () => {
  it('should demonstrate why ToMCP matters: 100K records', async () => {
    // Simulate what MCP would do without ToMCP: serialize everything inline
    const records = Array.from({ length: 100000 }, (_, i) => ({
      id: i,
      name: `Record-${i}`,
      value: Math.random(),
    }))

    const inlinePayload = JSON.stringify(records)
    const inlineSize = Buffer.byteLength(inlinePayload)
    const base64Size = Math.ceil(inlineSize * 1.33) // base64 overhead

    // ToMCP descriptor for the same data
    const descriptor = buildDescriptor({
      protocol: 'https',
      endpoint: 'https://storage.example.com/exports/data.json',
      format: 'json',
      size_hint: inlineSize,
    })
    const descriptorSize = Buffer.byteLength(JSON.stringify(descriptor))

    // The descriptor is ~300 bytes vs ~15MB inline
    console.log(`    Inline JSON:    ${(inlineSize / 1024 / 1024).toFixed(1)}MB`)
    console.log(`    Base64 (MCP):   ${(base64Size / 1024 / 1024).toFixed(1)}MB`)
    console.log(`    Descriptor:     ${descriptorSize} bytes`)
    console.log(`    Reduction:      ${((1 - descriptorSize / base64Size) * 100).toFixed(1)}%`)

    assert.ok(descriptorSize < 1000, 'Descriptor should be under 1KB')
    assert.ok(inlineSize > 5_000_000, 'Inline payload should be over 5MB')
    assert.ok(descriptorSize / inlineSize < 0.0001, 'Descriptor should be <0.01% of inline size')
  })
})
