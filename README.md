# Transfer over MCP (ToMCP)

> MCP as a negotiation/discovery layer for data transfer — not as the pipe itself.

## The Idea

MCP today is used as both the control plane and the data plane. When an agent calls a tool and gets a 50MB response back, that blob travels through JSON-RPC base64. This doesn't scale.

**ToMCP** proposes a separation: MCP remains the **control plane** (discovery, negotiation, capability exchange) and delegates actual data transfer to the **optimal channel** (HTTP direct, presigned S3 URL, WebSocket stream, gRPC, filesystem path, etc.).

```
Agent A                    MCP Server                   Agent B / Storage
   │                          │                              │
   │── tool call ────────────>│                              │
   │                          │  (determines best channel)   │
   │<── transfer descriptor ──│                              │
   │    {                     │                              │
   │      protocol: "https",  │                              │
   │      url: "...",         │                              │
   │      auth: "Bearer ...", │                              │
   │      format: "ndjson",   │                              │
   │      expires: "..."      │                              │
   │    }                     │                              │
   │                          │                              │
   │──────────── direct transfer ───────────────────────────>│
```

## Two Levels

### Level 1 — Descriptor (routing)

MCP returns a structured Transfer Descriptor. The client **already knows** the protocol. Deterministic, cheap (~100 tokens), but limited to protocols the client supports.

### Level 2 — Description (teaching)

MCP **describes the protocol** so the client LLM can generate the code to execute it — even for protocols it has never seen before. This is a **protocol compiler**: documentation becomes executable code.

| | Level 1 (Descriptor) | Level 2 (Description) |
|---|---|---|
| Tokens | ~100 | ~2,000–10,000 |
| Reliability | Deterministic | Probabilistic (with retry/escalation) |
| Client prerequisite | Know the protocol | Have a runtime (Node.js, Python...) |
| Universality | Known protocols only | **Any describable protocol** |
| Analogy | HTTP 302 redirect | RFC-as-runtime |

## Demo

The PoC demonstrates the complete Level 2 flow with three scenarios:

```
╔══════════════════════════════════════════════════════╗
║     Transfer over MCP (ToMCP) — Level 2 Demo        ║
║     MCP describes → LLM generates → Code executes   ║
╚══════════════════════════════════════════════════════╝

✓ acme-paginated-api        47 records   (HMAC auth + 5 pages)
✓ tmcp-binary               10 records   (proprietary binary format)
✓ custom-sse                47 records   (real-time SSE stream)
```

| Scenario | Protocol | What it proves |
|----------|----------|----------------|
| **Paginated API** | Custom REST with HMAC-SHA256 auth | LLM learns a non-standard authentication scheme and pagination loop |
| **Binary Codec** | Proprietary binary format (magic, typed fields, footer) | LLM parses a format that exists nowhere on the internet |
| **SSE Stream** | Server-Sent Events with custom framing (`TYPE\|JSON`) | LLM consumes a real-time stream with custom event parsing |

### Running

```bash
# Set one of these:
export GEMINI_API_KEY=...       # Gemini 2.5 Flash
# or
export ANTHROPIC_API_KEY=...    # Claude Sonnet

# Run
npm install
./demo.sh

# Options
TOMCP_TIER=full ./demo.sh       # Start at "full" detail tier
```

### How it works

1. **Mock service** starts on port 4444 (3 endpoints: paginated API, binary, SSE)
2. **MCP server** spawns via stdio transport
3. For each scenario:
   - Client calls `tomcp_negotiate` → receives Transfer Descriptor with protocol description
   - Client sends `description.text` to LLM → LLM generates Node.js code
   - Generated code runs in sandboxed subprocess → executes the actual transfer
   - Client calls `tomcp_confirm_receipt` → reports result
4. If a tier fails, automatically retries with more detail (high → mid → full)

## Architecture

