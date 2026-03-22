# ToMCP — Bootstrap Prompt

Copy-paste this prompt to start a fresh session on Transfer over MCP.

---

## Prompt

```
I'm exploring a concept I call "Transfer over MCP" (ToMCP).

The core idea: MCP (Model Context Protocol) should act as a control plane / negotiation layer for data transfer — not as the data pipe itself. When an agent needs to transfer a large payload, MCP returns a "Transfer Descriptor" (protocol, endpoint, auth, format) and the actual data flows out-of-band via the optimal channel (HTTP, S3 presigned URL, WebSocket, gRPC, filesystem, etc.).

The analogy is SDP in WebRTC: SDP negotiates what will happen, then media flows peer-to-peer.

Context and prior art I've already mapped:
- MCP spec currently has no general out-of-band transfer mechanism (only `https://` resource URI hint)
- SEP-1306 (Binary Mode Elicitation) partially implements this for uploads: MCP provides an HTTP URL, client uploads directly
- MCP 2026 roadmap lists "reference-based results" as planned but unspecified
- ACP (IBM) has `content_url` in message parts — static, not negotiated
- ANP has a Meta-Protocol layer that does protocol negotiation — but via natural language + LLM, too heavy
- A2A (Google) has Agent Cards for static capability declaration, no per-transfer negotiation
- No protocol in the ecosystem has a structured, deterministic, per-transfer protocol negotiation mechanism

I have a draft Transfer Descriptor schema and flow in `Hobbies/transfer-over-mcp/README.md`.

What I need help with next: [INSERT YOUR SPECIFIC ASK — examples below]
- Review and poke holes in the Transfer Descriptor schema
- Draft a minimal proof-of-concept (MCP server that returns descriptors + client that follows them)
- Write this up as a proposal (SEP-style) for the MCP community
- Explore how this interacts with MCP's upcoming "Tasks" primitive (SEP-1686)
- Think through the auth delegation problem
- Compare more deeply with SDP/ICE negotiation flow
```

---

*Use this to resume work in any AI tool or session.*
