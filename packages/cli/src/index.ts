#!/usr/bin/env node

/**
 * tomcp CLI — test transfers from the terminal.
 *
 * Commands:
 *   tomcp fetch <url>                  Level 1 fetch
 *   tomcp describe <protocol-id>       Get protocol description from marketplace
 *   tomcp transfer <descriptor.json>   Execute a Transfer Descriptor (Level 1/1.5/2)
 *   tomcp marketplace                  List marketplace protocols
 *   tomcp cache                        Show code cache stats
 *   tomcp trace                        Show transfer trace stats
 */

import { parseArgs } from 'node:util'
import { readFile } from 'node:fs/promises'
import {
  handleDescriptor,
  executeTransfer,
  autoDetectProvider,
  codeCache,
  tracer,
  type ExecutionResult,
} from '@tomcp/client'
import { buildDescriptor, marketplace, registerBuiltins } from '@tomcp/server'
import type { TransferDescriptor } from '@tomcp/types'

const HELP = `
tomcp — Transfer over MCP CLI

Usage:
  tomcp fetch <url>                     Fetch data from URL (Level 1)
  tomcp transfer <descriptor.json>      Execute a Transfer Descriptor file
  tomcp marketplace [search]            List or search marketplace protocols
  tomcp describe <protocol-id> <url>    Build descriptor from marketplace
  tomcp cache                           Show code cache stats
  tomcp trace                           Show transfer trace stats
  tomcp help                            Show this help

Options:
  --format, -f    Output format (default: json)
  --tier, -t      Description tier: high, mid, full (default: high)
  --provider, -p  LLM provider: gemini, anthropic (default: auto)

Environment:
  GEMINI_API_KEY      For Gemini 2.5 Flash (Level 2)
  ANTHROPIC_API_KEY   For Claude Sonnet (Level 2)
`

async function main() {
  const args = process.argv.slice(2)

  if (args.length === 0 || args[0] === 'help' || args[0] === '--help') {
    console.log(HELP)
    return
  }

  const command = args[0]

  switch (command) {
    case 'fetch':
      return cmdFetch(args.slice(1))
    case 'transfer':
      return cmdTransfer(args.slice(1))
    case 'marketplace':
      return cmdMarketplace(args.slice(1))
    case 'describe':
      return cmdDescribe(args.slice(1))
    case 'cache':
      return cmdCache()
    case 'trace':
      return cmdTrace()
    default:
      console.error(`Unknown command: ${command}`)
      console.log(HELP)
      process.exit(1)
  }
}

// ── Commands ──

async function cmdFetch(args: string[]) {
  const url = args[0]
  if (!url) {
    console.error('Usage: tomcp fetch <url>')
    process.exit(1)
  }

  const descriptor = buildDescriptor({
    protocol: url.startsWith('https') ? 'https' : 'http',
    endpoint: url,
    format: 'json',
  })

  console.error(`[tomcp] Level 1 fetch: ${url}`)
  const result = await handleDescriptor(descriptor)
  printResult(result)
}

async function cmdTransfer(args: string[]) {
  const file = args[0]
  if (!file) {
    console.error('Usage: tomcp transfer <descriptor.json>')
    process.exit(1)
  }

  const raw = await readFile(file, 'utf-8')
  const descriptor: TransferDescriptor = JSON.parse(raw)

  const tier = getFlag(args, '--tier', '-t')
  console.error(`[tomcp] Executing Transfer Descriptor from ${file}`)
  console.error(`[tomcp] Protocol: ${descriptor.protocol} | Mode: ${descriptor.mode}`)

  if (descriptor.description) {
    console.error(`[tomcp] Level 2: ${descriptor.description.tier} tier (${descriptor.description.text.split('\n').length} lines)`)
  } else {
    console.error(`[tomcp] Level 1: native handler`)
  }

  const result = await handleDescriptor(descriptor)
  printResult(result)
}

async function cmdMarketplace(args: string[]) {
  registerBuiltins()
  const query = args[0]

  const results = query
    ? marketplace.search({ query })
    : marketplace.list()

  console.log(JSON.stringify(results.map(e => ({
    id: e.id,
    name: e.name,
    tags: e.tags,
    mode: e.defaults.mode,
    version: e.version,
  })), null, 2))
}

async function cmdDescribe(args: string[]) {
  const protocolId = args[0]
  const endpoint = args[1]

  if (!protocolId) {
    console.error('Usage: tomcp describe <protocol-id> <endpoint-url>')
    process.exit(1)
  }

  registerBuiltins()
  const entry = marketplace.get(protocolId)
  if (!entry) {
    console.error(`Protocol "${protocolId}" not found. Run: tomcp marketplace`)
    process.exit(1)
  }

  const tier = (getFlag(args, '--tier', '-t') ?? 'high') as 'high' | 'mid' | 'full'
  const descriptor = buildDescriptor({
    mode: entry.defaults.mode,
    protocol: entry.defaults.protocol,
    endpoint: endpoint || 'https://example.com',
    format: entry.defaults.format,
    description: {
      tier,
      text: entry.tiers[tier] ?? entry.tiers.high,
    },
    sandbox: entry.defaults.sandbox,
  })

  if (endpoint) {
    // Execute the transfer
    console.error(`[tomcp] Executing ${entry.name} against ${endpoint}`)
    const result = await handleDescriptor(descriptor)
    printResult(result)
  } else {
    // Just output the descriptor
    console.log(JSON.stringify(descriptor, null, 2))
  }
}

async function cmdCache() {
  const stats = await codeCache.stats()
  console.log(JSON.stringify(stats, null, 2))
}

async function cmdTrace() {
  const stats = tracer.stats()
  console.log(JSON.stringify(stats, null, 2))
}

// ── Helpers ──

function printResult(result: ExecutionResult) {
  if (result.success) {
    if (result.parsedOutput) {
      console.log(typeof result.parsedOutput === 'string'
        ? result.parsedOutput
        : JSON.stringify(result.parsedOutput, null, 2))
    }
  } else {
    console.error(`[tomcp] Transfer failed`)
    if (result.sandboxResult.stderr) {
      console.error(result.sandboxResult.stderr.slice(0, 500))
    }
    process.exit(1)
  }
}

function getFlag(args: string[], long: string, short: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === long || args[i] === short) && args[i + 1]) {
      return args[i + 1]
    }
  }
  return undefined
}

main().catch(err => {
  console.error(`[tomcp] Fatal: ${err.message}`)
  process.exit(1)
})
