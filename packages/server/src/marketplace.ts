/**
 * Protocol Marketplace — shared registry of protocol descriptions.
 *
 * Agents publish descriptions of their protocols. Other agents discover
 * and use them via Level 2 to communicate with services they've never
 * seen before. No SDKs, no wrappers, no pre-installed clients.
 *
 * Three layers:
 *   1. Local registry (in-memory, single process)
 *   2. Shared registry (Redis, cross-process)
 *   3. Remote registry (HTTP, cross-network — future)
 */

import { createHash } from 'node:crypto'

export interface ProtocolEntry {
  /** Unique protocol identifier (e.g., "stripe-charges-v1", "acme-export") */
  id: string
  /** Human-readable name */
  name: string
  /** Who published this entry */
  publisher: string
  /** Protocol description at each tier */
  tiers: {
    high: string
    mid?: string
    full?: string
  }
  /** Example Transfer Descriptor fields */
  defaults: {
    protocol: string
    format: string
    mode: 'fetch' | 'push' | 'stream'
    sandbox?: {
      runtime: 'node' | 'python'
      timeout_ms: number
    }
  }
  /** Tags for discovery */
  tags: string[]
  /** Version (semver) */
  version: string
  /** When this was published */
  published_at: string
  /** SHA-256 hash of the high-tier description (for Level 1.5 cache keying) */
  description_hash: string
}

export interface MarketplaceSearchOptions {
  /** Search by tag */
  tag?: string
  /** Search by protocol name or id */
  query?: string
  /** Filter by publisher */
  publisher?: string
}

class ProtocolMarketplace {
  private entries = new Map<string, ProtocolEntry>()

  /**
   * Publish a protocol description to the marketplace.
   */
  publish(entry: Omit<ProtocolEntry, 'published_at' | 'description_hash'>): ProtocolEntry {
    const full: ProtocolEntry = {
      ...entry,
      published_at: new Date().toISOString(),
      description_hash: createHash('sha256').update(entry.tiers.high).digest('hex').slice(0, 16),
    }

    // Version check — only update if newer
    const existing = this.entries.get(entry.id)
    if (existing && existing.version >= entry.version) {
      return existing // Already have this or newer version
    }

    this.entries.set(entry.id, full)
    return full
  }

  /**
   * Look up a protocol by ID.
   */
  get(id: string): ProtocolEntry | undefined {
    return this.entries.get(id)
  }

  /**
   * Search the marketplace.
   */
  search(opts?: MarketplaceSearchOptions): ProtocolEntry[] {
    let results = Array.from(this.entries.values())

    if (opts?.tag) {
      const tag = opts.tag.toLowerCase()
      results = results.filter(e => e.tags.some(t => t.toLowerCase() === tag))
    }

    if (opts?.query) {
      const q = opts.query.toLowerCase()
      results = results.filter(e =>
        e.id.toLowerCase().includes(q) ||
        e.name.toLowerCase().includes(q) ||
        e.tags.some(t => t.toLowerCase().includes(q))
      )
    }

    if (opts?.publisher) {
      results = results.filter(e => e.publisher === opts.publisher)
    }

    return results
  }

  /**
   * List all protocols.
   */
  list(): ProtocolEntry[] {
    return Array.from(this.entries.values())
  }

  /**
   * Remove a protocol.
   */
  unpublish(id: string): boolean {
    return this.entries.delete(id)
  }

  /**
   * Get marketplace stats.
   */
  stats(): { total: number; by_publisher: Record<string, number>; by_tag: Record<string, number> } {
    const entries = Array.from(this.entries.values())
    const by_publisher: Record<string, number> = {}
    const by_tag: Record<string, number> = {}

    for (const e of entries) {
      by_publisher[e.publisher] = (by_publisher[e.publisher] || 0) + 1
      for (const t of e.tags) {
        by_tag[t] = (by_tag[t] || 0) + 1
      }
    }

    return { total: entries.length, by_publisher, by_tag }
  }
}

/**
 * Singleton marketplace — shared across the process.
 */
export const marketplace = new ProtocolMarketplace()

// ---------------------------------------------------------------------------
// Built-in protocol descriptions — common APIs that agents often need
// ---------------------------------------------------------------------------

