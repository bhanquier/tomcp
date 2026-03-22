import { randomUUID } from 'node:crypto'
import type { TransferDescriptor, DescriptionTier } from '@tomcp/types'

const MOCK_PORT = process.env.MOCK_PORT ?? '4444'

const DESCRIPTIONS: Record<DescriptionTier, string> = {
  high: `## Protocol: Custom SSE Event Stream

Connect to http://localhost:4444/stream/events using Node.js http.get (no auth needed).

### How it works
The server sends Server-Sent Events. Each event line has the format:
  data: TYPE|JSON_PAYLOAD

Where TYPE is one of: DATA, HEARTBEAT, or END.

### Complete Node.js implementation pattern:

import http from 'node:http';

http.get('http://localhost:4444/stream/events', (res) => {
  let buffer = '';
  const allRecords = [];

  res.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const content = line.slice(6);
      const pipeIdx = content.indexOf('|');
      if (pipeIdx === -1) continue;
      const type = content.slice(0, pipeIdx);
      const payload = JSON.parse(content.slice(pipeIdx + 1));

      if (type === 'DATA') {
        allRecords.push(...payload.records);
      } else if (type === 'END') {
        console.log(JSON.stringify(allRecords));
        res.destroy();
        return;
      }
      // HEARTBEAT: ignore
    }
  });

  res.on('error', (err) => {
    console.error(err);
    process.exit(1);
  });
});

### Rules
- Use EXACTLY this pattern — it handles the SSE framing correctly
- Do NOT use fetch() or EventSource — use Node.js http.get
- The stream ends when you receive an END event — call res.destroy() after printing
- Print ALL collected records as a JSON array to stdout`,

  mid: `## Custom SSE Stream

GET {endpoint}, no auth. Response is text/event-stream.

Each line: \`data: TYPE|JSON\` where TYPE is DATA, HEARTBEAT, or END.
- DATA: { records: [...], offset: N } — collect records
- HEARTBEAT: ignore
- END: { total: N } — stop, print all records as JSON array to stdout

Use Node.js http.get, parse stream manually (not EventSource).`,

  full: `## Custom SSE Event Stream — Full Specification

### Transport
HTTP/1.1 GET request. Response Content-Type: text/event-stream.
Connection is long-lived — server pushes events until END.

### SSE Wire Format
Standard SSE: each event is one or more \`data: <content>\` lines followed by a blank line (\\n\\n).
This server sends single-line events.

### Custom Framing
Each data line contains: \`<TYPE>|<JSON>\`
- The pipe character "|" separates type from payload
- Split on the FIRST "|" only (payload may contain pipes)

### Event Types

#### DATA
Payload: \`{ "records": [{ "id": number, "name": string, "value": number, "category": string }], "offset": number }\`
- records: batch of 5 records
- offset: starting index of this batch
- Events arrive ~200ms apart

#### HEARTBEAT
Payload: \`{ "ts": number }\`
- Sent every 3 DATA events
- Ignore — used for connection keepalive

#### END
Payload: \`{ "total": number }\`
- Signals stream is complete
- Close the connection after receiving this
- total = expected total record count for validation

### Node.js Implementation Guide
\`\`\`
const http = require('http');
// or: import http from 'node:http';

http.get(endpoint, (res) => {
  let buffer = '';
  const allRecords = [];

  res.on('data', (chunk) => {
    buffer += chunk.toString();
    // Process complete lines
    const lines = buffer.split('\\n');
    buffer = lines.pop(); // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const content = line.slice(6); // Remove "data: "
      const pipeIdx = content.indexOf('|');
      const type = content.slice(0, pipeIdx);
      const json = JSON.parse(content.slice(pipeIdx + 1));

      if (type === 'DATA') allRecords.push(...json.records);
      if (type === 'END') {
        console.log(JSON.stringify(allRecords));
        res.destroy();
      }
    }
  });
});
\`\`\`

### Output
Print complete JSON array of all received records to stdout when END is received.`,
}

export function buildStreamingDescriptor(tier: DescriptionTier): TransferDescriptor {
  return {
    $schema: 'tomcp/v0.1',
    transfer_id: randomUUID(),
    mode: 'stream',
    protocol: 'custom-sse',
    endpoint: `http://localhost:${MOCK_PORT}/stream/events`,
    method: 'GET',
    format: 'json',
    fallback: 'inline',
    description: {
      tier,
      text: DESCRIPTIONS[tier],
      constraints: [
        'Must handle all three event types: DATA, HEARTBEAT, END',
        'Must accumulate records across multiple DATA events',
        'Must close connection on END event',
        'Must NOT use EventSource API',
      ],
    },
    sandbox: {
      runtime: 'node',
      timeout_ms: 30_000,
      allowed_hosts: [`localhost:${MOCK_PORT}`],
    },
    stream: {
      reconnect: false,
      end_signal: 'END',
    },
  }
}
