import { randomUUID } from 'node:crypto'
import type { TransferDescriptor, DescriptionTier, ProtocolDescription, SandboxConfig, Auth, StreamConfig } from '@tomcp/types'

export interface DescriptorOptions {
  mode?: 'fetch' | 'push' | 'stream'
  protocol: string
  endpoint: string
  method?: string
  auth?: Auth
  format?: string
  compression?: 'none' | 'gzip' | 'zstd'
  size_hint?: number
  expires?: string
  checksum?: string
  fallback?: 'inline' | 'error'
  description: ProtocolDescription
  sandbox?: Partial<SandboxConfig>
  stream?: StreamConfig
}

export function buildDescriptor(opts: DescriptorOptions): TransferDescriptor {
  return {
    $schema: 'tomcp/v0.1',
    transfer_id: randomUUID(),
    mode: opts.mode ?? 'fetch',
    protocol: opts.protocol,
    endpoint: opts.endpoint,
    method: opts.method,
    auth: opts.auth,
    format: opts.format ?? 'json',
    compression: opts.compression,
    size_hint: opts.size_hint,
    expires: opts.expires,
    checksum: opts.checksum,
    fallback: opts.fallback ?? 'inline',
    description: opts.description,
    sandbox: {
      runtime: opts.sandbox?.runtime ?? 'node',
      timeout_ms: opts.sandbox?.timeout_ms ?? 30_000,
      allowed_hosts: opts.sandbox?.allowed_hosts ?? [],
    },
    stream: opts.stream,
  }
}
