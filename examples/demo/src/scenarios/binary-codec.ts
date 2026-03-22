import { randomUUID } from 'node:crypto'
import type { TransferDescriptor, DescriptionTier } from '@tomcp/types'

const MOCK_PORT = process.env.MOCK_PORT ?? '4444'

const DESCRIPTIONS: Record<DescriptionTier, string> = {
  high: `## Protocol: TMCP Binary Record Format

Fetch the binary data from the endpoint with a simple GET request (no auth needed).

The response is a proprietary binary format. Parse it as follows using Node.js Buffers:

### Header (6 bytes)
- Bytes 0-3: Magic number "TMCP" (ASCII)
- Bytes 4-5: Record count (uint16, big-endian)

### Records (repeated N times, 3 fields per record)
Each field starts with a 1-byte type tag:
- Type 1 (int32): next 4 bytes are a signed 32-bit big-endian integer
- Type 2 (float64): next 8 bytes are a 64-bit big-endian double
- Type 3 (string): next 2 bytes are uint16 BE length, then N bytes of UTF-8

Each record has 3 fields in order: [int32 id] [string name] [float64 value]

### Footer (4 bytes)
- Bytes: "DONE" (ASCII) — confirms complete transmission

### Output
Parse all records into JSON objects { id, name, value } and print the array to stdout.`,

  mid: `## TMCP Binary Format

GET {endpoint}, no auth. Response is binary:
- 4 bytes magic "TMCP" + 2 bytes uint16BE record count
- Per record: 3 fields, each prefixed by type byte (1=int32BE/4bytes, 2=float64BE/8bytes, 3=string with uint16BE length prefix)
- Field order: id(int32), name(string), value(float64)
- 4 bytes "DONE" footer

Parse and print as JSON array of {id, name, value} to stdout.`,

  full: `## TMCP Binary Record Format — Full Byte-Level Specification

### Overview
A custom binary serialization format for tabular data. No compression, no encryption.

### Byte Layout

#### Header
| Offset | Size | Type | Value |
|--------|------|------|-------|
| 0 | 4 | ASCII | "TMCP" (magic number, 0x544D4350) |
| 4 | 2 | uint16 BE | Number of records (N) |

#### Record (repeated N times)
Each record consists of exactly 3 fields in fixed order:

**Field 1: id (int32)**
| Offset | Size | Type | Description |
|--------|------|------|-------------|
| +0 | 1 | uint8 | Type tag = 1 |
| +1 | 4 | int32 BE | The integer value |

**Field 2: name (string)**
| Offset | Size | Type | Description |
|--------|------|------|-------------|
| +0 | 1 | uint8 | Type tag = 3 |
| +1 | 2 | uint16 BE | String byte length (L) |
| +3 | L | UTF-8 | String content |

**Field 3: value (float64)**
| Offset | Size | Type | Description |
|--------|------|------|-------------|
| +0 | 1 | uint8 | Type tag = 2 |
| +1 | 8 | float64 BE | IEEE 754 double |

#### Footer
| Offset | Size | Type | Value |
|--------|------|------|-------|
| end-4 | 4 | ASCII | "DONE" (0x444F4E45) |

### Parsing Algorithm (Node.js)
\`\`\`
1. const buf = await fetch(endpoint).then(r => r.arrayBuffer()).then(Buffer.from)
2. Verify buf.slice(0,4).toString() === "TMCP"
3. const count = buf.readUInt16BE(4)
4. let offset = 6
5. For each record:
   a. Read type tag at offset (must be 1), read int32BE at offset+1, advance offset += 5
   b. Read type tag (must be 3), read uint16BE length at offset+1, read string at offset+3, advance offset += 3 + length
   c. Read type tag (must be 2), read doubleBE at offset+1, advance offset += 9
6. Verify buf.slice(offset, offset+4).toString() === "DONE"
\`\`\`

### Output
Print array of { id: number, name: string, value: number } as JSON to stdout.`,
}

export function buildBinaryCodecDescriptor(tier: DescriptionTier): TransferDescriptor {
  return {
    $schema: 'tomcp/v0.1',
    transfer_id: randomUUID(),
    mode: 'fetch',
    protocol: 'tmcp-binary',
    endpoint: `http://localhost:${MOCK_PORT}/binary/records`,
    method: 'GET',
    format: 'binary',
    fallback: 'inline',
    description: {
      tier,
      text: DESCRIPTIONS[tier],
      constraints: [
        'Must validate magic number "TMCP" at start',
        'Must validate "DONE" footer at end',
        'Must handle all 3 field types correctly',
      ],
    },
    sandbox: {
      runtime: 'node',
      timeout_ms: 10_000,
      allowed_hosts: [`localhost:${MOCK_PORT}`],
    },
  }
}
