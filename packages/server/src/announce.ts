/**
 * Agent Protocol Announcement — agents declare what transfers they support.
 *
 * When an agent joins the network, it announces:
 *   - What protocols it can SERVE (as a data source)
 *   - What protocols it can CONSUME (as a data sink)
 *   - Its capabilities (runtimes, max payload, etc.)
 *
 * Other agents discover peers via the registry and negotiate
 * the best transfer protocol using negotiate().
 *
 * This completes the discovery loop:
 *   1. Agent announces → registered in AgentRegistry
 *   2. Another agent searches → finds matching peer
 *   3. negotiate() selects best protocol
 *   4. Transfer executes via handleDescriptor()
 */

export interface AgentAnnouncement {
  /** Unique agent ID */
  agent_id: string
  /** Human-readable name */
  name: string
  /** Protocols this agent can serve data via */
  serves: AgentProtocol[]
  /** Protocols this agent can consume data from */
  consumes: string[]
  /** Agent capabilities */
  capabilities: {
    level2: boolean
    runtimes: ('node' | 'python' | 'shell')[]
    max_payload_bytes?: number
  }
  /** When this agent announced */
  announced_at: string
  /** TTL in seconds — agent must re-announce before expiry */
  ttl: number
  /** Heartbeat — last seen alive */
  last_seen: string
}

export interface AgentProtocol {
  /** Protocol ID (matches marketplace IDs or custom) */
  protocol_id: string
  /** Endpoint base URL for this protocol */
  endpoint: string
  /** Supported formats */
  formats: string[]
  /** Supported modes */
  modes: ('fetch' | 'push' | 'stream')[]
}

export interface AgentSearchOptions {
  /** Find agents that serve this protocol */
  serves_protocol?: string
  /** Find agents that consume this protocol */
  consumes_protocol?: string
  /** Find agents with Level 2 support */
  level2?: boolean
  /** Find agents that can handle this payload size */
  min_payload_bytes?: number
}

class AgentRegistry {
  private agents = new Map<string, AgentAnnouncement>()

  /**
   * Register or update an agent announcement.
   */
  announce(announcement: Omit<AgentAnnouncement, 'announced_at' | 'last_seen'>): AgentAnnouncement {
    const full: AgentAnnouncement = {
      ...announcement,
      announced_at: this.agents.get(announcement.agent_id)?.announced_at ?? new Date().toISOString(),
      last_seen: new Date().toISOString(),
    }
    this.agents.set(announcement.agent_id, full)
    return full
  }

  /**
   * Heartbeat — update last_seen without re-announcing.
   */
  heartbeat(agent_id: string): boolean {
    const agent = this.agents.get(agent_id)
    if (!agent) return false
    agent.last_seen = new Date().toISOString()
    return true
  }

  /**
   * Get a specific agent.
   */
  get(agent_id: string): AgentAnnouncement | undefined {
    return this.agents.get(agent_id)
  }

  /**
   * Search for agents matching criteria.
   */
  search(opts?: AgentSearchOptions): AgentAnnouncement[] {
    let results = this.getAlive()

    if (opts?.serves_protocol) {
      const proto = opts.serves_protocol
      results = results.filter(a => a.serves.some(s => s.protocol_id === proto))
    }

    if (opts?.consumes_protocol) {
      const proto = opts.consumes_protocol
      results = results.filter(a => a.consumes.includes(proto))
    }

    if (opts?.level2 !== undefined) {
      results = results.filter(a => a.capabilities.level2 === opts.level2)
    }

    if (opts?.min_payload_bytes) {
      const min = opts.min_payload_bytes
      results = results.filter(a =>
        !a.capabilities.max_payload_bytes || a.capabilities.max_payload_bytes >= min,
      )
    }

    return results
  }

  /**
   * Get all alive agents (not expired).
   */
  getAlive(): AgentAnnouncement[] {
    const now = Date.now()
    return Array.from(this.agents.values()).filter(a => {
      const lastSeen = new Date(a.last_seen).getTime()
      return now - lastSeen < a.ttl * 1000
    })
  }

  /**
   * Remove an agent.
   */
  deregister(agent_id: string): boolean {
    return this.agents.delete(agent_id)
  }

  /**
   * Get registry stats.
   */
  stats(): { total: number; alive: number; by_protocol: Record<string, number> } {
    const alive = this.getAlive()
    const by_protocol: Record<string, number> = {}

    for (const a of alive) {
      for (const s of a.serves) {
        by_protocol[s.protocol_id] = (by_protocol[s.protocol_id] || 0) + 1
      }
    }

    return { total: this.agents.size, alive: alive.length, by_protocol }
  }

  /**
   * Prune expired agents.
   */
  prune(): number {
    const now = Date.now()
    let pruned = 0

    for (const [id, agent] of this.agents) {
      const lastSeen = new Date(agent.last_seen).getTime()
      if (now - lastSeen >= agent.ttl * 1000) {
        this.agents.delete(id)
        pruned++
      }
    }

    return pruned
  }
}

/**
 * Singleton agent registry.
 */
export const agentRegistry = new AgentRegistry()
