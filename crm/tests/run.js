#!/usr/bin/env node
'use strict';
// Runs the test files one after another and fails if any check fails.
//   node tests/run.js                every *.test.js (what CI runs; no network needed)
//   node tests/run.js --live         also *.live.js (calls Yahoo Finance)
//   node tests/run.js email chat     only files whose name contains one of the words
// Browser tests need Chromium: CI installs it with `npx playwright-core install chromium`; locally set CHROME_BIN.
// Server tests need a built app (`sh build.sh`) and the server's dependencies (`npm ci` in server/).
const { spawn } = require('node:child_process');
const fs = require('node:fs'); const path = require('node:path');
const args = process.argv.slice(2); const live = args.includes('--live'); const words = args.filter((a) => !a.startsWith('--'));
const files = fs.readdirSync(__dirname).filter((f) => f.endsWith('.test.js') || (live && f.endsWith('.live.js'))).filter((f) => !words.length || words.some((w) => f.includes(w))).sort();
const TIMEOUT = 240e3;
(async () => {
  const results = [];
  for (const f of files) {
    const t0 = Date.now(); let out = '';
    const code = await new Promise((resolve) => {
      const p = spawn(process.execPath, [path.join(__dirname, f)], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
      p.stdout.on('data', (c) => (out += c)); p.stderr.on('data', (c) => (out += c));
      const timer = setTimeout(() => { out += '\nTIMEOUT after ' + TIMEOUT / 1000 + 's'; p.kill('SIGKILL'); }, TIMEOUT);
      p.on('close', (c) => { clearTimeout(timer); resolve(c); });
    });
    const pass = (out.match(/^PASS /gm) || []).length; const fail = (out.match(/^FAIL /gm) || []).length;
    const ok = code === 0 && fail === 0 && pass > 0;
    results.push({ f, ok, pass, fail, secs: ((Date.now() - t0) / 1000).toFixed(1) });
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${f.padEnd(34)} ${String(pass).padStart(3)} passed${fail ? `, ${fail} failed` : ''}  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    if (!ok) console.log(out.split('\n').filter((l) => !/ExperimentalWarning|trace-warnings/.test(l)).map((l) => '     ' + l).join('\n'));
  }
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length} of ${results.length} test files passed, ${results.reduce((a, r) => a + r.pass, 0)} checks.`);
  process.exit(bad.length ? 1 : 0);
})();
