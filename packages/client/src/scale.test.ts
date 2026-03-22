import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildDescriptor } from '@tomcp/server'

/**
 * Scale tests — verify ToMCP descriptor overhead at various file sizes.
 *
 * We don't actually transfer 2GB in CI. Instead, we prove that the
 * descriptor size is CONSTANT regardless of payload size, and calculate
 * the overhead savings.
 */

describe('ToMCP scale characteristics', () => {
  const sizes = [
    { label: '1 KB', bytes: 1_024 },
    { label: '1 MB', bytes: 1_048_576 },
    { label: '10 MB', bytes: 10_485_760 },
    { label: '100 MB', bytes: 104_857_600 },
    { label: '1 GB', bytes: 1_073_741_824 },
    { label: '2 GB', bytes: 2_147_483_648 },
    { label: '10 GB', bytes: 10_737_418_240 },
  ]

  it('descriptor size is constant regardless of payload size', () => {
    const descriptorSizes: number[] = []

    console.log('')
    console.log('    ┌────────────┬──────────────┬──────────────┬─────────────┬───────────┐')
    console.log('    │ Payload    │ Inline (MCP) │ Base64 (MCP) │ Descriptor  │ Savings   │')
    console.log('    ├────────────┼──────────────┼──────────────┼─────────────┼───────────┤')

    for (const { label, bytes } of sizes) {
      const descriptor = buildDescriptor({
        protocol: 'https',
        endpoint: 'https://storage.example.com/exports/large-file.bin',
        format: 'binary',
        size_hint: bytes,
      })

      const descriptorJson = JSON.stringify(descriptor)
      const descriptorBytes = Buffer.byteLength(descriptorJson)
      const base64Bytes = Math.ceil(bytes * 1.33)
      const savings = ((1 - descriptorBytes / base64Bytes) * 100).toFixed(1)

      descriptorSizes.push(descriptorBytes)

      const fmtPayload = label.padEnd(8)
      const fmtInline = formatBytes(bytes).padEnd(12)
      const fmtBase64 = formatBytes(base64Bytes).padEnd(12)
      const fmtDesc = `${descriptorBytes} bytes`.padEnd(11)
      const fmtSavings = `${savings}%`.padEnd(9)

      console.log(`    │ ${fmtPayload} │ ${fmtInline} │ ${fmtBase64} │ ${fmtDesc} │ ${fmtSavings} │`)
    }

    console.log('    └────────────┴──────────────┴──────────────┴─────────────┴───────────┘')

    // All descriptors should be roughly the same size (< 50 bytes difference)
    const minSize = Math.min(...descriptorSizes)
    const maxSize = Math.max(...descriptorSizes)
    assert.ok(maxSize - minSize < 50, `Descriptor size should be near-constant (got range ${minSize}-${maxSize})`)
    assert.ok(maxSize < 500, `Descriptor should be under 500 bytes (got ${maxSize})`)
  })

  it('at 2GB, MCP inline would use 2.67GB, ToMCP uses ~300 bytes', () => {
    const twoGB = 2_147_483_648
    const base64Size = Math.ceil(twoGB * 1.33)

    const descriptor = buildDescriptor({
      protocol: 's3-presigned',
      endpoint: 'https://my-bucket.s3.amazonaws.com/export.bin?X-Amz-Signature=...',
      format: 'binary',
      size_hint: twoGB,
    })

    const descriptorSize = Buffer.byteLength(JSON.stringify(descriptor))

    // ToMCP uses 10 million times less data than inline
    const ratio = base64Size / descriptorSize
    assert.ok(ratio > 1_000_000, `Ratio should be > 1M (got ${ratio.toFixed(0)})`)
    assert.ok(descriptorSize < 500, `Descriptor should be < 500 bytes (got ${descriptorSize})`)
  })

  it('transfer descriptor overhead is O(1), not O(n)', () => {
    // Prove that doubling the payload size does NOT change the descriptor size
    const desc1 = buildDescriptor({
      protocol: 'https',
      endpoint: 'https://example.com/data',
      format: 'binary',
      size_hint: 1_000_000, // 1MB
    })
    const desc2 = buildDescriptor({
      protocol: 'https',
      endpoint: 'https://example.com/data',
      format: 'binary',
      size_hint: 1_000_000_000, // 1GB
    })

    const size1 = Buffer.byteLength(JSON.stringify(desc1))
    const size2 = Buffer.byteLength(JSON.stringify(desc2))

    // Size difference should only be from the size_hint digits (1000000 vs 1000000000)
    assert.ok(Math.abs(size1 - size2) < 20, `Descriptors should be near-identical in size (diff: ${Math.abs(size1 - size2)})`)
  })
})

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}
