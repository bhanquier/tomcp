import type { TransferDescriptor } from '@tomcp/types'
import type { SandboxResult } from './sandbox.js'

export interface Level1Result {
  stdout: string
  stderr: string
  exitCode: number
  timedOut: boolean
}

/**
 * Check if a descriptor can be handled at Level 1 (no LLM needed).
 */
export function isLevel1(descriptor: TransferDescriptor): boolean {
  return !descriptor.description || !descriptor.description.text
}

/**
 * Execute a Level 1 transfer using native Node.js capabilities.
 * Supports: http, https, fs
 */
export async function executeLevel1(descriptor: TransferDescriptor): Promise<SandboxResult> {
  const { protocol, endpoint, method, auth, format } = descriptor

  switch (protocol) {
    case 'http':
    case 'https':
      return executeHttpTransfer(descriptor)
    case 'fs':
      return executeFsTransfer(descriptor)
    default:
      return {
        stdout: '',
        stderr: `Level 1: unsupported protocol "${protocol}". Use Level 2 (description) instead.`,
        exitCode: 1,
        timedOut: false,
      }
  }
}

async function executeHttpTransfer(descriptor: TransferDescriptor): Promise<SandboxResult> {
  try {
    const headers: Record<string, string> = {}

    if (descriptor.auth) {
      if (descriptor.auth.type === 'bearer') {
        headers['Authorization'] = `Bearer ${descriptor.auth.value}`
      } else if (descriptor.auth.type === 'header') {
        headers[descriptor.auth.header_name ?? 'Authorization'] = descriptor.auth.value
      }
    }

    const response = await fetch(descriptor.endpoint, {
      method: descriptor.method ?? 'GET',
      headers,
    })

    if (!response.ok) {
      return {
        stdout: '',
        stderr: `HTTP ${response.status}: ${response.statusText}`,
        exitCode: 1,
        timedOut: false,
      }
    }

    const data = await response.text()
    return { stdout: data, stderr: '', exitCode: 0, timedOut: false }
  } catch (err) {
    return {
      stdout: '',
      stderr: `HTTP error: ${err instanceof Error ? err.message : String(err)}`,
      exitCode: 1,
      timedOut: false,
    }
  }
}

async function executeFsTransfer(descriptor: TransferDescriptor): Promise<SandboxResult> {
  try {
    const { readFile } = await import('node:fs/promises')
    const data = await readFile(descriptor.endpoint, 'utf-8')
    return { stdout: data, stderr: '', exitCode: 0, timedOut: false }
  } catch (err) {
    return {
      stdout: '',
      stderr: `FS error: ${err instanceof Error ? err.message : String(err)}`,
      exitCode: 1,
      timedOut: false,
    }
  }
}
