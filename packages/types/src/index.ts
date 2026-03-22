import { z } from 'zod'

// ─── Level 2 Description ────────────────────────────────────

export const DescriptionTierSchema = z.enum(['high', 'mid', 'full'])
export type DescriptionTier = z.infer<typeof DescriptionTierSchema>

export const ProtocolDescriptionSchema = z.object({
  tier: DescriptionTierSchema,
  text: z.string().describe('Protocol guide the LLM reads to generate transfer code'),
  examples: z.array(z.string()).optional(),
  constraints: z.array(z.string()).optional(),
})
export type ProtocolDescription = z.infer<typeof ProtocolDescriptionSchema>

// ─── Sandbox Config ─────────────────────────────────────────

export const SandboxConfigSchema = z.object({
  runtime: z.enum(['node', 'python']),
  timeout_ms: z.number().default(30_000),
  allowed_hosts: z.array(z.string()),
})
export type SandboxConfig = z.infer<typeof SandboxConfigSchema>

// ─── Streaming Config ───────────────────────────────────────

export const StreamConfigSchema = z.object({
  reconnect: z.boolean().default(false),
  buffer_size: z.number().optional(),
  end_signal: z.string().optional().describe('String that signals end of stream'),
})
export type StreamConfig = z.infer<typeof StreamConfigSchema>

// ─── Auth ───────────────────────────────────────────────────

export const AuthSchema = z.object({
  type: z.enum(['bearer', 'header', 'query', 'hmac']),
  value: z.string().describe('Token or secret value'),
  header_name: z.string().optional().describe('Custom header name if type=header'),
})
export type Auth = z.infer<typeof AuthSchema>

// ─── Transfer Descriptor ────────────────────────────────────

export const TransferDescriptorSchema = z.object({
  $schema: z.literal('tomcp/v0.1'),
  transfer_id: z.string().uuid(),
  mode: z.enum(['fetch', 'push', 'stream']),
  protocol: z.string(),
  endpoint: z.string(),
  method: z.string().optional(),
  auth: AuthSchema.optional(),
  format: z.string(),
  compression: z.enum(['none', 'gzip', 'zstd']).optional(),
  size_hint: z.number().optional(),
  expires: z.string().optional(),
  checksum: z.string().optional(),
  fallback: z.enum(['inline', 'error']).default('inline'),

  // Level 2
  description: ProtocolDescriptionSchema.optional(),
  sandbox: SandboxConfigSchema.optional(),

  // Streaming
  stream: StreamConfigSchema.optional(),
})
export type TransferDescriptor = z.infer<typeof TransferDescriptorSchema>

// ─── Tool Inputs ────────────────────────────────────────────

export const NegotiateInputSchema = z.object({
  scenario: z.string().describe('Transfer scenario identifier'),
  client_capabilities: z.object({
    runtimes: z.array(z.enum(['node', 'python', 'shell'])),
  }),
  tier: DescriptionTierSchema.optional().default('high'),
})
export type NegotiateInput = z.infer<typeof NegotiateInputSchema>

export const DescribeProtocolInputSchema = z.object({
  protocol: z.string().describe('Protocol name to describe'),
  tier: DescriptionTierSchema,
})
export type DescribeProtocolInput = z.infer<typeof DescribeProtocolInputSchema>

export const ConfirmReceiptInputSchema = z.object({
  transfer_id: z.string().uuid(),
  status: z.enum(['success', 'failure']),
  records_received: z.number().optional(),
  bytes_received: z.number().optional(),
  error: z.string().optional(),
})
export type ConfirmReceiptInput = z.infer<typeof ConfirmReceiptInputSchema>
