import { buildDescriptor, type DescriptorOptions } from './descriptor.js'

export interface ToMCPResultOptions extends Omit<DescriptorOptions, 'description'> {
  threshold: number  // bytes — above this, return descriptor
  description?: DescriptorOptions['description']
}

/**
 * Returns MCP tool result content. If data exceeds threshold, returns a Transfer Descriptor.
 * Otherwise returns the data inline as JSON text.
 */
export function tomcpResult(data: unknown, opts: ToMCPResultOptions) {
  const json = JSON.stringify(data, null, 2)
  const byteSize = Buffer.byteLength(json, 'utf-8')

  if (byteSize <= opts.threshold) {
    // Inline — data is small enough
    return {
      content: [{ type: 'text' as const, text: json }],
    }
  }

  // Out-of-band — return Transfer Descriptor
  const descriptor = buildDescriptor({
    ...opts,
    size_hint: byteSize,
    description: opts.description ?? {
      tier: 'high' as const,
      text: `GET the endpoint. Response is JSON. No special auth required.`,
    },
  })

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(descriptor, null, 2),
      },
    ],
  }
}
