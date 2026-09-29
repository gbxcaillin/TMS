#!/usr/bin/env node
'use strict';
// Empties the sample records inside SEED in the built index.html so production bundles do not
// carry demo deals, tasks, chat and invoices. Configuration keys (stages, fields, sources,
// settings) and the seed users are kept; blankState() needs them. Run by build.sh unless
// BUILD_DEMO=1, which keeps the full seed for previews and DEMO_DATA=1 workspaces.
const fs = require('node:fs');
const file = process.argv[2] || 'index.html';
const DEMO = ['rooms', 'messages', 'events', 'subscribers', 'deals', 'activity', 'tasks', 'threads', 'files', 'notifs', 'clients', 'changes', 'securities', 'models', 'invoices'];
let s = fs.readFileSync(file, 'utf8');
const start = s.indexOf('const SEED = {');
if (start < 0) { console.error('strip-demo: SEED not found'); process.exit(1); }
let depth = 0, end = -1;
for (let i = s.indexOf('{', start); i < s.length; i++) { const c = s[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) { end = i + 1; break; } } }
let seed = s.slice(start, end), removed = 0;
for (const key of DEMO) {
  const m = new RegExp('(\\n\\s*' + key + ':\\s*)\\[').exec(seed);
  if (!m) continue;
  const open = m.index + m[0].length - 1;
  let d = 0, close = -1;
  for (let i = open; i < seed.length; i++) { const c = seed[i]; if (c === '[') d++; else if (c === ']') { d--; if (d === 0) { close = i; break; } } }
  if (close < 0) continue;
  removed += close - open - 1;
  seed = seed.slice(0, open) + '[]' + seed.slice(close + 1);
}
s = s.slice(0, start) + seed + s.slice(end);
fs.writeFileSync(file, s);
console.log(`strip-demo: removed ${removed} bytes of sample records from ${file}`);
