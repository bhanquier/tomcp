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

/**
 * Minimal type declarations for the `redis` package (v4+).
 * We declare these inline so the module compiles without `redis` installed.
 */
interface RedisClientType {
  connect(): Promise<void>
  get(key: string): Promise<string | null>
  set(key: string, value: string, options?: { EX?: number }): Promise<string | null>
  del(key: string | string[]): Promise<number>
  keys(pattern: string): Promise<string[]>
}

interface RedisModule {
  createClient(opts: { url: string }): RedisClientType
}

export interface CacheEntry {
  code: string
  descriptionHash: string
  protocol: string
  createdAt: string
  hits: number
  lastUsed: string
}

/**
 * Common interface for all code cache implementations.
 */
export interface CodeCacheInterface {
  hash(descriptionText: string): string
  get(descriptionText: string): Promise<CacheEntry | undefined> | CacheEntry | undefined
  set(descriptionText: string, code: string, protocol: string): Promise<void> | void
  invalidate(descriptionText: string): Promise<boolean> | boolean
  stats(): Promise<{ size: number; entries: CacheEntry[] }> | { size: number; entries: CacheEntry[] }
  clear(): Promise<void> | void
}

/**
 * In-memory code cache. For production, consider using RedisCodeCache
 * for shared peer caching across processes.
 */
class CodeCache implements CodeCacheInterface {
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
  stats(): { size: number; entries: CacheEntry[] } {
    const entries = Array.from(this.entries.values())
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
 * Redis-backed code cache for shared peer caching across processes.
 *
 * Uses dynamic import for the `redis` package so it remains an optional
 * peer dependency — the module only fails at runtime if Redis is actually
 * requested but not installed.
 */
export class RedisCodeCache implements CodeCacheInterface {
  private clientPromise: Promise<RedisClientType>
  private ttlSeconds: number

  private static readonly KEY_PREFIX = 'tomcp:code:'
  private static readonly DEFAULT_TTL = 7 * 24 * 60 * 60 // 7 days

  constructor(opts: { url: string; ttl?: number }) {
    this.ttlSeconds = opts.ttl ?? RedisCodeCache.DEFAULT_TTL

    this.clientPromise = (async () => {
      // Dynamic import so `redis` remains an optional peer dependency
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const moduleName = 'redis'
      const redis = (await import(/* webpackIgnore: true */ moduleName)) as unknown as RedisModule
      const client = redis.createClient({ url: opts.url })
      await client.connect()
      return client
    })()
  }

  hash(descriptionText: string): string {
    return createHash('sha256').update(descriptionText).digest('hex').slice(0, 16)
  }

  async get(descriptionText: string): Promise<CacheEntry | undefined> {
    const client = await this.clientPromise
    const key = RedisCodeCache.KEY_PREFIX + this.hash(descriptionText)
    const raw = await client.get(key)
    if (!raw) return undefined

    const entry: CacheEntry = JSON.parse(raw)
    entry.hits++
    entry.lastUsed = new Date().toISOString()
    await client.set(key, JSON.stringify(entry), { EX: this.ttlSeconds })
    return entry
  }

  async set(descriptionText: string, code: string, protocol: string): Promise<void> {
    const client = await this.clientPromise
    const h = this.hash(descriptionText)
    const key = RedisCodeCache.KEY_PREFIX + h
    const entry: CacheEntry = {
      code,
      descriptionHash: h,
      protocol,
      createdAt: new Date().toISOString(),
      hits: 0,
      lastUsed: new Date().toISOString(),
    }
    await client.set(key, JSON.stringify(entry), { EX: this.ttlSeconds })
  }

  async invalidate(descriptionText: string): Promise<boolean> {
    const client = await this.clientPromise
    const key = RedisCodeCache.KEY_PREFIX + this.hash(descriptionText)
    const count = await client.del(key)
    return count > 0
  }

  async stats(): Promise<{ size: number; entries: CacheEntry[] }> {
    const client = await this.clientPromise
    const keys = await client.keys(RedisCodeCache.KEY_PREFIX + '*')
    const entries: CacheEntry[] = []
    for (const key of keys) {
      const raw = await client.get(key)
      if (raw) entries.push(JSON.parse(raw))
    }
    return { size: entries.length, entries }
  }

  async clear(): Promise<void> {
    const client = await this.clientPromise
    const keys = await client.keys(RedisCodeCache.KEY_PREFIX + '*')
    if (keys.length > 0) {
      await client.del(keys)
    }
  }
}

/**
 * Factory function to create a code cache instance.
 *
 * If `opts.redis` is provided, returns a RedisCodeCache backed by the
 * given Redis URL. Otherwise, returns a simple in-memory CodeCache.
 */
export function createCodeCache(opts?: { redis?: { url: string; ttl?: number } }): CodeCacheInterface {
  if (opts?.redis) return new RedisCodeCache(opts.redis)
  return new CodeCache()
}

/**
 * Singleton cache — shared across the process.
 */
export const codeCache: CodeCacheInterface = new CodeCache()
