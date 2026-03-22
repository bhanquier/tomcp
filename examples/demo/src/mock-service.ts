#!/usr/bin/env node

/**
 * Mock target service — the "foreign API" that LLM-generated code talks to.
 *
 * Three endpoints:
 *   1. GET  /acme/export       — Paginated JSON API with HMAC auth
 *   2. GET  /binary/records    — Proprietary binary format
 *   3. GET  /stream/events     — SSE with custom framing
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createHmac } from 'node:crypto'

const PORT = parseInt(process.env.MOCK_PORT ?? '4444', 10)
const ACME_TOKEN = 'acme-secret-token-42'
const ACME_SECRET = 'hmac-shared-secret'

// ─── Sample Data ────────────────────────────────────────────

const RECORDS = Array.from({ length: 47 }, (_, i) => ({
  id: i + 1,
  name: `Record-${String(i + 1).padStart(3, '0')}`,
  value: Math.round(Math.random() * 10000) / 100,
  category: ['alpha', 'beta', 'gamma'][i % 3],
}))

// ─── Scenario 1: Paginated API with HMAC Auth ──────────────

function verifyHmac(req: IncomingMessage): boolean {
  const token = req.headers['x-acme-token'] as string | undefined
  const timestamp = req.headers['x-acme-timestamp'] as string | undefined
  const signature = req.headers['x-acme-signature'] as string | undefined

  if (!token || !timestamp || !signature) return false
  if (token !== ACME_TOKEN) return false

  // Verify timestamp is within 5 minutes
  const ts = parseInt(timestamp, 10)
  if (Math.abs(Date.now() - ts) > 5 * 60 * 1000) return false

  // Verify HMAC: HMAC-SHA256(secret, method + path + timestamp)
  const url = new URL(req.url!, `http://localhost:${PORT}`)
  const payload = `${req.method}${url.pathname}${timestamp}`
  const expected = createHmac('sha256', ACME_SECRET).update(payload).digest('hex')

  return signature === expected
}

function handlePaginatedApi(req: IncomingMessage, res: ServerResponse): void {
  if (!verifyHmac(req)) {
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Invalid authentication' }))
    return
  }

  const url = new URL(req.url!, `http://localhost:${PORT}`)
  const cursor = parseInt(url.searchParams.get('cursor') ?? '0', 10)
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '10', 10), 20)

  const page = RECORDS.slice(cursor, cursor + limit)
  const nextCursor = cursor + limit < RECORDS.length ? cursor + limit : null

  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({
    data: page,
    next_cursor: nextCursor,
    total: RECORDS.length,
  }))
}

// ─── Scenario 2: Proprietary Binary Format ──────────────────

/**
 * Binary format:
 *   Header:  4 bytes magic "TMCP"
 *            2 bytes (uint16 BE) record count
 *   Record:  1 byte  field_type (1=int32, 2=float64, 3=string)
 *            For int32:   4 bytes BE
 *            For float64: 8 bytes BE
 *            For string:  2 bytes (uint16 BE) length + N bytes UTF-8
 *
 *   Each record: [int32 id] [string name] [float64 value]
 *   Footer: 4 bytes "DONE"
 */

function handleBinaryRecords(_req: IncomingMessage, res: ServerResponse): void {
  const records = RECORDS.slice(0, 10) // First 10 for binary demo
  const buffers: Buffer[] = []

  // Header
  const header = Buffer.alloc(6)
  header.write('TMCP', 0, 4, 'ascii')
  header.writeUInt16BE(records.length, 4)
  buffers.push(header)

  // Records
  for (const rec of records) {
    // int32 id
    const idBuf = Buffer.alloc(5)
    idBuf.writeUInt8(1, 0) // type = int32
    idBuf.writeInt32BE(rec.id, 1)
    buffers.push(idBuf)

    // string name
    const nameBytes = Buffer.from(rec.name, 'utf-8')
    const nameBuf = Buffer.alloc(3 + nameBytes.length)
    nameBuf.writeUInt8(3, 0) // type = string
    nameBuf.writeUInt16BE(nameBytes.length, 1)
    nameBytes.copy(nameBuf, 3)
    buffers.push(nameBuf)

    // float64 value
    const valBuf = Buffer.alloc(9)
    valBuf.writeUInt8(2, 0) // type = float64
    valBuf.writeDoubleBE(rec.value, 1)
    buffers.push(valBuf)
  }

  // Footer
  buffers.push(Buffer.from('DONE', 'ascii'))

  const body = Buffer.concat(buffers)
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': body.length.toString(),
  })
  res.end(body)
}

// ─── Scenario 3: SSE Stream with Custom Framing ────────────

/**
 * Custom SSE framing:
 *   Each event line is: <TYPE>|<JSON_PAYLOAD>
 *   Types: DATA, HEARTBEAT, END
 *   DATA events contain records
 *   HEARTBEAT every 3 events
 *   END signals stream complete
 */

function handleStreamingEvents(req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  })

  let index = 0
  const batchSize = 5
  let eventCount = 0

  const interval = setInterval(() => {
    if (index >= RECORDS.length) {
      // Send END signal
      res.write(`data: END|{"total":${RECORDS.length}}\n\n`)
      clearInterval(interval)
      res.end()
      return
    }

    // Send batch
    const batch = RECORDS.slice(index, index + batchSize)
    res.write(`data: DATA|${JSON.stringify({ records: batch, offset: index })}\n\n`)
    index += batchSize
    eventCount++

    // Heartbeat every 3 data events
    if (eventCount % 3 === 0) {
      res.write(`data: HEARTBEAT|{"ts":${Date.now()}}\n\n`)
    }
  }, 200) // 200ms between events for demo speed

  req.on('close', () => clearInterval(interval))
}

// ─── Router ─────────────────────────────────────────────────

const server = createServer((req, res) => {
  const url = new URL(req.url!, `http://localhost:${PORT}`)
  const path = url.pathname

  console.error(`[mock] ${req.method} ${path}`)

  if (path === '/acme/export' && req.method === 'GET') {
    return handlePaginatedApi(req, res)
  }
  if (path === '/binary/records' && req.method === 'GET') {
    return handleBinaryRecords(req, res)
  }
  if (path === '/stream/events' && req.method === 'GET') {
    return handleStreamingEvents(req, res)
  }
  if (path === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok' }))
    return
  }

  res.writeHead(404)
  res.end('Not found')
})

server.listen(PORT, () => {
  console.error(`[mock] Target API running on http://localhost:${PORT}`)
  console.error(`[mock] Endpoints:`)
  console.error(`[mock]   GET /acme/export?cursor=0&limit=10  (paginated + HMAC)`)
  console.error(`[mock]   GET /binary/records                 (binary codec)`)
  console.error(`[mock]   GET /stream/events                  (SSE stream)`)
})