```
transfer-over-mcp/
├── src/
│   ├── shared/types.ts              # TransferDescriptor + Level 2 types (Zod)
│   ├── server/
│   │   ├── index.ts                 # MCP server (stdio transport)
│   │   ├── tools.ts                 # 3 tools: negotiate, describe, confirm
│   │   ├── descriptors.ts           # Scenario router
│   │   └── scenarios/
│   │       ├── paginated-api.ts     # HMAC auth + pagination (3 tiers)
│   │       ├── binary-codec.ts      # Proprietary binary format (3 tiers)
│   │       └── streaming-events.ts  # Custom SSE framing (3 tiers)
│   ├── client/
│   │   ├── index.ts                 # Demo runner
│   │   ├── executor.ts              # Descriptor → LLM → sandbox → result
│   │   └── sandbox.ts               # child_process wrapper
│   └── mock-services/
│       └── target-api.ts            # 3 foreign protocol endpoints
├── seps/
│   └── 2433-transfer-descriptors.md # SEP submitted to MCP community
├── demo.sh                          # One-command demo
└── PROMPT.md                        # Bootstrap prompt for new sessions
```

## Transfer Descriptor Schema

```jsonc
{
  "$schema": "tomcp/v0.1",
  "transfer_id": "uuid",
  "mode": "fetch" | "push" | "stream",
  "protocol": "https" | "s3-presigned" | "ws" | "custom-*",
  "endpoint": "https://...",
  "auth": { "type": "bearer" | "header" | "hmac", "value": "..." },
  "format": "json" | "ndjson" | "csv" | "binary" | "parquet",
  "compression": "none" | "gzip" | "zstd",
  "size_hint": 52428800,
  "expires": "ISO8601",
  "checksum": "sha256:...",
  "fallback": "inline",
  // Level 2:
  "description": {
    "tier": "high" | "mid" | "full",
    "text": "...",              // The protocol guide the LLM reads
    "examples": ["..."],
    "constraints": ["..."]
  },
  "sandbox": {
    "runtime": "node" | "python",
    "timeout_ms": 30000,
    "allowed_hosts": ["localhost:4444"]
  },
  // Streaming:
  "stream": {
    "reconnect": false,
    "end_signal": "END"
  }
}
```

## Description Tiers

| Tier | Tokens | Example | When to use |
|------|--------|---------|-------------|
| **high** | ~500 | "Use crypto.createHmac to sign requests, paginate with cursor" | Well-known patterns, common libraries |
| **mid** | ~2,000 | Protocol flow without byte-level detail | Less common, but standard enough |
| **full** | ~5,000+ | Packet formats, byte offsets, complete parsing algorithm | Proprietary/unknown, no existing library |

The client automatically escalates: high → mid → full on failure.

## SEP-2433

This concept has been submitted as a formal proposal to the MCP community:

**[SEP-2433: Transfer Descriptors — Out-of-Band Data Transfer Negotiation](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2433)**

## Why It Matters

Before LLMs, two systems that communicate had to **share an implementation** (SDK, library, driver). That's why we have hundreds of connectors, adapters, and wrappers.

With Level 2, you only need to **share a description**. The LLM bridges the gap. This makes the entire integration layer between systems — arguably 40% of enterprise code — potentially obsolete.

**Protocols become documentation. Documentation becomes executable.**

## Prior Art

| Protocol | What it does | Relation to ToMCP |
|----------|-------------|-------------------|
| **SDP/WebRTC** | Negotiates codec + transport before media flows | Direct analogy — ToMCP is SDP for agents |
| **HTTP 302** | Redirect to actual resource | Simplest form of "go fetch there instead" |
| **MCP SEP-1306** | Server provides upload URL via MCP message | Partial prior art, upload direction only |
| **ACP `content_url`** | Message parts reference external data | Static out-of-band, no negotiation |
| **ANP Meta-Protocol** | NL-mediated protocol negotiation between agents | Same goal, but LLM-heavy and non-deterministic |

---

*Created: 2026-03-22 | [SEP-2433](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2433)*
