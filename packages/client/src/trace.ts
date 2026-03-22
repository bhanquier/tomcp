/**
 * Transfer Tracing — observability for ToMCP transfers.
 *
 * Every transfer (Level 1, 1.5, or 2) is recorded with timing,
 * status, and metadata. Enables dashboards, debugging, and auditing.
 */

export interface TransferTrace {
  transfer_id: string
  protocol: string
  mode: string
  level: '1' | '1.5' | '2'
  status: 'success' | 'failure' | 'in_progress'
  started_at: string
  completed_at?: string
  duration_ms?: number
  // Level 2 specific
  provider?: string       // "Gemini 2.5 Flash", "Claude Sonnet", etc.
  code_lines?: number     // lines of generated code
  tokens_saved?: boolean  // true if Level 1.5 cache hit
  // Result
  records_received?: number
  bytes_received?: number
  error?: string
  // Cache
  cache_hit?: boolean
  cache_hash?: string
}

export interface TraceListener {
  onTransfer(trace: TransferTrace): void
}

class TransferTracer {
  private traces: TransferTrace[] = []
  private listeners: TraceListener[] = []
  private maxTraces = 1000  // ring buffer

  /**
   * Start tracking a transfer. Returns a function to complete it.
   */
  start(opts: {
    transfer_id: string
    protocol: string
    mode: string
    level: '1' | '1.5' | '2'
    provider?: string
    cache_hit?: boolean
    cache_hash?: string
  }): TransferTrace {
    const trace: TransferTrace = {
      ...opts,
      status: 'in_progress',
      started_at: new Date().toISOString(),
      tokens_saved: opts.level === '1' || opts.level === '1.5',
    }
    this.traces.push(trace)
    if (this.traces.length > this.maxTraces) {
      this.traces.shift()
    }
    return trace
  }

  /**
   * Complete a transfer trace.
   */
  complete(trace: TransferTrace, result: {
    status: 'success' | 'failure'
    code_lines?: number
    records_received?: number
    bytes_received?: number
    error?: string
  }): void {
    trace.status = result.status
    trace.completed_at = new Date().toISOString()
    trace.duration_ms = new Date(trace.completed_at).getTime() - new Date(trace.started_at).getTime()
    trace.code_lines = result.code_lines
    trace.records_received = result.records_received
    trace.bytes_received = result.bytes_received
    trace.error = result.error

    for (const listener of this.listeners) {
      listener.onTransfer(trace)
    }
  }

  /**
   * Add a listener for transfer events.
   */
  addListener(listener: TraceListener): void {
    this.listeners.push(listener)
  }

  /**
   * Remove a listener.
   */
  removeListener(listener: TraceListener): void {
    this.listeners = this.listeners.filter(l => l !== listener)
  }

  /**
   * Get all traces.
   */
  getTraces(): TransferTrace[] {
    return [...this.traces]
  }

  /**
   * Get summary stats.
   */
  stats(): {
    total: number
    success: number
    failure: number
    by_level: Record<string, number>
    by_protocol: Record<string, number>
    avg_duration_ms: number
    tokens_saved_count: number
    cache_hits: number
  } {
    const completed = this.traces.filter(t => t.status !== 'in_progress')
    const success = completed.filter(t => t.status === 'success')
    const failure = completed.filter(t => t.status === 'failure')

    const by_level: Record<string, number> = {}
    const by_protocol: Record<string, number> = {}
    for (const t of completed) {
      by_level[t.level] = (by_level[t.level] || 0) + 1
      by_protocol[t.protocol] = (by_protocol[t.protocol] || 0) + 1
    }

    const durations = completed.filter(t => t.duration_ms).map(t => t.duration_ms!)
    const avg_duration_ms = durations.length > 0
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0

    return {
      total: completed.length,
      success: success.length,
      failure: failure.length,
      by_level,
      by_protocol,
      avg_duration_ms,
      tokens_saved_count: completed.filter(t => t.tokens_saved).length,
      cache_hits: completed.filter(t => t.cache_hit).length,
    }
  }

  /**
   * Clear all traces.
   */
  clear(): void {
    this.traces = []
  }
}

/**
 * Singleton tracer — shared across the process.
 */
export const tracer = new TransferTracer()
