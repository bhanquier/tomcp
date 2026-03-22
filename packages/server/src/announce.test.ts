import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { agentRegistry } from './announce.js'

describe('Agent Registry', () => {
  beforeEach(() => {
    // Clear by pruning with 0 TTL (or just re-test with unique IDs)
  })

  it('should register and retrieve an agent', () => {
    const agent = agentRegistry.announce({
      agent_id: 'agent-1',
      name: 'Data Agent',
      serves: [
        { protocol_id: 'https', endpoint: 'https://data.example.com', formats: ['json'], modes: ['fetch'] },
        { protocol_id: 'webtorrent', endpoint: 'magnet:?xt=...', formats: ['binary'], modes: ['fetch'] },
      ],
      consumes: ['https', 'fs'],
      capabilities: { level2: true, runtimes: ['node'] },
      ttl: 300,
    })

    assert.ok(agent.announced_at)
    assert.ok(agent.last_seen)

    const retrieved = agentRegistry.get('agent-1')
    assert.ok(retrieved)
    assert.equal(retrieved.name, 'Data Agent')
    assert.equal(retrieved.serves.length, 2)
  })

  it('should search by served protocol', () => {
    agentRegistry.announce({
      agent_id: 'agent-http',
      name: 'HTTP Agent',
      serves: [{ protocol_id: 'https', endpoint: 'https://a.com', formats: ['json'], modes: ['fetch'] }],
      consumes: [],
      capabilities: { level2: false, runtimes: ['node'] },
      ttl: 300,
    })

    agentRegistry.announce({
      agent_id: 'agent-torrent',
      name: 'Torrent Agent',
      serves: [{ protocol_id: 'webtorrent', endpoint: 'magnet:?xt=...', formats: ['binary'], modes: ['fetch'] }],
      consumes: [],
      capabilities: { level2: false, runtimes: ['node'] },
      ttl: 300,
    })

    const httpAgents = agentRegistry.search({ serves_protocol: 'https' })
    assert.ok(httpAgents.some(a => a.agent_id === 'agent-http'))
    assert.ok(!httpAgents.some(a => a.agent_id === 'agent-torrent'))

    const torrentAgents = agentRegistry.search({ serves_protocol: 'webtorrent' })
    assert.ok(torrentAgents.some(a => a.agent_id === 'agent-torrent'))
  })

  it('should search by Level 2 capability', () => {
    agentRegistry.announce({
      agent_id: 'agent-smart',
      name: 'Smart Agent',
      serves: [],
      consumes: ['https'],
      capabilities: { level2: true, runtimes: ['node', 'python'] },
      ttl: 300,
    })

    const l2Agents = agentRegistry.search({ level2: true })
    assert.ok(l2Agents.some(a => a.agent_id === 'agent-smart'))
  })

  it('should handle heartbeat', () => {
    agentRegistry.announce({
      agent_id: 'agent-hb',
      name: 'Heartbeat Agent',
      serves: [],
      consumes: [],
      capabilities: { level2: false, runtimes: ['node'] },
      ttl: 300,
    })

    const ok = agentRegistry.heartbeat('agent-hb')
    assert.equal(ok, true)

    const notFound = agentRegistry.heartbeat('nonexistent')
    assert.equal(notFound, false)
  })

  it('should deregister an agent', () => {
    agentRegistry.announce({
      agent_id: 'agent-bye',
      name: 'Temporary Agent',
      serves: [],
      consumes: [],
      capabilities: { level2: false, runtimes: ['node'] },
      ttl: 300,
    })

    assert.ok(agentRegistry.get('agent-bye'))
    const removed = agentRegistry.deregister('agent-bye')
    assert.equal(removed, true)
    assert.equal(agentRegistry.get('agent-bye'), undefined)
  })

  it('should return stats', () => {
    const stats = agentRegistry.stats()
    assert.ok(typeof stats.total === 'number')
    assert.ok(typeof stats.alive === 'number')
    assert.ok(typeof stats.by_protocol === 'object')
  })
})
