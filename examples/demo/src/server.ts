#!/usr/bin/env node

/**
 * ToMCP Demo — MCP Server
 * Uses @tomcp/server to register transfer negotiation tools.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { registerToMCPTools, type ScenarioDefinition } from '@tomcp/server'
import { buildPaginatedApiDescriptor } from './scenarios/paginated-api.js'
import { buildBinaryCodecDescriptor } from './scenarios/binary-codec.js'
import { buildStreamingDescriptor } from './scenarios/streaming-events.js'

const scenarios: ScenarioDefinition[] = [
  { id: 'paginated-api', label: 'Paginated API with HMAC auth', build: buildPaginatedApiDescriptor },
  { id: 'binary-codec', label: 'Proprietary binary codec', build: buildBinaryCodecDescriptor },
  { id: 'streaming-events', label: 'SSE streaming with custom framing', build: buildStreamingDescriptor },
]

const server = new McpServer({ name: 'tomcp-demo', version: '0.1.0' })
registerToMCPTools(server, { scenarios })

const transport = new StdioServerTransport()
await server.connect(transport)
console.error('[tomcp] Demo MCP server running on stdio')
