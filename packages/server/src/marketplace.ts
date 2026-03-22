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

  // ── OAuth2 + Bearer Token API ──

  marketplace.publish({
    id: 'oauth2-bearer',
    name: 'OAuth2 Bearer Token API',
    publisher: 'tomcp',
    version: '1.0.0',
    tags: ['oauth2', 'bearer', 'auth', 'token', 'api'],
    tiers: {
      high: `## OAuth2 Bearer Token API

### Authentication
Include the auth token as: \`Authorization: Bearer <token>\`
The token is provided in the descriptor's auth.value field.

### Request
GET the endpoint URL. Include the Authorization header on every request.

### Error Handling
If you get a 401, the token may have expired. Print the error to stderr and exit with code 1.

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

  // ── GraphQL API ──

  marketplace.publish({
    id: 'graphql',
    name: 'GraphQL API',
    publisher: 'tomcp',
    version: '1.0.0',
    tags: ['graphql', 'api', 'query', 'mutation'],
    tiers: {
      high: `## GraphQL API

### Request
POST to the endpoint with Content-Type: application/json.

Body format:
\`\`\`json
{
  "query": "{ ... }",
  "variables": { ... }
}
\`\`\`

The GraphQL query should be provided in the descriptor's description constraints or inferred from context.

### Authentication
If auth is provided, include as Authorization: Bearer <token> header.

### Response
GraphQL responses have the shape: \`{ "data": { ... }, "errors": [...] }\`
If errors is non-empty, print errors to stderr.

### Output
Print the data field to stdout as JSON.`,
    },
    defaults: {
      protocol: 'https',
      format: 'json',
      mode: 'fetch',
      sandbox: { runtime: 'node', timeout_ms: 30_000 },
    },
  })

  // ── CSV Download ──

  marketplace.publish({
    id: 'csv-download',
    name: 'CSV File Download',
    publisher: 'tomcp',
    version: '1.0.0',
    tags: ['csv', 'download', 'export', 'data'],
    tiers: {
      high: `## CSV File Download

### Request
GET the endpoint. Response Content-Type is text/csv.

### Parsing
Parse the CSV:
- First line is headers
- Subsequent lines are data rows
- Fields are comma-separated
- Fields may be quoted with double quotes

Use a simple parser — split lines by \\n, split fields by comma, handle quoted fields.

### Output
Convert to JSON array of objects (using headers as keys) and print to stdout.`,
    },
    defaults: {
      protocol: 'https',
      format: 'csv',
      mode: 'fetch',
      sandbox: { runtime: 'node', timeout_ms: 60_000 },
    },
  })

  // ── NDJSON Stream ──

  marketplace.publish({
    id: 'ndjson-stream',
    name: 'NDJSON (Newline-Delimited JSON) Stream',
    publisher: 'tomcp',
    version: '1.0.0',
    tags: ['ndjson', 'jsonl', 'streaming', 'log', 'data'],
    tiers: {
      high: `## NDJSON Stream

### Request
GET the endpoint. Response is newline-delimited JSON (one JSON object per line).

### Parsing
Read the response line by line. Each non-empty line is a valid JSON object.
Parse each line with JSON.parse().

### Output
Collect all parsed objects into an array and print to stdout as JSON.`,
    },
    defaults: {
      protocol: 'https',
      format: 'ndjson',
      mode: 'fetch',
      sandbox: { runtime: 'node', timeout_ms: 60_000 },
    },
  })

  // ── Multipart Form Upload ──

  marketplace.publish({
    id: 'multipart-upload',
    name: 'Multipart Form Upload',
    publisher: 'tomcp',
    version: '1.0.0',
    tags: ['upload', 'multipart', 'form', 'file'],
    tiers: {
      high: `## Multipart Form Upload

### Request
POST to the endpoint with a multipart/form-data body.

Use Node.js built-in FormData:
\`\`\`js
const formData = new FormData();
formData.append('file', new Blob([data]), 'filename.ext');
\`\`\`

### Authentication
If auth is provided, include as Authorization header.

### Response
The server returns JSON confirming the upload.

### Output
Print the response JSON to stdout.`,
    },
    defaults: {
      protocol: 'https',
      format: 'binary',
      mode: 'push',
      sandbox: { runtime: 'node', timeout_ms: 60_000 },
    },
  })

  // ── Offset Pagination ──

  marketplace.publish({
    id: 'http-offset-paginated',
    name: 'HTTP Paginated API (offset-based)',
    publisher: 'tomcp',
    version: '1.0.0',
    tags: ['http', 'json', 'pagination', 'offset', 'limit'],
    tiers: {
      high: `## HTTP Offset-Paginated API

### Pagination
GET \`{endpoint}?offset={N}&limit={L}\`
- Start with offset=0, limit=100
- Response: \`{ "data": [...], "total": number }\`
- Increment offset by limit each request
- Stop when offset >= total

### Authentication
If auth is provided, include as Authorization header.

### Output
Print the complete aggregated array to stdout as JSON.`,
    },
    defaults: {
      protocol: 'https',
      format: 'json',
      mode: 'fetch',
      sandbox: { runtime: 'node', timeout_ms: 60_000 },
    },
  })

  // ── WebSocket JSON Messages ──

  marketplace.publish({
    id: 'websocket-json',
    name: 'WebSocket JSON Messages',
    publisher: 'tomcp',
    version: '1.0.0',
    tags: ['websocket', 'ws', 'realtime', 'json', 'bidirectional'],
    tiers: {
      high: `## WebSocket JSON Messages

### Connection
Connect to the WebSocket endpoint URL using Node.js built-in WebSocket (available in Node 22+):
\`\`\`js
const ws = new WebSocket(endpoint);
\`\`\`

### Messages
Each message is a JSON string. Parse with JSON.parse().
Collect all messages until the server closes the connection or a configurable timeout.

### Authentication
If auth is provided, include as a query parameter or in the URL:
\`{endpoint}?token={auth.value}\`

### Output
Print all collected messages as a JSON array to stdout.`,
    },
    defaults: {
      protocol: 'wss',
      format: 'json',
      mode: 'stream',
      sandbox: { runtime: 'node', timeout_ms: 60_000 },
    },
  })

  // ── XML/SOAP API ──

  marketplace.publish({
    id: 'xml-api',
    name: 'XML/SOAP API',
    publisher: 'tomcp',
    version: '1.0.0',
    tags: ['xml', 'soap', 'legacy', 'enterprise'],
    tiers: {
      high: `## XML/SOAP API

### Request
POST to the endpoint with Content-Type: text/xml or application/soap+xml.

Build the SOAP envelope:
\`\`\`xml
<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <!-- request content here -->
  </soap:Body>
</soap:Envelope>
\`\`\`

### Response
Parse the XML response. Extract the data from the SOAP Body.
Convert XML to JSON using simple regex or manual parsing (no external libs).

### Output
Print the extracted data as JSON to stdout.`,
    },
    defaults: {
      protocol: 'https',
      format: 'json',
      mode: 'fetch',
      sandbox: { runtime: 'node', timeout_ms: 30_000 },
    },
  })

  // ── Binary File with Range Requests ──

  marketplace.publish({
    id: 'http-range',
    name: 'HTTP Range Requests (partial download)',
    publisher: 'tomcp',
    version: '1.0.0',
    tags: ['http', 'range', 'partial', 'download', 'resume', 'binary'],
    tiers: {
      high: `## HTTP Range Requests

### Capability Check
First, send a HEAD request to get Content-Length and check for Accept-Ranges: bytes.

### Partial Download
To download a range: include header \`Range: bytes=START-END\`
Server responds with 206 Partial Content.

### Full Download
If no range is needed, simple GET returns the full file.

### Resumable Download
If a download is interrupted, resume by requesting from the last received byte.

### Output
Print the downloaded content to stdout. For binary, use base64 encoding.`,
    },
    defaults: {
      protocol: 'https',
      format: 'binary',
      mode: 'fetch',
      sandbox: { runtime: 'node', timeout_ms: 120_000 },
    },
  })

  // ── WebTorrent — P2P file transfer via magnet links ──

  marketplace.publish({
    id: 'webtorrent',
    name: 'WebTorrent P2P File Transfer',
    publisher: 'tomcp',
    version: '1.0.0',
    tags: ['p2p', 'torrent', 'webtorrent', 'magnet', 'bittorrent', 'decentralized'],
    tiers: {
      high: `## WebTorrent P2P File Transfer

Download a file via BitTorrent protocol using WebTorrent (works in Node.js).

### Setup
Install webtorrent: the endpoint field contains a magnet URI.

\`\`\`js
import WebTorrent from 'webtorrent';
const client = new WebTorrent();

client.add(magnetURI, (torrent) => {
  const file = torrent.files[0]; // or find by name
  const chunks = [];
  const stream = file.createReadStream();
  stream.on('data', chunk => chunks.push(chunk));
  stream.on('end', () => {
    const buffer = Buffer.concat(chunks);
    console.log(buffer.toString('utf-8')); // or base64 for binary
    client.destroy();
  });
});
\`\`\`

### Key Points
- The endpoint IS the magnet URI (magnet:?xt=urn:btih:...)
- WebTorrent uses WebRTC for peer discovery — works without trackers
- Files are verified via piece hashes — integrity is guaranteed by the protocol
- Multiple agents downloading the same magnet seed to each other automatically

### Output
Print file content to stdout. For binary, use base64.`,

      mid: `## WebTorrent P2P Transfer

Use the \`webtorrent\` npm package. The endpoint is a magnet URI.

\`\`\`
const WebTorrent = require('webtorrent');
const client = new WebTorrent();
client.add(endpoint, torrent => {
  torrent.files[0].getBuffer((err, buf) => {
    console.log(buf.toString());
    client.destroy();
  });
});
\`\`\`

Print file content to stdout. Destroy client when done.`,

      full: `## WebTorrent — Full Protocol Description

### What is WebTorrent
WebTorrent implements the BitTorrent protocol over WebRTC (and TCP).
It enables peer-to-peer file transfer in Node.js and browsers.

### Magnet URI
Format: \`magnet:?xt=urn:btih:<INFO_HASH>&dn=<DISPLAY_NAME>&tr=<TRACKER_URL>\`
- INFO_HASH: 40-char hex SHA-1 (v1) or 64-char hex SHA-256 (v2) of the torrent info dictionary
- dn: optional display name
- tr: optional tracker URLs (WebTorrent also uses DHT and WebRTC signaling)

### Protocol Flow
1. Parse magnet URI to extract info hash
2. Connect to DHT (Distributed Hash Table) and trackers to find peers
3. Exchange handshake: protocol name + info hash + peer ID
4. Request piece map (bitfield) from peers
5. Download pieces using rarest-first strategy
6. Verify each piece with SHA-1 hash
7. Assemble file from verified pieces

### Node.js Implementation
\`\`\`js
import WebTorrent from 'webtorrent';

const client = new WebTorrent();
const magnetURI = endpoint; // from descriptor

const torrent = await new Promise((resolve, reject) => {
  client.add(magnetURI, { path: '/tmp/tomcp-torrent' }, resolve);
  setTimeout(() => reject(new Error('Torrent timeout')), 60000);
});

// Wait for download to complete
await new Promise((resolve) => {
  torrent.on('done', resolve);
});

// Read the first file
const file = torrent.files[0];
const buffer = await new Promise((resolve, reject) => {
  file.getBuffer((err, buf) => err ? reject(err) : resolve(buf));
});

console.log(buffer.toString('utf-8'));
client.destroy();
\`\`\`

### Multi-Agent Seeding
When multiple agents download the same magnet URI via ToMCP:
- Agent A starts downloading from the original seeder
- Agent B joins — downloads from both seeder AND Agent A
- Agent C joins — downloads from all three
- Download speed scales with the number of agents (inverse of traditional client-server)

This is the key advantage over HTTP: the more agents need the data, the FASTER it transfers.

### Verification
BitTorrent guarantees data integrity via piece hashes in the torrent metadata.
No checksum field needed in the descriptor — the protocol handles it.

### Output
Print file content to stdout as UTF-8 or base64 (for binary files).`,
    },
    defaults: {
      protocol: 'webtorrent',
      format: 'binary',
      mode: 'fetch',
      sandbox: { runtime: 'node', timeout_ms: 120_000 },
    },
  })

  // ── IPFS — Content-Addressed Fetch ──

  marketplace.publish({
    id: 'ipfs',
    name: 'IPFS Content-Addressed Fetch',
    publisher: 'tomcp',
    version: '1.0.0',
    tags: ['ipfs', 'p2p', 'content-addressed', 'decentralized', 'cid'],
    tiers: {
      high: `## IPFS Content-Addressed Fetch

Fetch a file from IPFS using its Content Identifier (CID).

### Via HTTP Gateway (simplest)
IPFS content is accessible via HTTP gateways:
\`\`\`
GET https://ipfs.io/ipfs/<CID>
GET https://dweb.link/ipfs/<CID>
GET https://cloudflare-ipfs.com/ipfs/<CID>
\`\`\`

The endpoint field contains either:
- A full gateway URL: \`https://ipfs.io/ipfs/QmXxx...\`
- Just a CID: \`QmXxx...\` or \`bafyxxx...\` — prepend a gateway

### Via Helia (native IPFS in Node.js)
For direct P2P access without a gateway:
\`\`\`js
import { createHelia } from 'helia';
import { unixfs } from '@helia/unixfs';

const helia = await createHelia();
const fs = unixfs(helia);
const chunks = [];
for await (const chunk of fs.cat(CID.parse(cid))) {
  chunks.push(chunk);
}
console.log(Buffer.concat(chunks).toString());
await helia.stop();
\`\`\`

### Key Properties
- Content-addressed: the CID IS the hash of the content — integrity is guaranteed
- Immutable: same CID always returns same content
- Decentralized: content is replicated across nodes

### Output
Print file content to stdout.`,
    },
    defaults: {
      protocol: 'ipfs',
      format: 'binary',
      mode: 'fetch',
      sandbox: { runtime: 'node', timeout_ms: 120_000 },
    },
  })

  // ── BitTorrent v2 Concepts ──

  marketplace.publish({
    id: 'bittorrent-v2',
    name: 'BitTorrent v2 (SHA-256 + Merkle Trees)',
    publisher: 'tomcp',
    version: '1.0.0',
    tags: ['bittorrent', 'v2', 'p2p', 'merkle', 'sha256', 'decentralized'],
    tiers: {
      high: `## BitTorrent v2

BitTorrent v2 (BEP 52) uses SHA-256 piece hashes organized in Merkle trees.
Use WebTorrent or a v2-compatible client.

### Key Differences from v1
- SHA-256 instead of SHA-1 for piece hashes
- Per-file Merkle trees instead of flat piece hashes
- Hybrid torrents can work with both v1 and v2 clients
- Info hash is 32 bytes (SHA-256) instead of 20 bytes (SHA-1)

### Magnet URI
v2 magnet: \`magnet:?xt=urn:btmh:1220<SHA256_HEX>&dn=...\`
Hybrid magnet includes both: \`magnet:?xt=urn:btih:<SHA1>&xt=urn:btmh:1220<SHA256>\`

### For ToMCP
Use the same WebTorrent approach. The protocol handles v1/v2 negotiation.
Key advantage: Merkle trees enable per-file verification without downloading the entire torrent.

### Output
Print file content to stdout.`,
    },
    defaults: {
      protocol: 'bittorrent-v2',
      format: 'binary',
      mode: 'fetch',
      sandbox: { runtime: 'node', timeout_ms: 120_000 },
    },
  })
}
