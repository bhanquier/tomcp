/**
 * Marketplace MCP Tools — protocol discovery and publishing via MCP.
 *
 * Allows agents to:
 *   - Search for protocol descriptions
 *   - Get a description to use with Level 2
 *   - Publish their own protocols for other agents to discover
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { marketplace, registerBuiltins, type ProtocolEntry } from './marketplace.js'
import { buildDescriptor } from './descriptor.js'
import type { DescriptionTier } from '@tomcp/types'

/**
 * Register marketplace tools on an MCP server.
 * Call registerBuiltins() to pre-load common protocol descriptions.
 */
export function registerMarketplaceTools(server: McpServer, opts?: { builtins?: boolean }): void {
  if (opts?.builtins !== false) {
    registerBuiltins()
  }

  // ── tomcp_marketplace_search ──
  server.tool(
    'tomcp_marketplace_search',
    'Search the protocol marketplace for available protocol descriptions. Returns protocols that agents have published, which can be used with Level 2 transfers.',
    {
      query: z.string().optional().describe('Search by name, ID, or keyword'),
      tag: z.string().optional().describe('Filter by tag (e.g., "http", "streaming", "s3")'),
      publisher: z.string().optional().describe('Filter by publisher'),
    },
    async (args) => {
      const results = marketplace.search({
        query: args.query,
        tag: args.tag,
        publisher: args.publisher,
      })

      const summary = results.map(e => ({
        id: e.id,
        name: e.name,
        publisher: e.publisher,
        tags: e.tags,
        version: e.version,
        mode: e.defaults.mode,
      }))

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ count: results.length, protocols: summary }, null, 2) }],
      }
    },
  )

  // ── tomcp_marketplace_get ──
  server.tool(
    'tomcp_marketplace_get',
    'Get a protocol description from the marketplace. Returns a ready-to-use Transfer Descriptor with the protocol description embedded. Just provide an endpoint to make it actionable.',
    {
      protocol_id: z.string().describe('Protocol ID from marketplace search'),
      endpoint: z.string().describe('Target endpoint URL for the transfer'),
      tier: z.enum(['high', 'mid', 'full']).default('high').describe('Description detail level'),
      auth_token: z.string().optional().describe('Auth token to include in the descriptor'),
      auth_type: z.enum(['bearer', 'header']).optional().default('bearer').describe('Auth type'),
    },
    async (args) => {
      const entry = marketplace.get(args.protocol_id)
      if (!entry) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: `Protocol "${args.protocol_id}" not found in marketplace` }) }],
          isError: true,
        }
      }

      const tier = args.tier as DescriptionTier
      const descriptionText = entry.tiers[tier] ?? entry.tiers.high

      const descriptor = buildDescriptor({
        mode: entry.defaults.mode,
        protocol: entry.defaults.protocol,
        endpoint: args.endpoint,
        format: entry.defaults.format,
        description: {
          tier,
          text: descriptionText,
        },
        sandbox: entry.defaults.sandbox,
        auth: args.auth_token ? {
          type: args.auth_type ?? 'bearer',
          value: args.auth_token,
        } : undefined,
      })

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(descriptor, null, 2) }],
      }
    },
  )

  // ── tomcp_marketplace_publish ──
  server.tool(
    'tomcp_marketplace_publish',
    'Publish a protocol description to the marketplace so other agents can discover and use it.',
    {
      id: z.string().describe('Unique protocol ID (e.g., "myapp-export-v1")'),
      name: z.string().describe('Human-readable protocol name'),
      description_high: z.string().describe('High-level description (references libraries, ~500 tokens)'),
      description_mid: z.string().optional().describe('Mid-level description (~2000 tokens)'),
      description_full: z.string().optional().describe('Full specification (~5000+ tokens)'),
      protocol: z.string().default('https').describe('Transfer protocol'),
      format: z.string().default('json').describe('Data format'),
      mode: z.enum(['fetch', 'push', 'stream']).default('fetch').describe('Transfer mode'),
      tags: z.string().default('').describe('Comma-separated tags'),
      version: z.string().default('1.0.0').describe('Semver version'),
      publisher: z.string().default('unknown').describe('Publisher name'),
    },
    async (args) => {
      const entry = marketplace.publish({
        id: args.id,
        name: args.name,
        publisher: args.publisher,
        version: args.version,
        tags: args.tags ? args.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
        tiers: {
          high: args.description_high,
          mid: args.description_mid,
          full: args.description_full,
        },
        defaults: {
          protocol: args.protocol,
          format: args.format,
          mode: args.mode as 'fetch' | 'push' | 'stream',
          sandbox: { runtime: 'node', timeout_ms: 30_000 },
        },
      })

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          status: 'published',
          id: entry.id,
          version: entry.version,
          description_hash: entry.description_hash,
        }, null, 2) }],
      }
    },
  )

  // ── tomcp_marketplace_stats ──
  server.tool(
    'tomcp_marketplace_stats',
    'Get marketplace statistics — total protocols, by publisher, by tag.',
    {},
    async () => {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(marketplace.stats(), null, 2) }],
      }
    },
  )
}