/** Pre-register well-known protocols */
export function registerBuiltins(): void {
  marketplace.publish({
    id: 'http-json-api',
    name: 'Generic HTTP JSON API',
    publisher: 'tomcp',
    version: '1.0.0',
    tags: ['http', 'json', 'rest', 'api'],
    tiers: {
      high: `## Generic HTTP JSON API

Make HTTP requests to the endpoint. Response is JSON.

### Authentication
If auth is provided in the descriptor:
- bearer: include \`Authorization: Bearer <token>\` header
- header: include the custom header with the token value

### Request
Use the method from the descriptor (default: GET).
For GET with query params, append them to the URL.
For POST/PUT, send JSON body with Content-Type: application/json.

### Output
Print the response JSON to stdout.`,
    },
    defaults: {
      protocol: 'https',
      format: 'json',
      mode: 'fetch',
      sandbox: { runtime: 'node', timeout_ms: 30_000 },
    },
  })

  marketplace.publish({
    id: 'http-paginated',
    name: 'HTTP Paginated API (cursor-based)',
    publisher: 'tomcp',
    version: '1.0.0',
    tags: ['http', 'json', 'pagination', 'cursor'],
    tiers: {
      high: `## HTTP Paginated API (Cursor-based)

Fetch all pages from a cursor-paginated API.

### Pagination Pattern
GET \`{endpoint}?cursor={cursor}&limit=100\`
- First request: omit cursor or set to empty
- Response: \`{ "data": [...], "next_cursor": string | null }\`
- Continue while next_cursor is not null
- Concatenate all data arrays

### Authentication
If auth is provided, include as Authorization header.

### Output
Print the complete aggregated JSON array to stdout.`,
    },
    defaults: {
      protocol: 'https',
      format: 'json',
      mode: 'fetch',
      sandbox: { runtime: 'node', timeout_ms: 60_000 },
    },
  })

  marketplace.publish({
    id: 'sse-stream',
    name: 'Server-Sent Events Stream',
    publisher: 'tomcp',
    version: '1.0.0',
    tags: ['sse', 'streaming', 'events', 'realtime'],
    tiers: {
      high: `## Server-Sent Events (SSE) Stream

Connect to an SSE endpoint and consume events.

### Connection
Use Node.js http/https.get to connect. Do NOT use EventSource.

### Parsing
Read the response stream line by line:
- Lines starting with "data: " contain event data
- Blank lines separate events
- Parse the data field as JSON

### Termination
The stream may end naturally (server closes) or continue indefinitely.
If the descriptor has stream.end_signal, watch for that value and disconnect.

### Output
Collect all events and print as JSON array to stdout.`,
    },
    defaults: {
      protocol: 'https',
      format: 'json',
      mode: 'stream',
      sandbox: { runtime: 'node', timeout_ms: 60_000 },
    },
  })

  marketplace.publish({
    id: 'webhook-push',
    name: 'Webhook Push (HTTP POST)',
    publisher: 'tomcp',
    version: '1.0.0',
    tags: ['webhook', 'push', 'upload', 'http'],
    tiers: {
      high: `## Webhook Push

Upload data to an endpoint via HTTP POST or PUT.

### Request
Method: from descriptor (default PUT)
Content-Type: from descriptor format field
Body: the data to upload (JSON stringified if object, raw if binary)

### Authentication
If auth is provided, include as Authorization header.

### Output
Print the response body to stdout.`,
    },
    defaults: {
      protocol: 'https',
      format: 'json',
      mode: 'push',
      sandbox: { runtime: 'node', timeout_ms: 30_000 },
    },
  })

  marketplace.publish({
    id: 's3-presigned',
    name: 'S3 Presigned URL Download',
    publisher: 'tomcp',
    version: '1.0.0',
    tags: ['s3', 'aws', 'presigned', 'download'],
    tiers: {
      high: `## S3 Presigned URL Download

The endpoint IS the presigned URL — no auth needed, it's baked into the URL.

### Request
Simple GET to the endpoint URL. No headers needed.

### Output
The response body is the file content. Print to stdout.
For binary files, use Buffer and write to stdout as base64.
For text/JSON, print directly.`,
    },
    defaults: {
      protocol: 's3-presigned',
      format: 'binary',
      mode: 'fetch',
      sandbox: { runtime: 'node', timeout_ms: 60_000 },
    },
  })
}
