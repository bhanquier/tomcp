# ToMCP — Transfer over MCP

> MCP as a negotiation layer for data transfer — not the pipe itself.

**Protocols become documentation. Documentation becomes executable.**

[![CI](https://github.com/bhanquier/tomcp/actions/workflows/ci.yml/badge.svg)](https://github.com/bhanquier/tomcp/actions/workflows/ci.yml)
[![SEP-2433](https://img.shields.io/badge/SEP-2433-blue)](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2433)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## What is ToMCP?

MCP today passes everything through JSON-RPC — including 50MB datasets, binary files, and streaming data. ToMCP separates the **control plane** (MCP) from the **data plane** (HTTP, S3, WebSocket, etc.).

```
Agent                      MCP Server                    Data Source
  │── tool call ──────────>│                              │
  │<── Transfer Descriptor ─│  { protocol, endpoint,      │
  │                         │    auth, description... }    │
  │─────────── direct transfer ──────────────────────────>│
```

## Three Levels

| Level | What happens | Tokens | Reliability |
|-------|-------------|--------|-------------|
| **Level 1** | Native handler (http, fs) — no LLM | 0 | Deterministic |
| **Level 1.5** | Cached LLM code — JIT compiled protocol | 0 | Deterministic after 1st run |
| **Level 2** | LLM reads description, generates code, executes | 2K-10K | Probabilistic (with retry) |

**Level 1.5** is the key innovation: the LLM "compiles" a protocol once, then it's cached and replayed. First run costs tokens, every subsequent run is free.

## Packages

```bash
npm install @tomcp/types @tomcp/server @tomcp/client
```

| Package | What it does |
|---------|-------------|
| `@tomcp/types` | Zod schemas + TypeScript types for Transfer Descriptors |
| `@tomcp/server` | `buildDescriptor()`, `tomcpResult()`, marketplace, upload helpers |
| `@tomcp/client` | `handleDescriptor()`, LLM providers, sandbox, cache, chains |

## Quick Start

### Server — return descriptors instead of large payloads

```typescript
import { tomcpResult } from '@tomcp/server'

server.tool('export_data', schema, async (args) => {
  const data = await queryDB(args)  // might be 50MB
  return tomcpResult(data, {
    threshold: 1_000_000,  // > 1MB → return descriptor
    endpoint: 'https://my-cdn.com/exports/latest',
    protocol: 'https',
  })
})
```

### Client — handle descriptors automatically

```typescript
import { handleDescriptor } from '@tomcp/client'

// Level 1:   descriptor has no description → native fetch
// Level 1.5: description matches cache → replay cached code (0 tokens)
// Level 2:   new description → LLM generates code → cache for next time
const result = await handleDescriptor(descriptor)
```

### Protocol Marketplace — discover and share protocols

```typescript
import { registerMarketplaceTools, marketplace } from '@tomcp/server'

// Register marketplace tools on your MCP server
registerMarketplaceTools(server, { builtins: true })

// Agents can now:
// → tomcp_marketplace_search({ tag: "pagination" })
// → tomcp_marketplace_get({ protocol_id: "http-paginated", endpoint: "..." })
// → tomcp_marketplace_publish({ id: "my-api", description_high: "..." })
```

### Transfer Chains — multi-hop pipelines

```typescript
import { executeChain, chainStep } from '@tomcp/client'

const result = await executeChain([
  chainStep('Fetch data', fetchDescriptor),
  {
    label: 'Transform',
    descriptor: transformDescriptor,
    transform: (data) => (data as any[]).filter(r => r.active),
  },
  chainStep('Deliver', uploadDescriptor),
])
// Data flows: API A → transform → API C (MCP never touches the data)
```

### Redis Peer Cache — share compiled protocols across agents

```typescript
import { createCodeCache, handleDescriptor } from '@tomcp/client'

const cache = createCodeCache({
  redis: { url: 'redis://localhost:6379', ttl: 604800 }  // 7 days
})

// Agent A compiles a protocol → stored in Redis
await handleDescriptor(descriptor, { cache })

// Agent B (different process) → cache hit → 0 tokens
await handleDescriptor(descriptor, { cache })
```

### Observability — trace every transfer

```typescript
import { tracer } from '@tomcp/client'

tracer.addListener({
  onTransfer(trace) {
    console.log(`${trace.level} ${trace.protocol}: ${trace.status} (${trace.duration_ms}ms)`)
  }
})

const stats = tracer.stats()
// { total: 42, success: 40, cache_hits: 35, tokens_saved_count: 38, avg_duration_ms: 120 }
```

### Bidirectional — upload descriptors

```typescript
import { buildUploadDescriptor, buildPresignedUploadDescriptor } from '@tomcp/server'

// Tell the client where to upload
const descriptor = buildPresignedUploadDescriptor({
  presignedUrl: 'https://storage.example.com/upload?token=...',
  contentType: 'application/pdf',
  maxSize: 50_000_000,
  expiresIn: 3600,
})
```

## LLM Providers

```typescript
import { createGeminiProvider, createAnthropicProvider } from '@tomcp/client'

// Auto-detect from env vars (GEMINI_API_KEY or ANTHROPIC_API_KEY)
const result = await handleDescriptor(descriptor)

// Or explicit
const result = await handleDescriptor(descriptor, {
  provider: createGeminiProvider({ apiKey: '...' })
})

// Or bring your own
const result = await handleDescriptor(descriptor, {
  provider: {
    name: 'My Local LLM',
    generateCode: async (prompt) => { /* ... */ return code }
  }
})
```

## Demo

The demo runs 3 scenarios end-to-end — protocols the LLM has never seen:

```bash
export GEMINI_API_KEY=...  # or ANTHROPIC_API_KEY
cd examples/demo
npm install && ./demo.sh
```

```
✓ acme-paginated-api   47 records  (HMAC auth + 5 pages)
✓ tmcp-binary           10 records  (proprietary binary format)
✓ custom-sse            47 records  (real-time SSE stream)
```

## Architecture

```
packages/
├── types/              @tomcp/types
│   └── TransferDescriptor, schemas, types
├── server/             @tomcp/server
│   ├── descriptor.ts    buildDescriptor()
│   ├── middleware.ts    tomcpResult() — auto inline/descriptor
│   ├── upload.ts        buildUploadDescriptor()
│   ├── tools.ts         registerToMCPTools()
│   ├── marketplace.ts   protocol registry
│   └── marketplace-tools.ts  MCP tools for discovery
└── client/             @tomcp/client
    ├── handler.ts       handleDescriptor() — Level 1/1.5/2 routing
    ├── executor.ts      LLM code generation + sandbox
    ├── sandbox.ts       child_process execution
    ├── level1.ts        native http/fs handlers
    ├── code-cache.ts    in-memory + Redis JIT cache
    ├── chain.ts         multi-hop transfer pipelines
    ├── trace.ts         transfer observability
    └── providers/       Gemini, Anthropic, BYO
```

## The Idea Behind Level 2

Before LLMs, two systems that communicate had to **share an implementation** (SDK, library, driver). That's why we have hundreds of connectors, adapters, and wrappers.

With Level 2, you only need to **share a description**. The LLM bridges the gap. Any describable protocol becomes instantly usable by any agent, without pre-installed clients.

**Level 1.5** makes this practical: the LLM "compiles" the protocol once, then it's deterministic. First run is probabilistic (Level 2), every run after is cached (Level 1.5).

## SEP-2433

This concept has been submitted as a formal proposal to the MCP community:

**[SEP-2433: Transfer Descriptors](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2433)**

## License

MIT
