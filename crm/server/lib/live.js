'use strict';
// Live updates over Server-Sent Events. Every signed-in tab holds one GET /api/v1/events stream open;
// whenever the revision counter moves (any record or setting saved by anyone, or by a background job)
// each stream is told the new revision and the client pulls straight away instead of waiting for its poll.
// Plain HTTP, so it passes through Caddy and Cloudflare untouched; a comment line every 25 s keeps the
// connection alive through their idle timeouts, and EventSource reconnects on its own if it drops.
const clients = new Set();
let pending = null;
let latest = 0;

function attach(req, res, userId, rev) {
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store, no-transform', 'connection': 'keep-alive', 'x-accel-buffering': 'no' });
  res.write('retry: 3000\n');
  res.write(`event: rev\ndata: ${rev}\n\n`);
  const c = { res, userId, at: Date.now() };
  clients.add(c);
  const drop = () => { clients.delete(c); clearInterval(c.beat); };
  c.beat = setInterval(() => { try { res.write(': ping\n\n'); } catch (_) { drop(); } }, 25000);
  req.on('close', drop); res.on('error', drop);
}

// Coalesce a burst of writes (one sync can bump the revision many times) into a single event.
function changed(rev) {
  latest = Math.max(latest, rev || 0);
  if (pending || !clients.size) return;
  pending = setTimeout(() => {
    pending = null;
    const line = `event: rev\ndata: ${latest}\n\n`;
    for (const c of clients) { try { c.res.write(line); } catch (_) { clients.delete(c); clearInterval(c.beat); } }
  }, 40);
}

function stats() { const by = {}; for (const c of clients) by[c.userId] = (by[c.userId] || 0) + 1; return { streams: clients.size, users: Object.keys(by).length }; }
module.exports = { attach, changed, stats };
