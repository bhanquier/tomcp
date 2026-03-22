# Discord Post — MCP Community

## Channel: #spec-discussion (or #seps)

---

**SEP-2433: Transfer Descriptors — Out-of-Band Data Transfer Negotiation**

Hey everyone! I've submitted a SEP proposing **Transfer Descriptors** — a structured mechanism for MCP servers to negotiate out-of-band data transfers instead of passing large payloads inline through JSON-RPC.

**The problem:** MCP today is both control plane and data plane. A 50MB dataset travels through JSON-RPC base64. This doesn't scale.

**The solution:** MCP returns a Transfer Descriptor (protocol, endpoint, auth, format) and the actual data flows through the optimal channel — HTTP, S3, WebSocket, whatever fits.

The analogy is **SDP in WebRTC**: SDP negotiates, media flows directly.

**Two levels:**
- **Level 1**: structured routing to a protocol the client already supports (deterministic, ~100 tokens)
- **Level 2**: the server *describes* the protocol so the client LLM can generate and execute transfer code — even for protocols it's never seen (new, enabled by LLMs)

**What's built:**
- Working PoC with 3 scenarios passing end-to-end (paginated API with HMAC auth, proprietary binary format, SSE streaming)
- 3 npm packages: `@tomcp/types`, `@tomcp/server`, `@tomcp/client`
- Protocol Marketplace for agents to discover and share protocol descriptions
- Redis peer cache so one agent learns a protocol and all agents benefit
- Multi-hop transfer chains
- Multi-LLM support (Gemini, Claude, bring-your-own)

**Links:**
- SEP PR: https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2433
- Code: https://github.com/bhanquier/tomcp
- Level 1.5 (JIT cache): first Level 2 run costs tokens, every run after is cached and deterministic

This aligns with the "reference-based results" item on the 2026 roadmap. Looking for a sponsor among the Core Maintainers!

Happy to answer questions or discuss design tradeoffs.

---

*Copy-paste this to the MCP Discord.*
