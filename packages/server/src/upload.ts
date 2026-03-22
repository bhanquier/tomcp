/**
 * Upload Descriptor — tells the client where and how to upload data.
 *
 * The server generates an upload descriptor with:
 *   - A presigned upload URL (or endpoint + auth)
 *   - Expected format and constraints
 *   - Optional Level 2 description for custom upload protocols
 */

import { randomUUID } from 'node:crypto'
import type { TransferDescriptor } from '@tomcp/types'

export interface UploadDescriptorOptions {
  /** The URL where the client should upload data */
  uploadUrl: string
  /** HTTP method for the upload (default: PUT) */
  method?: string
  /** Expected content type */
  contentType?: string
  /** Maximum upload size in bytes */
  maxSize?: number
  /** URL expiry */
  expires?: string
  /** Auth to include with the upload request */
  auth?: {
    type: 'bearer' | 'header' | 'query'
    value: string
    header_name?: string
  }
  /** Level 2: describe the upload protocol for LLM */
  description?: {
    tier: 'high' | 'mid' | 'full'
    text: string
    constraints?: string[]
  }
}

/**
 * Build a Transfer Descriptor for a push (upload) operation.
 */
export function buildUploadDescriptor(opts: UploadDescriptorOptions): TransferDescriptor {
  return {
    $schema: 'tomcp/v0.1' as const,
    transfer_id: randomUUID(),
    mode: 'push' as const,
    protocol: 'https',
    endpoint: opts.uploadUrl,
    method: opts.method ?? 'PUT',
    format: opts.contentType ?? 'application/octet-stream',
    size_hint: opts.maxSize,
    expires: opts.expires,
    fallback: 'error' as const,
    auth: opts.auth,
    description: opts.description,
    sandbox: opts.description ? {
      runtime: 'node' as const,
      timeout_ms: 60_000,
      allowed_hosts: [new URL(opts.uploadUrl).host],
    } : undefined,
  }
}

/**
 * Helper: create a presigned upload descriptor for Supabase Storage style URLs.
 */
export function buildPresignedUploadDescriptor(opts: {
  presignedUrl: string
  contentType?: string
  maxSize?: number
  expiresIn?: number
}): TransferDescriptor {
  const expires = opts.expiresIn
    ? new Date(Date.now() + opts.expiresIn * 1000).toISOString()
    : undefined

  return buildUploadDescriptor({
    uploadUrl: opts.presignedUrl,
    method: 'PUT',
    contentType: opts.contentType,
    maxSize: opts.maxSize,
    expires,
  })
}
