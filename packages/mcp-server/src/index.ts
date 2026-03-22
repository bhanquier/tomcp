#!/usr/bin/env node

/**
 * ToMCP MCP Server
 *
 * Exposes Transfer Descriptor tools to any MCP client (Claude Code, etc.).
 *
 * Tools:
 *   tomcp_fetch              — Level 1 fetch via URL, returns data
 *   tomcp_marketplace_list   — List all protocols in the marketplace
 *   tomcp_marketplace_search — Search protocols by tag/query
 *   tomcp_describe           — Get a Transfer Descriptor from marketplace
 *   tomcp_benchmark          — Compare inline vs descriptor size for N records
 *   tomcp_stats              — Show transfer and cache stats
 *
 * Usage:
 *   tomcp-server                    # stdio transport
 *   MCP_TRANSPORT=http tomcp-server # HTTP transport on port 3456
 *
 * Claude Code config (~/.claude/mcp.json):
 *   { "mcpServers": { "tomcp": { "command": "npx", "args": ["@tomcp/mcp-server"] } } }
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import {
  marketplace,
  registerBuiltins,
  buildDescriptor,
  negotiate,
  compose,
  type ClientCapabilities,
} from '@tomcp/server'
import {
  handleDescriptor,
  tracer,
  codeCache,
} from '@tomcp/client'

registerBuiltins()

const server = new McpServer({
  name: 'tomcp',
  version: '0.1.0',
})

// ── tomcp_fetch ──

server.tool(
  'tomcp_fetch',
  'Fetch data from a URL using ToMCP Level 1. Returns the response data directly. Works with any HTTP/HTTPS URL.',
  {
    url: z.string().describe('URL to fetch'),
    format: z.enum(['json', 'text', 'binary']).default('json').describe('Expected response format'),
  },
  async (args) => {
    const descriptor = buildDescriptor({
      protocol: args.url.startsWith('https') ? 'https' : 'http',
      endpoint: args.url,
      format: args.format,
    })

    const result = await handleDescriptor(descriptor)

    if (!result.success) {
      return {
        content: [{ type: 'text' as const, text: `Fetch failed: ${result.sandboxResult.stderr.slice(0, 500)}` }],
        isError: true,
      }
    }

    const output = typeof result.parsedOutput === 'string'
      ? result.parsedOutput
      : JSON.stringify(result.parsedOutput, null, 2)

    return {
      content: [{ type: 'text' as const, text: output }],
    }
  },
)

// ── tomcp_marketplace_list ──

server.tool(
  'tomcp_marketplace_list',
  'List all protocols available in the ToMCP marketplace. Shows protocol ID, name, tags, and transfer mode.',
  {},
  async () => {
    const protocols = marketplace.list().map(p => ({
      id: p.id,
      name: p.name,
      tags: p.tags,
      mode: p.defaults.mode,
      version: p.version,
    }))

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(protocols, null, 2) }],
    }
  },
)

// ── tomcp_marketplace_search ──

server.tool(
  'tomcp_marketplace_search',
  'Search the protocol marketplace by keyword, tag, or publisher.',
  {
    query: z.string().optional().describe('Search by name or ID'),
    tag: z.string().optional().describe('Filter by tag (http, streaming, p2p, etc.)'),
  },
  async (args) => {
    const results = marketplace.search({ query: args.query, tag: args.tag })

    const summary = results.map(p => ({
      id: p.id,
      name: p.name,
      tags: p.tags,
      mode: p.defaults.mode,
      description_preview: p.tiers.high.slice(0, 100) + '...',
    }))

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(summary, null, 2) }],
    }
  },
)

// ── tomcp_describe ──

server.tool(
  'tomcp_describe',
  'Get a Transfer Descriptor for a marketplace protocol. Optionally provide an endpoint to make it actionable.',
  {
    protocol_id: z.string().describe('Protocol ID from marketplace'),
    endpoint: z.string().optional().describe('Target endpoint URL'),
    tier: z.enum(['high', 'mid', 'full']).default('high').describe('Description detail level'),
    auth_token: z.string().optional().describe('Auth token to include'),
  },
  async (args) => {
    const entry = marketplace.get(args.protocol_id)
    if (!entry) {
      return {
        content: [{ type: 'text' as const, text: `Protocol "${args.protocol_id}" not found. Use tomcp_marketplace_list to see available protocols.` }],
        isError: true,
      }
    }

    const descriptor = buildDescriptor({
      mode: entry.defaults.mode,
      protocol: entry.defaults.protocol,
      endpoint: args.endpoint ?? 'https://example.com',
      format: entry.defaults.format,
      description: {
        tier: args.tier as 'high' | 'mid' | 'full',
        text: entry.tiers[args.tier as keyof typeof entry.tiers] ?? entry.tiers.high,
      },
      sandbox: entry.defaults.sandbox,
      auth: args.auth_token ? { type: 'bearer', value: args.auth_token } : undefined,
    })

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(descriptor, null, 2) }],
    }
  },
)

// ── tomcp_benchmark ──

server.tool(
  'tomcp_benchmark',
  'Compare MCP inline payload size vs ToMCP descriptor for a given number of records. Shows the concrete savings.',
  {
    records: z.number().default(10000).describe('Number of records to simulate'),
  },
  async (args) => {
    const data = Array.from({ length: args.records }, (_, i) => ({
      id: i, name: `Record ${i}`, value: Math.random() * 1000,
      timestamp: new Date().toISOString(), tags: ['a', 'b'],
    }))

    const inlineSize = Buffer.byteLength(JSON.stringify(data))
    const base64Size = Math.ceil(inlineSize * 1.33)
    const descriptor = buildDescriptor({
      protocol: 'https',
      endpoint: 'https://storage.example.com/data.json',
      format: 'json',
      size_hint: inlineSize,
    })
    const descriptorSize = Buffer.byteLength(JSON.stringify(descriptor))
    const ratio = Math.round(base64Size / descriptorSize)

    const fmtBytes = (b: number) => {
      if (b >= 1_048_576) return `${(b / 1_048_576).toFixed(1)} MB`
      if (b >= 1024) return `${(b / 1024).toFixed(1)} KB`
      return `${b} B`
    }

    return {
      content: [{
        type: 'text' as const,
        text: [
          `Benchmark: ${args.records.toLocaleString()} records`,
          ``,
          `MCP inline:     ${fmtBytes(inlineSize)}`,
          `MCP base64:     ${fmtBytes(base64Size)}`,
          `ToMCP descriptor: ${fmtBytes(descriptorSize)}`,
          ``,
          `Ratio:    ${ratio.toLocaleString()}:1`,
          `Savings:  ${((1 - descriptorSize / base64Size) * 100).toFixed(1)}%`,
        ].join('\n'),
      }],
    }
  },
)

// ── tomcp_stats ──

server.tool(
  'tomcp_stats',
  'Show ToMCP transfer statistics and code cache state for the current session.',
  {},
  async () => {
    const transferStats = tracer.stats()
    const cacheStats = await codeCache.stats()

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          transfers: transferStats,
          cache: {
            size: cacheStats.size,
            protocols: cacheStats.entries.map(e => ({
              hash: e.descriptionHash,
              protocol: e.protocol,
              hits: e.hits,
            })),
          },
        }, null, 2),
      }],
    }
  },
)

// ── Start ──

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('[tomcp] MCP server running on stdio')
  console.error('[tomcp] Tools: tomcp_fetch, tomcp_marketplace_list, tomcp_marketplace_search, tomcp_describe, tomcp_benchmark, tomcp_stats')
}

main().catch(err => {
  console.error('[tomcp] Fatal:', err)
  process.exit(1)
})
