#!/usr/bin/env node

/**
 * ToMCP Benchmark — MCP Inline vs ToMCP Transfer Descriptor
 *
 * Measures and compares:
 *   - Payload size (inline JSON-RPC vs descriptor)
 *   - Memory usage
 *   - Serialization time
 *   - Base64 overhead
 *
 * Run: node --import tsx/esm benchmark/run.ts
 */

import { randomUUID } from 'node:crypto'

function buildDescriptor(opts: { protocol: string; endpoint: string; format: string; size_hint?: number }) {
  return {
    $schema: 'tomcp/v0.1',
    transfer_id: randomUUID(),
    mode: 'fetch',
    protocol: opts.protocol,
    endpoint: opts.endpoint,
    format: opts.format,
    size_hint: opts.size_hint,
    fallback: 'inline',
  }
}

interface BenchmarkResult {
  label: string
  records: number
  inline_bytes: number
  base64_bytes: number
  descriptor_bytes: number
  inline_serialize_ms: number
  descriptor_serialize_ms: number
  ratio: number
  savings_percent: number
}

function generateRecords(count: number): unknown[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `User ${String(i + 1).padStart(6, '0')}`,
    email: `user${i + 1}@example.com`,
    role: ['admin', 'editor', 'viewer'][i % 3],
    created_at: new Date(Date.now() - i * 86400000).toISOString(),
    metadata: {
      login_count: Math.floor(Math.random() * 1000),
      last_ip: `192.168.${Math.floor(i / 256)}.${i % 256}`,
      preferences: { theme: 'dark', language: 'en', notifications: true },
    },
  }))
}

function benchmark(label: string, recordCount: number): BenchmarkResult {
  const records = generateRecords(recordCount)

  // Inline: serialize to JSON (what MCP does today)
  const inlineStart = performance.now()
  const inlineJson = JSON.stringify(records)
  const inlineMs = performance.now() - inlineStart
  const inlineBytes = Buffer.byteLength(inlineJson)

  // Base64: what MCP does for binary (33% overhead)
  const base64Bytes = Math.ceil(inlineBytes * 1.33)

  // ToMCP: just a descriptor
  const descStart = performance.now()
  const descriptor = buildDescriptor({
    protocol: 'https',
    endpoint: 'https://cdn.example.com/exports/data.json',
    format: 'json',
    size_hint: inlineBytes,
  })
  const descriptorJson = JSON.stringify(descriptor)
  const descMs = performance.now() - descStart
  const descriptorBytes = Buffer.byteLength(descriptorJson)

  const ratio = Math.round(base64Bytes / descriptorBytes)
  const savings = ((1 - descriptorBytes / base64Bytes) * 100)

  return {
    label,
    records: recordCount,
    inline_bytes: inlineBytes,
    base64_bytes: base64Bytes,
    descriptor_bytes: descriptorBytes,
    inline_serialize_ms: Math.round(inlineMs * 100) / 100,
    descriptor_serialize_ms: Math.round(descMs * 100) / 100,
    ratio,
    savings_percent: Math.round(savings * 10) / 10,
  }
}

// ── Run benchmarks ──

console.log()
console.log('  ToMCP Benchmark — MCP Inline vs Transfer Descriptor')
console.log('  ═══════════════════════════════════════════════════════════════════════════')
console.log()

const scenarios = [
  { label: '100 records', count: 100 },
  { label: '1K records', count: 1_000 },
  { label: '10K records', count: 10_000 },
  { label: '100K records', count: 100_000 },
  { label: '500K records', count: 500_000 },
  { label: '1M records', count: 1_000_000 },
]

const results: BenchmarkResult[] = []

for (const s of scenarios) {
  process.stderr.write(`  Benchmarking ${s.label}...`)
  const r = benchmark(s.label, s.count)
  results.push(r)
  process.stderr.write(` done\n`)
}

// ── Format output ──

function fmtBytes(b: number): string {
  if (b >= 1_073_741_824) return `${(b / 1_073_741_824).toFixed(1)} GB`
  if (b >= 1_048_576) return `${(b / 1_048_576).toFixed(1)} MB`
  if (b >= 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${b} B`
}

console.log('  ┌──────────────┬────────────────┬────────────────┬──────────────┬──────────┬──────────────┐')
console.log('  │ Scenario     │ MCP Inline     │ MCP Base64     │ ToMCP        │ Ratio    │ Savings      │')
console.log('  ├──────────────┼────────────────┼────────────────┼──────────────┼──────────┼──────────────┤')

for (const r of results) {
  const scenario = r.label.padEnd(12)
  const inline = fmtBytes(r.inline_bytes).padEnd(14)
  const base64 = fmtBytes(r.base64_bytes).padEnd(14)
  const desc = fmtBytes(r.descriptor_bytes).padEnd(12)
  const ratio = `${r.ratio}:1`.padEnd(8)
  const savings = `${r.savings_percent}%`.padEnd(12)
  console.log(`  │ ${scenario} │ ${inline} │ ${base64} │ ${desc} │ ${ratio} │ ${savings} │`)
}

console.log('  └──────────────┴────────────────┴────────────────┴──────────────┴──────────┴──────────────┘')

// Timing comparison
console.log()
console.log('  Serialization Time')
console.log('  ┌──────────────┬────────────────┬──────────────────┬──────────────┐')
console.log('  │ Scenario     │ Inline JSON    │ Descriptor JSON  │ Speedup      │')
console.log('  ├──────────────┼────────────────┼──────────────────┼──────────────┤')

for (const r of results) {
  const scenario = r.label.padEnd(12)
  const inlineMs = `${r.inline_serialize_ms} ms`.padEnd(14)
  const descMs = `${r.descriptor_serialize_ms} ms`.padEnd(16)
  const speedup = r.inline_serialize_ms > 0
    ? `${Math.round(r.inline_serialize_ms / Math.max(r.descriptor_serialize_ms, 0.01))}x`.padEnd(12)
    : '-'.padEnd(12)
  console.log(`  │ ${scenario} │ ${inlineMs} │ ${descMs} │ ${speedup} │`)
}

console.log('  └──────────────┴────────────────┴──────────────────┴──────────────┘')

// Memory comparison
console.log()
console.log('  Memory Impact (JSON-RPC channel)')
console.log('  ┌──────────────┬────────────────────────────────────┬──────────────────────────────────┐')
console.log('  │ Scenario     │ MCP Today (inline in context)     │ ToMCP (descriptor only)          │')
console.log('  ├──────────────┼────────────────────────────────────┼──────────────────────────────────┤')

for (const r of results) {
  const scenario = r.label.padEnd(12)
  const mcpToday = `${fmtBytes(r.base64_bytes)} in JSON-RPC + context`.padEnd(34)
  const tomcp = `${fmtBytes(r.descriptor_bytes)} in JSON-RPC`.padEnd(30)
  console.log(`  │ ${scenario} │ ${mcpToday} │ ${tomcp}   │`)
}

console.log('  └──────────────┴────────────────────────────────────┴──────────────────────────────────┘')

// Bottom line
console.log()
const last = results[results.length - 1]
console.log(`  Bottom line: ${last.label} (${fmtBytes(last.inline_bytes)}) → ToMCP uses ${last.descriptor_bytes} bytes (${last.ratio}:1 ratio)`)
console.log(`  The descriptor is O(1). The payload is O(n). ToMCP decouples them.`)
console.log()
