/**
 * ToMCP Dashboard — real-time transfer monitoring via HTTP.
 *
 * Starts a tiny HTTP server that serves:
 *   GET /           → HTML dashboard with auto-refresh
 *   GET /api/stats  → JSON tracer stats
 *   GET /api/traces → JSON recent traces
 *
 * Usage:
 *   import { startDashboard } from '@tomcp/client'
 *   const stop = startDashboard({ port: 4321 })
 *   // ... run transfers ...
 *   stop()
 */

import { createServer, type Server } from 'node:http'
import { tracer } from './trace.js'
import { codeCache, type CodeCacheInterface } from './code-cache.js'

export interface DashboardOptions {
  port?: number
  cache?: CodeCacheInterface
}

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ToMCP Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, system-ui, sans-serif; background: #0a0a0a; color: #e0e0e0; padding: 24px; }
    h1 { font-size: 20px; color: #fff; margin-bottom: 4px; }
    .subtitle { color: #888; font-size: 13px; margin-bottom: 24px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 24px; }
    .card { background: #161616; border: 1px solid #2a2a2a; border-radius: 8px; padding: 16px; }
    .card .label { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 1px; }
    .card .value { font-size: 28px; font-weight: 700; color: #fff; margin-top: 4px; }
    .card .value.green { color: #4ade80; }
    .card .value.red { color: #f87171; }
    .card .value.blue { color: #60a5fa; }
    .card .value.yellow { color: #facc15; }
    h2 { font-size: 16px; color: #fff; margin: 24px 0 12px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; padding: 8px 12px; color: #888; border-bottom: 1px solid #2a2a2a; font-weight: 500; }
    td { padding: 8px 12px; border-bottom: 1px solid #1a1a1a; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
    .badge.l1 { background: #064e3b; color: #4ade80; }
    .badge.l15 { background: #1e3a5f; color: #60a5fa; }
    .badge.l2 { background: #4a1d96; color: #c084fc; }
    .badge.ok { background: #064e3b; color: #4ade80; }
    .badge.fail { background: #7f1d1d; color: #f87171; }
    .badge.pending { background: #3b3b00; color: #facc15; }
    .bar { display: flex; height: 6px; border-radius: 3px; overflow: hidden; background: #2a2a2a; margin-top: 8px; }
    .bar .seg { height: 100%; }
    .bar .seg.l1 { background: #4ade80; }
    .bar .seg.l15 { background: #60a5fa; }
    .bar .seg.l2 { background: #c084fc; }
    .mono { font-family: 'SF Mono', monospace; font-size: 12px; }
  </style>
</head>
<body>
  <h1>ToMCP Dashboard</h1>
  <p class="subtitle">Transfer over MCP — real-time monitoring</p>

  <div class="grid" id="stats"></div>

  <h2>Level Distribution</h2>
  <div class="bar" id="levelBar"></div>
  <div style="display:flex;gap:16px;margin-top:8px;font-size:11px;color:#888;">
    <span><span class="badge l1">L1</span> Native</span>
    <span><span class="badge l15">L1.5</span> Cached</span>
    <span><span class="badge l2">L2</span> LLM</span>
  </div>

  <h2>Recent Transfers</h2>
  <table>
    <thead><tr><th>Level</th><th>Protocol</th><th>Status</th><th>Duration</th><th>Cache</th><th>Time</th></tr></thead>
    <tbody id="traces"></tbody>
  </table>

  <h2>Code Cache</h2>
  <div id="cache" style="margin-top:8px;"></div>

  <script>
    async function refresh() {
      const [statsRes, tracesRes, cacheRes] = await Promise.all([
        fetch('/api/stats').then(r => r.json()),
        fetch('/api/traces').then(r => r.json()),
        fetch('/api/cache').then(r => r.json()),
      ]);

      // Stats cards
      document.getElementById('stats').innerHTML = [
        card('Total', statsRes.total, ''),
        card('Success', statsRes.success, 'green'),
        card('Failed', statsRes.failure, 'red'),
        card('Avg Duration', statsRes.avg_duration_ms + 'ms', 'blue'),
        card('Tokens Saved', statsRes.tokens_saved_count, 'yellow'),
        card('Cache Hits', statsRes.cache_hits, 'blue'),
      ].join('');

      // Level bar
      const total = statsRes.total || 1;
      const l1 = (statsRes.by_level['1'] || 0) / total * 100;
      const l15 = (statsRes.by_level['1.5'] || 0) / total * 100;
      const l2 = (statsRes.by_level['2'] || 0) / total * 100;
      document.getElementById('levelBar').innerHTML =
        '<div class="seg l1" style="width:' + l1 + '%"></div>' +
        '<div class="seg l15" style="width:' + l15 + '%"></div>' +
        '<div class="seg l2" style="width:' + l2 + '%"></div>';

      // Traces table
      document.getElementById('traces').innerHTML = tracesRes.slice(-20).reverse().map(t =>
        '<tr>' +
        '<td><span class="badge l' + t.level.replace('.', '') + '">L' + t.level + '</span></td>' +
        '<td class="mono">' + t.protocol + '</td>' +
        '<td><span class="badge ' + (t.status === 'success' ? 'ok' : t.status === 'failure' ? 'fail' : 'pending') + '">' + t.status + '</span></td>' +
        '<td class="mono">' + (t.duration_ms ? t.duration_ms + 'ms' : '-') + '</td>' +
        '<td>' + (t.cache_hit ? '&#x2713;' : '') + '</td>' +
        '<td class="mono" style="color:#888">' + (t.started_at ? new Date(t.started_at).toLocaleTimeString() : '') + '</td>' +
        '</tr>'
      ).join('');

      // Cache
      document.getElementById('cache').innerHTML = cacheRes.entries.length === 0
        ? '<p style="color:#888;font-size:13px">No cached protocols yet</p>'
        : '<table><thead><tr><th>Hash</th><th>Protocol</th><th>Hits</th><th>Cached At</th></tr></thead><tbody>' +
          cacheRes.entries.map(e =>
            '<tr><td class="mono">' + e.descriptionHash + '</td><td>' + e.protocol + '</td><td>' + e.hits + '</td><td class="mono" style="color:#888">' + new Date(e.createdAt).toLocaleTimeString() + '</td></tr>'
          ).join('') + '</tbody></table>';
    }

    function card(label, value, color) {
      return '<div class="card"><div class="label">' + label + '</div><div class="value ' + color + '">' + value + '</div></div>';
    }

    refresh();
    setInterval(refresh, 2000);
  </script>
</body>
</html>`

export function startDashboard(opts?: DashboardOptions): () => void {
  const port = opts?.port ?? 4321
  const cache = opts?.cache ?? codeCache

  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, `http://localhost:${port}`)

    if (url.pathname === '/api/stats') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
      res.end(JSON.stringify(tracer.stats()))
      return
    }

    if (url.pathname === '/api/traces') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
      res.end(JSON.stringify(tracer.getTraces()))
      return
    }

    if (url.pathname === '/api/cache') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
      const stats = await cache.stats()
      res.end(JSON.stringify(stats))
      return
    }

    // Serve dashboard HTML
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(HTML)
  })

  server.listen(port, () => {
    console.error(`[tomcp] Dashboard running at http://localhost:${port}`)
  })

  return () => {
    server.close()
  }
}
