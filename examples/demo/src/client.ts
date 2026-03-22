#!/usr/bin/env node

/**
 * ToMCP Demo — Client
 * Uses @tomcp/client to handle Transfer Descriptors.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { executeTransfer, autoDetectProvider, type ExecutionResult } from '@tomcp/client'
import type { TransferDescriptor } from '@tomcp/types'

const SCENARIOS = ['paginated-api', 'binary-codec', 'streaming-events'] as const
const TIERS = ['high', 'mid', 'full'] as const
type Tier = (typeof TIERS)[number]
const START_TIER = (process.env.TOMCP_TIER ?? 'high') as Tier

async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════╗')
  console.log('║     Transfer over MCP (ToMCP) — Level 2 Demo        ║')
  console.log('║     MCP describes → LLM generates → Code executes   ║')
  console.log('╚══════════════════════════════════════════════════════╝')
  console.log()

  const provider = autoDetectProvider()
  console.log(`[client] LLM provider: ${provider.name}`)

  console.log('[client] Connecting to ToMCP MCP server...')
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['--import', 'tsx/esm', 'src/server.ts'],
  })

  const client = new Client({ name: 'tomcp-demo-client', version: '0.1.0' })
  await client.connect(transport)
  console.log('[client] Connected.\n')

  const results: ExecutionResult[] = []

  for (const scenario of SCENARIOS) {
    console.log(`${'═'.repeat(56)}`)
    console.log(`  Scenario: ${scenario}`)
    console.log(`${'═'.repeat(56)}`)

    try {
      const startIndex = TIERS.indexOf(START_TIER)
      let result: ExecutionResult | null = null

      for (let attempt = 0; attempt < 3; attempt++) {
        const tierIndex = startIndex + attempt
        if (tierIndex >= TIERS.length) break
        const tier = TIERS[tierIndex]

        if (attempt > 0) {
          console.log(`\n[client] Retrying with tier "${tier}"...`)
        }

        console.log(`\n[client] Negotiating (scenario="${scenario}", tier="${tier}")...`)
        const negotiateResult = await client.callTool({
          name: 'tomcp_negotiate',
          arguments: { scenario, tier, runtimes: 'node' },
        })

        const descriptorText = (negotiateResult.content as Array<{ type: string; text: string }>)[0]?.text
        if (!descriptorText) {
          console.error('[client] No descriptor received!')
          continue
        }

        const descriptor: TransferDescriptor = JSON.parse(descriptorText)
        console.log(`[client] Descriptor received:`)
        console.log(`  protocol: ${descriptor.protocol} | mode: ${descriptor.mode} | tier: ${descriptor.description.tier}`)
        console.log(`  endpoint: ${descriptor.endpoint}`)

        console.log(`\n[client] Executing Level 2 transfer (attempt ${attempt + 1})...`)
        result = await executeTransfer(descriptor, { provider, retryCount: attempt })

        const recordCount = Array.isArray(result.parsedOutput) ? result.parsedOutput.length : 0
        await client.callTool({
          name: 'tomcp_confirm_receipt',
          arguments: {
            transfer_id: descriptor.transfer_id,
            status: result.success ? 'success' : 'failure',
            records_received: recordCount,
            ...(result.success ? {} : { error: result.sandboxResult.stderr.slice(0, 200) }),
          },
        })

        if (result.success) break
        console.log(`\n[client] Failed at tier "${tier}"`)
      }

      if (result) {
        results.push(result)
        const recordCount = Array.isArray(result.parsedOutput) ? result.parsedOutput.length : 0
        console.log(`\n[client] Result:`)
        if (result.success) {
          console.log(`  ✓ ${recordCount} records`)
          if (Array.isArray(result.parsedOutput) && result.parsedOutput.length > 0) {
            console.log(`  ✓ Sample: ${JSON.stringify(result.parsedOutput[0])}`)
          }
        } else {
          console.log(`  ✗ FAILED (all tiers exhausted)`)
        }
      }
    } catch (err) {
      console.error(`[client] Error: ${err}`)
    }
    console.log()
  }

  console.log('╔══════════════════════════════════════════════════════╗')
  console.log('║                     Summary                         ║')
  console.log('╠══════════════════════════════════════════════════════╣')
  for (const r of results) {
    const icon = r.success ? '✓' : '✗'
    const records = Array.isArray(r.parsedOutput) ? r.parsedOutput.length : 0
    console.log(`║  ${icon} ${r.descriptor.protocol.padEnd(25)} ${records} records`.padEnd(55) + '║')
  }
  console.log('╚══════════════════════════════════════════════════════╝')

  await client.close()
  process.exit(0)
}

main().catch((err) => {
  console.error('[client] Fatal:', err)
  process.exit(1)
})
