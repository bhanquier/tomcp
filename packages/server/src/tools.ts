import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { TransferDescriptor, DescriptionTier } from '@tomcp/types'

export interface ScenarioDefinition {
  id: string
  label: string
  build: (tier: DescriptionTier) => TransferDescriptor
}

export interface RegisterOptions {
  scenarios: ScenarioDefinition[]
}

/**
 * Registers the standard ToMCP tools (negotiate, describe, confirm) on an MCP server.
 */
export function registerToMCPTools(server: McpServer, opts: RegisterOptions): void {
  const scenarioIds = opts.scenarios.map(s => s.id)
  const receipts = new Map<string, unknown>()

  // tomcp_negotiate
  server.tool(
    'tomcp_negotiate',
    `Negotiate a data transfer. Available scenarios: ${scenarioIds.join(', ')}`,
    {
      scenario: z.string().describe(`Scenario ID. Available: ${scenarioIds.join(', ')}`),
      tier: z.enum(['high', 'mid', 'full']).default('high').describe('Description detail level'),
      runtimes: z.string().default('node').describe('Client runtimes (comma-separated)'),
    },
    async (args) => {
      const scenario = opts.scenarios.find(s => s.id === args.scenario)
      if (!scenario) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: `Unknown scenario: ${args.scenario}. Available: ${scenarioIds.join(', ')}` }) }],
          isError: true,
        }
      }
      const descriptor = scenario.build(args.tier as DescriptionTier)
      return { content: [{ type: 'text' as const, text: JSON.stringify(descriptor, null, 2) }] }
    },
  )

  // tomcp_describe_protocol
  server.tool(
    'tomcp_describe_protocol',
    'Get the protocol description for a scenario at a specific detail tier.',
    {
      scenario: z.string().describe(`Scenario ID. Available: ${scenarioIds.join(', ')}`),
      tier: z.enum(['high', 'mid', 'full']).describe('Detail level'),
    },
    async (args) => {
      const scenario = opts.scenarios.find(s => s.id === args.scenario)
      if (!scenario) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: `Unknown scenario: ${args.scenario}` }) }],
          isError: true,
        }
      }
      const descriptor = scenario.build(args.tier as DescriptionTier)
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ protocol: descriptor.protocol, tier: args.tier, description: descriptor.description }, null, 2) }],
      }
    },
  )

  // tomcp_confirm_receipt
  server.tool(
    'tomcp_confirm_receipt',
    'Confirm receipt of a transfer.',
    {
      transfer_id: z.string().describe('Transfer ID from the descriptor'),
      status: z.enum(['success', 'failure']).describe('Transfer outcome'),
      records_received: z.number().optional().describe('Number of records received'),
      error: z.string().optional().describe('Error message if failure'),
    },
    async (args) => {
      const receipt = { ...args, confirmed_at: new Date().toISOString() }
      receipts.set(args.transfer_id, receipt)
      return { content: [{ type: 'text' as const, text: JSON.stringify(receipt, null, 2) }] }
    },
  )
}
