#!/usr/bin/env node

/**
 * ToMCP Proxy — sits between MCP client and server, intercepts large
 * responses and replaces them with Transfer Descriptors.
 *
 * Zero modification to the upstream MCP server. The proxy:
 *   1. Spawns the upstream server as a child process (stdio)
 *   2. Forwards all MCP messages transparently
 *   3. Intercepts tool call responses
 *   4. If response exceeds threshold:
 *      a. Writes the data to a temp file
 *      b. Starts a tiny HTTP server to serve it
 *      c. Returns a Transfer Descriptor with the URL instead
 *
 * Usage:
 *   tomcp-proxy --threshold 1048576 -- node my-mcp-server.js
 *
 * Or as a library:
 *   import { createProxy } from '@tomcp/proxy'
 */

import { randomUUID } from 'node:crypto'
import { writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type Server } from 'node:http'
import { readFile } from 'node:fs/promises'
import { Server as MCPServer } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type {
  CallToolRequest,
  ListToolsRequest,
} from '@modelcontextprotocol/sdk/types.js'

export interface ProxyOptions {
  /** Upstream MCP server command */
  command: string
  /** Command arguments */
  args?: string[]
  /** Byte threshold — responses above this get descriptored */
  threshold?: number
  /** Port for the temporary HTTP file server (default: 0 = random) */
  fileServerPort?: number
  /** Directory to store intercepted payloads */
  cacheDir?: string
}

interface StoredPayload {
  id: string
  path: string
  size: number
  createdAt: string
}

/**
 * Create and start a ToMCP proxy.
 */
export async function createProxy(opts: ProxyOptions) {
  const threshold = opts.threshold ?? 1_048_576 // 1MB default
  const cacheDir = opts.cacheDir ?? join(tmpdir(), 'tomcp-proxy')
  await mkdir(cacheDir, { recursive: true })

  const storedPayloads = new Map<string, StoredPayload>()

  // ── File server — serves intercepted payloads ──
  let fileServerUrl = ''
  const fileServer = createServer(async (req, res) => {
    const id = req.url?.slice(1) // Remove leading /
    if (!id) {
      res.writeHead(404)
      res.end('Not found')
      return
    }

    const payload = storedPayloads.get(id)
    if (!payload) {
      res.writeHead(404)
      res.end('Payload not found or expired')
      return
    }

    try {
      const data = await readFile(payload.path)
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': String(data.length),
      })
      res.end(data)
    } catch {
      res.writeHead(500)
      res.end('Failed to read payload')
    }
  })

  await new Promise<void>(resolve => {
    fileServer.listen(opts.fileServerPort ?? 0, () => {
      const addr = fileServer.address() as { port: number }
      fileServerUrl = `http://localhost:${addr.port}`
      console.error(`[tomcp-proxy] File server on ${fileServerUrl}`)
      resolve()
    })
  })

  // ── Connect to upstream MCP server ──
  const upstreamTransport = new StdioClientTransport({
    command: opts.command,
    args: opts.args,
  })
  const upstream = new Client({ name: 'tomcp-proxy', version: '0.1.0' })
  await upstream.connect(upstreamTransport)
  console.error(`[tomcp-proxy] Connected to upstream: ${opts.command} ${(opts.args ?? []).join(' ')}`)

  // ── Expose as MCP server to the client ──
  const server = new MCPServer(
    { name: 'tomcp-proxy', version: '0.1.0' },
    { capabilities: { tools: {} } },
  )

  // Forward listTools
  server.setRequestHandler(
    { method: 'tools/list' } as any,
    async () => {
      const tools = await upstream.listTools()
      return { tools: tools.tools }
    },
  )

  // Forward callTool — with interception
  server.setRequestHandler(
    { method: 'tools/call' } as any,
    async (request: any) => {
      const { name, arguments: args } = request.params

      // Forward to upstream
      const result = await upstream.callTool({ name, arguments: args })

      // Check response size
      const content = result.content as Array<{ type: string; text?: string }>
      const totalSize = content.reduce((sum, c) => sum + (c.text?.length ?? 0), 0)

      if (totalSize <= threshold) {
        // Small enough — pass through
        return result
      }

      // Large response — intercept and replace with Transfer Descriptor
      console.error(`[tomcp-proxy] Intercepting ${name}: ${formatBytes(totalSize)} > ${formatBytes(threshold)} threshold`)

      const payloadId = randomUUID()
      const payloadPath = join(cacheDir, `${payloadId}.json`)
      const fullText = content.map(c => c.text ?? '').join('')

      await writeFile(payloadPath, fullText)
      storedPayloads.set(payloadId, {
        id: payloadId,
        path: payloadPath,
        size: totalSize,
        createdAt: new Date().toISOString(),
      })

      const descriptor = {
        $schema: 'tomcp/v0.1',
        transfer_id: payloadId,
        mode: 'fetch',
        protocol: 'https',
        endpoint: `${fileServerUrl}/${payloadId}`,
        format: 'json',
        size_hint: totalSize,
        expires: new Date(Date.now() + 3600_000).toISOString(),
        fallback: 'inline',
      }

      console.error(`[tomcp-proxy] Replaced with descriptor: ${descriptor.endpoint}`)

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              _tomcp: true,
              message: `Response was ${formatBytes(totalSize)} — transferred out-of-band via ToMCP.`,
              descriptor,
              original_tool: name,
              original_size: totalSize,
              descriptor_size: JSON.stringify(descriptor).length,
              ratio: `${Math.round(totalSize / JSON.stringify(descriptor).length)}:1`,
            }, null, 2),
          },
        ],
      }
    },
  )

  // Start serving on stdio
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error(`[tomcp-proxy] Proxy ready (threshold: ${formatBytes(threshold)})`)

  return {
    stop: async () => {
      fileServer.close()
      await upstream.close()
      await server.close()
    },
  }
}

function formatBytes(b: number): string {
  if (b >= 1_048_576) return `${(b / 1_048_576).toFixed(1)}MB`
  if (b >= 1024) return `${(b / 1024).toFixed(1)}KB`
  return `${b}B`
}

// ── CLI entry point ──

async function main() {
  const args = process.argv.slice(2)

  // Parse --threshold
  let threshold = 1_048_576
  const thresholdIdx = args.indexOf('--threshold')
  if (thresholdIdx !== -1 && args[thresholdIdx + 1]) {
    threshold = parseInt(args[thresholdIdx + 1], 10)
    args.splice(thresholdIdx, 2)
  }

  // Everything after -- is the upstream command
  const dashIdx = args.indexOf('--')
  if (dashIdx === -1 || dashIdx === args.length - 1) {
    console.error('Usage: tomcp-proxy [--threshold BYTES] -- <command> [args...]')
    console.error('Example: tomcp-proxy --threshold 1048576 -- node my-mcp-server.js')
    process.exit(1)
  }

  const command = args[dashIdx + 1]
  const commandArgs = args.slice(dashIdx + 2)

  await createProxy({ command, args: commandArgs, threshold })
}

// Only run CLI if executed directly
const isDirectRun = process.argv[1]?.includes('proxy')
if (isDirectRun) {
  main().catch(err => {
    console.error(`[tomcp-proxy] Fatal: ${err.message}`)
    process.exit(1)
  })
}
