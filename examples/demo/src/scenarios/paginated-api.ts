import { randomUUID } from 'node:crypto'
import type { TransferDescriptor, DescriptionTier } from '@tomcp/types'

const MOCK_PORT = process.env.MOCK_PORT ?? '4444'

const DESCRIPTIONS: Record<DescriptionTier, string> = {
  high: `## Protocol: Acme Paginated Export API

### Authentication
Every request requires three headers:
- \`X-Acme-Token\`: "acme-secret-token-42" (hardcoded, use this exact value)
- \`X-Acme-Timestamp\`: current Unix timestamp in milliseconds as a string (Date.now().toString())
- \`X-Acme-Signature\`: HMAC-SHA256 hex digest computed as follows:
  1. secret = "hmac-shared-secret"
  2. payload = "GET" + "/acme/export" + timestamp (concatenated, no separators)
  3. signature = crypto.createHmac('sha256', secret).update(payload).digest('hex')

### Fetching Data
GET \`http://localhost:4444/acme/export?cursor={cursor}&limit=10\`
- First request: cursor=0
- Response body: \`{ "data": [...], "next_cursor": number | null, "total": number }\`
- Keep fetching while next_cursor is not null, using it as the next cursor value

### Important
- Use Node.js built-in \`http\` and \`crypto\` modules (import from 'node:http' and 'node:crypto')
- The token and secret are provided above — hardcode them directly in the script
- Recompute the HMAC signature for each request because the timestamp changes

### Output
Print the aggregated array of ALL records as JSON to stdout using console.log(JSON.stringify(allRecords)).`,

  mid: `## Acme Export API

Auth: HMAC-SHA256 signing. Headers: X-Acme-Token (= auth.value), X-Acme-Timestamp (unix ms), X-Acme-Signature (HMAC-SHA256 of "GET/acme/export{timestamp}" with secret "hmac-shared-secret").

Pagination: GET {endpoint}?cursor=N&limit=10. Response has data array + next_cursor. Loop until next_cursor is null.

Print all records as JSON array to stdout.`,

  full: `## Acme Paginated Export API — Full Specification

### Transport
HTTP/1.1 over TCP. No TLS for this endpoint.

### Authentication Flow
1. Get current time: \`const timestamp = Date.now().toString()\`
2. Construct signing payload: concatenate HTTP method + URL path + timestamp
   Example: "GET/acme/export1711234567890"
3. Compute HMAC: \`crypto.createHmac('sha256', 'hmac-shared-secret').update(payload).digest('hex')\`
4. Set headers on every request:
   - X-Acme-Token: "acme-secret-token-42"
   - X-Acme-Timestamp: the timestamp string
   - X-Acme-Signature: the hex HMAC output

### Request Format
Method: GET
URL: {endpoint}?cursor={N}&limit={L}
- cursor: integer, starting at 0 for first request
- limit: integer, max 20, recommend 10

### Response Format
Content-Type: application/json
Body:
\`\`\`json
{
  "data": [
    { "id": 1, "name": "Record-001", "value": 42.5, "category": "alpha" },
    ...
  ],
  "next_cursor": 10,   // integer or null if last page
  "total": 47           // total record count
}
\`\`\`

### Pagination Algorithm
1. Request with cursor=0
2. Parse response
3. If next_cursor !== null, request with cursor=next_cursor
4. Repeat until next_cursor is null
5. Concatenate all data arrays

### Error Handling
- 401: authentication failed — check HMAC computation
- 404: invalid endpoint

### Output
Print the complete aggregated JSON array to stdout. No wrapping object needed.`,
}

export function buildPaginatedApiDescriptor(tier: DescriptionTier): TransferDescriptor {
  return {
    $schema: 'tomcp/v0.1',
    transfer_id: randomUUID(),
    mode: 'fetch',
    protocol: 'acme-paginated-api',
    endpoint: `http://localhost:${MOCK_PORT}/acme/export`,
    method: 'GET',
    auth: {
      type: 'header',
      value: 'acme-secret-token-42',
      header_name: 'X-Acme-Token',
    },
    format: 'json',
    size_hint: 4700,
    fallback: 'inline',
    description: {
      tier,
      text: DESCRIPTIONS[tier],
      examples: [
        'curl -H "X-Acme-Token: ..." -H "X-Acme-Timestamp: ..." -H "X-Acme-Signature: ..." "http://localhost:4444/acme/export?cursor=0&limit=10"',
      ],
      constraints: [
        'Must follow pagination to completion',
        'All records must be aggregated into a single JSON array',
        'HMAC signature must be recomputed for each request (timestamp changes)',
      ],
    },
    sandbox: {
      runtime: 'node',
      timeout_ms: 15_000,
      allowed_hosts: [`localhost:${MOCK_PORT}`],
    },
  }
}
