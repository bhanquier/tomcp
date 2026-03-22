/**
 * Code Cache — Level 1.5 (Hybrid Mode)
 *
 * After a Level 2 transfer succeeds, the generated code is cached keyed
 * by a hash of the protocol description. Subsequent transfers with the
 * same description skip the LLM entirely and replay the cached code.
 *
 * If the cached code fails (API changed, etc.), the cache entry is
 * invalidated and the system falls back to Level 2 regeneration.
 */

import { createHash } from 'node:crypto'

export interface CacheEntry {
  code: string
  descriptionHash: string
  protocol: string
  createdAt: string
  hits: number
  lastUsed: string
}

/**
 * In-memory code cache. For production, this could be backed by
 * Redis, filesystem, or a database.
 */
class CodeCache {
  private entries = new Map<string, CacheEntry>()

  /**
   * Hash a description text to produce a stable cache key.
   */
  hash(descriptionText: string): string {
    return createHash('sha256').update(descriptionText).digest('hex').slice(0, 16)
  }

  /**
   * Look up cached code for a description.
   */
  get(descriptionText: string): CacheEntry | undefined {
    const key = this.hash(descriptionText)
    const entry = this.entries.get(key)
    if (entry) {
      entry.hits++
      entry.lastUsed = new Date().toISOString()
    }
    return entry
  }

  /**
   * Store generated code after a successful Level 2 execution.
   */
  set(descriptionText: string, code: string, protocol: string): void {
    const key = this.hash(descriptionText)
    this.entries.set(key, {
      code,
      descriptionHash: key,
      protocol,
      createdAt: new Date().toISOString(),
      hits: 0,
      lastUsed: new Date().toISOString(),
    })
  }

  /**
   * Invalidate a cache entry (e.g. when cached code fails).
   */
  invalidate(descriptionText: string): boolean {
    const key = this.hash(descriptionText)
    return this.entries.delete(key)
  }

  /**
   * Get cache stats.
   */
  stats(): { size: number; entries: Array<{ hash: string; protocol: string; hits: number; createdAt: string }> } {
    const entries = Array.from(this.entries.values()).map(e => ({
      hash: e.descriptionHash,
      protocol: e.protocol,
      hits: e.hits,
      createdAt: e.createdAt,
    }))
    return { size: this.entries.size, entries }
  }

  /**
   * Clear all cached code.
   */
  clear(): void {
    this.entries.clear()
  }
}

/**
 * Singleton cache — shared across the process.
 */
export const codeCache = new CodeCache()
