'use strict';
// Reference fund data: fees, returns, ratings and risk from Morningstar screener exports (CSV), kept in SharePoint
// under <SP_FOLDER>/Research/Reference data so the team can replace or edit them. Two export shapes are understood:
//   ETFs:           Name, Ticker, Exchange, ... Investment Management Fee (%), ...
//   Managed funds:  Name, Symbol, APIR Code, ... Investment Management Fee(%), TCR (P), ...
// Every CSV in the folder is read (a large export can be split into parts); the newest file wins when two list the
// same fund. A third shape is a plain list of ASX codes (Code, Company), such as the S&P/ASX 200 constituents: its
// companies are added to the library as securities and tagged with the list's name (the file name, "ASX 200.csv"
// becomes "ASX 200"). The data lives server-side only (about 8,000 rows) and reaches the app through search and through the
// `ms` block and fee it writes onto matching securities in the research library.
const fs = require('node:fs');
const path = require('node:path');
const D = require('./db');

const FILE = path.join(D.DATA_DIR, 'refdata.json');
const FOLDER_NAME = 'Research/Reference data';
let DATA = null;

function load() {
  if (DATA) return DATA;
  try { DATA = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { DATA = { files: [], items: {}, at: '' }; }
  DATA.files = DATA.files || []; DATA.items = DATA.items || {};
  return DATA;
}
function persist() { const tmp = FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(DATA)); fs.renameSync(tmp, FILE); }

// RFC 4180 CSV: quoted fields, doubled quotes, CRLF or LF, optional BOM.
function parseCsv(text) {
  text = String(text).replace(/^﻿/, '');
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; continue; }
    if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); f = ''; if (row.length > 1 || row[0] !== '') rows.push(row); row = []; }
    else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}
// Morningstar numbers: "1,234.50 ", "−0.47" (Unicode minus), "" for none.
function num(v) { if (v == null) return null; const s = String(v).replace(/[\s,]/g, '').replace(/[−–]/g, '-'); if (s === '' || s === '-') return null; const n = Number(s); return Number.isFinite(n) ? n : null; }
const str = (v) => String(v == null ? '' : v).trim();

// Morningstar category to the app's asset classes.
function clsOf(cat) {
  const c = String(cat || '');
  if (/real estate|property|infrastructure/i.test(c)) return 'Property & infrastructure';
  if (/bond|fixed (interest|income)|credit|debt|mortgage|reserve backed/i.test(c)) return 'Fixed interest';
  if (/cash/i.test(c)) return 'Cash';
  if (/multisector|life stages/i.test(c)) return 'Multi‑asset';
  if (/alternative|multistrategy|commodit|precious|digital|miscellaneous|macro|trend|private equity/i.test(c)) return 'Alternatives';
  if (/equity australia|australia equity|region australia\b|region australasia/i.test(c)) return 'Australian equities';
  if (/equity|long\/short/i.test(c)) return 'International equities';
  return '';
}
const EXCH = { ASX: ['.AX', 'ASX'], CHIA: ['.XA', 'Cboe Australia'], CXA: ['.XA', 'Cboe Australia'], NZSE: ['.NZ', 'NZX'], NZX: ['.NZ', 'NZX'] };

// One CSV (text) to { kind, items: { key: rec } }. Throws when the columns are not a known export.
function parseExport(text) {
  const rows = parseCsv(text); if (rows.length < 2) throw new Error('The file has no rows');
  const H = rows[0].map((h) => h.replace(/™/g, '').trim());
  const col = (...names) => { for (const n of names) { const i = H.findIndex((h) => h.toLowerCase() === n.toLowerCase()); if (i >= 0) return i; } return -1; };
  const iTicker = col('Ticker'), iExch = col('Exchange'), iApir = col('APIR Code'), iSym = col('Symbol'), iName = col('Name');
  const kind = iTicker >= 0 && iExch >= 0 ? 'etf' : iApir >= 0 ? 'fund' : '';
  if (!kind) { const l = parseList(rows, col); if (l) return l; }
  if (!kind || iName < 0) throw new Error('This is not a Morningstar export or a list of ASX codes (it needs Name plus Ticker and Exchange, or APIR Code, or a Code column)');
  const I = {
    medal: col('Morningstar Medalist Rating'), medalAt: col('Medalist Rating Date'), fee: col('Investment Management Fee (%)', 'Investment Management Fee(%)'), tcr: col('TCR (P)'),
    cat: col('Morningstar Category'), price: col('Last Close Price'), ccy: col('Price Currency'), net: col('Net Assets(mil)'), size: col('Fund Size (Mil)'),
    esg: col('Portfolio ESG Risk Rating'), m1: col('1 Month Return (%)'), m3: col('3 Months Return (%)'), m6: col('6 Months Return (%)'), ytd: col('YTD Return (%)'),
    y1: col('1 Year Annualised (%)'), y3: col('3 Years Annualised (%)'), y5: col('5 Years Annualised (%)'), y10: col('10 Years Annualised (%)'),
    eqStyle: col('Equity StyleBox'), fiStyle: col('Fixed Income StyleBox'), credit: col('Average Credit Quality'), dur: col('Effective Duration'),
    stars: col('Morningstar Rating'), risk: col('Morningstar Risk (Rel to Category)'), alpha: col('3 Year Alpha'), beta: col('3 Year Beta'), r2: col('3 Year R-Squared'),
    sd: col('3 Year Standard Deviation'), sharpe: col('3 Year Sharpe Ratio'), tenure: col('Manager Tenure (Yrs)'),
  };
  const g = (r, i) => (i >= 0 ? r[i] : '');
  const items = {};
  for (const r of rows.slice(1)) {
    const name = str(g(r, iName)); if (!name) continue;
    let key, code, ex;
    if (kind === 'etf') { const t = str(g(r, iTicker)).toUpperCase(); if (!t) continue; const e = EXCH[str(g(r, iExch)).toUpperCase()] || ['', str(g(r, iExch))]; key = t + e[0]; code = t; ex = e[1]; }
    else { const a = str(g(r, iApir)).toUpperCase(); const s = str(g(r, iSym)); if (a) { key = a; code = a; } else if (s) { key = 'MS' + s; code = ''; } else continue; ex = 'Unlisted'; }
    const cat = str(g(r, I.cat));
    const rec = {
      key, code, name, kind, ex, cat, cls: clsOf(cat),
      fee: num(g(r, I.fee)), icr: num(g(r, I.tcr)),
      medal: str(g(r, I.medal)), medalAt: str(g(r, I.medalAt)), stars: num(g(r, I.stars)), risk: num(g(r, I.risk)),
      ret: { m1: num(g(r, I.m1)), m3: num(g(r, I.m3)), m6: num(g(r, I.m6)), ytd: num(g(r, I.ytd)), y1: num(g(r, I.y1)), y3: num(g(r, I.y3)), y5: num(g(r, I.y5)), y10: num(g(r, I.y10)) },
      sd3: num(g(r, I.sd)), sharpe3: num(g(r, I.sharpe)), alpha3: num(g(r, I.alpha)), beta3: num(g(r, I.beta)), r2: num(g(r, I.r2)),
      size: num(g(r, I.size)) ?? num(g(r, I.net)), esg: num(g(r, I.esg)), style: str(g(r, I.eqStyle)) || str(g(r, I.fiStyle)), credit: str(g(r, I.credit)), dur: num(g(r, I.dur)), tenure: num(g(r, I.tenure)),
      price: num(g(r, I.price)), ccy: str(g(r, I.ccy)) || 'AUD',
    };
    // Drop empty fields to keep the store small.
    for (const k of Object.keys(rec)) if (rec[k] === '' || rec[k] == null) delete rec[k];
    for (const k of Object.keys(rec.ret)) if (rec.ret[k] == null) delete rec.ret[k];
    items[key] = rec;
  }
  return { kind, items, rows: rows.length - 1 };
}

// A list of ASX codes: a Code (or Ticker, ASX Code, Symbol) column, with the company name alongside when there is one.
// Codes are 3 to 6 letters or digits; "ASX:CBA" and "CBA.AX" are read as CBA. At most 500 codes per file.
function parseList(rows, col) {
  const iCode = col('Code', 'ASX Code', 'Ticker', 'Symbol'); if (iCode < 0) return null;
  const iCo = col('Company', 'Company Name', 'Name', 'Security'); const codes = [], names = {};
  for (const r of rows.slice(1)) {
    const c = str(r[iCode]).toUpperCase().replace(/^ASX:/, '').replace(/\.AX$/, '');
    if (!/^[A-Z0-9]{3,6}$/.test(c) || names[c] != null) continue;
    codes.push(c); names[c] = iCo >= 0 ? str(r[iCo]) : '';
  }
  if (!codes.length) return null;
  return { kind: 'list', codes: codes.slice(0, 500), names, items: {}, rows: rows.length - 1 };
}
// "ASX_200.csv" or "ASX 200.csv" is the list "ASX 200".
const listName = (file) => String(file).replace(/\.csv$/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim() || 'List';

// Replace everything that came from `name` with the parsed contents. `modified` orders files (newest wins).
function importText(text, name, modified, spId = '') {
  const p = parseExport(text); const st = load();
  st.files = st.files.filter((f) => f.name !== name);
  const entry = { name, kind: p.kind, rows: p.rows, funds: Object.keys(p.items).length, modified: modified || new Date().toISOString(), importedAt: new Date().toISOString(), spId };
  if (p.kind === 'list') Object.assign(entry, { list: listName(name), codes: p.codes, names: p.names, count: p.codes.length, progress: { state: 'queued', done: 0, total: p.codes.length } });
  st.files.push(entry);
  st.files.sort((a, b) => String(a.modified).localeCompare(String(b.modified)));
  for (const k of Object.keys(st.items)) if (st.items[k].f === name) delete st.items[k];
  for (const [k, v] of Object.entries(p.items)) { const cur = st.items[k]; const curFile = cur && st.files.find((f) => f.name === cur.f); if (cur && curFile && String(curFile.modified) > String(modified || '')) continue; st.items[k] = { ...v, f: name }; }
  st.at = new Date().toISOString(); persist();
  return { name, kind: p.kind, rows: p.rows, funds: Object.keys(p.items).length, ...(p.kind === 'list' ? { list: entry.list, count: entry.count } : {}) };
}
// Removing a list file takes its tag off the securities it added; the securities themselves stay in the library.
function removeFile(name) {
  const st = load(); const gone = st.files.find((f) => f.name === name);
  st.files = st.files.filter((f) => f.name !== name); for (const k of Object.keys(st.items)) if (st.items[k].f === name) delete st.items[k]; persist();
  if (gone && gone.kind === 'list') untag(gone.list, () => true);
}
// Take the list tag off securities that match `drop` (a list file removed, or a code no longer in the list).
function untag(list, drop) { for (const s of D.listCol('securities')) if ((s.lists || []).includes(list) && drop(s)) { const lists = s.lists.filter((x) => x !== list); const next = { ...s, lists }; if (!lists.length) delete next.lists; D.putRecord('securities', next, 'refdata'); } }
// A list file's codes, and a place to record how adding them went (shown in Settings, Research).
function listFile(name) { return load().files.find((f) => f.name === name && f.kind === 'list') || null; }
function setProgress(name, progress) { const f = listFile(name); if (!f) return; f.progress = progress; persist(); }

// The reference row for a library ticker (VAS.AX, VAS.XA, an APIR code, MS12345).
function lookup(t) {
  const st = load(); t = String(t || '').toUpperCase(); if (!t) return null;
  if (st.items[t]) return st.items[t];
  const m = /^([A-Z0-9]+)\.(AX|XA)$/.exec(t); if (m) return st.items[m[1] + (m[2] === 'AX' ? '.XA' : '.AX')] || null;
  return null;
}
// Ticker, APIR code or name words; exact codes first, then code prefixes, then names containing every word.
function search(q, limit = 12) {
  const st = load(); q = String(q || '').trim().toLowerCase(); if (!q) return [];
  const words = q.split(/\s+/).filter(Boolean); const out = [];
  for (const r of Object.values(st.items)) {
    const code = String(r.code || '').toLowerCase(); const key = String(r.key).toLowerCase(); const nm = r.name.toLowerCase();
    let score = 0;
    if (code === q || key === q) score = 100; else if (code && code.startsWith(q)) score = 60; else if (words.every((w) => nm.includes(w))) score = 30 + (nm.startsWith(words[0]) ? 5 : 0);
    if (score) out.push([score + (r.size ? Math.min(9, Math.log10(r.size + 1) * 2) : 0), r]);
  }
  return out.sort((a, b) => b[0] - a[0]).slice(0, limit).map(([, r]) => ({ t: r.key, name: r.name, ex: r.ex, kind: r.kind === 'etf' ? 'ETF' : 'Managed fund', fee: r.fee ?? null, cat: r.cat || '', ref: true }));
}
function status() { const st = load(); return { files: st.files.map(({ codes, names, ...f }) => f), funds: Object.keys(st.items).length, at: st.at, folder: FOLDER_NAME }; }

// The `ms` block stored on a library security, plus its fee (unless someone set the fee by hand in the app).
function msBlock(r, fileModified) { const b = { cat: r.cat, medal: r.medal, medalAt: r.medalAt, stars: r.stars, risk: r.risk, sd3: r.sd3, sharpe3: r.sharpe3, alpha3: r.alpha3, beta3: r.beta3, r2: r.r2, y10: r.ret && r.ret.y10, size: r.size, esg: r.esg, style: r.style, credit: r.credit, dur: r.dur, tenure: r.tenure, fee: r.fee, icr: r.icr, file: r.f, asOf: String(fileModified || '').slice(0, 10) }; for (const k of Object.keys(b)) if (b[k] == null || b[k] === '') delete b[k]; return b; }
function enrich(s) {
  const r = lookup(s.t); const next = { ...s };
  if (!r) { if (next.ms) delete next.ms; if (next.merSrc === 'morningstar') { next.mer = null; delete next.merSrc; } return next; }
  const f = load().files.find((x) => x.name === r.f);
  next.ms = msBlock(r, f && f.modified);
  const fee = r.fee ?? r.icr;
  if (fee != null && next.merSrc !== 'manual') { next.mer = fee; next.merSrc = 'morningstar'; }
  if (!next.cls && r.cls) next.cls = r.cls;
  // Unlisted funds have no market price: their returns and risk come from the export.
  if (next.provider === 'reference') {
    next.name = r.name; next.ex = r.ex; if (!next.kind) next.kind = r.kind === 'etf' ? 'ETF' : 'Managed fund';
    next.ret = { m1: r.ret.m1 ?? null, m3: r.ret.m3 ?? null, y1: r.ret.y1 ?? null, y3: r.ret.y3 ?? null, y5: r.ret.y5 ?? null };
    next.vol = r.sd3 ?? null; next.src = 'Morningstar export'; next.asOf = f && f.modified ? String(f.modified).slice(0, 10) : next.asOf;
    if (r.beta3 != null && next.beta == null) next.beta = r.beta3;
  }
  return next;
}
// Rewrite every library security whose reference data changed. Returns how many changed.
function applyToLibrary() {
  let n = 0;
  for (const s of D.listCol('securities')) { const next = enrich(s); if (JSON.stringify(next) !== JSON.stringify(s)) { D.putRecord('securities', next, 'refdata'); n++; } }
  return n;
}
// A library record for a fund only the export can price: an unlisted fund (APIR code or MS number), or an ETF the
// market data provider does not cover. Keeps the fields people edit (class, fee set by hand, note, description).
function fundRecord(key, prev) {
  const r = lookup(key) || load().items[String(key || '').toUpperCase()]; if (!r) return null;
  const base = { t: r.key, name: r.name, kind: r.kind === 'etf' ? 'ETF' : 'Managed fund', cls: r.cls || 'Multi‑asset', ex: r.ex, ccy: r.ccy || 'AUD', price: r.kind === 'etf' ? (r.price ?? null) : null, chg: null, w52: [null, null], mcap: r.size != null ? 'A$' + (r.size >= 1000 ? (r.size / 1000).toFixed(1) + 'b' : Math.round(r.size) + 'm') : '', pe: null, yld: null, frank: null, provider: 'reference', added: D.today(), ret: {} };
  const keep = prev ? Object.fromEntries(['cls', 'kind', 'sector', 'frank', 'desc', 'note', 'noteBy', 'noteAt', 'added', ...(prev.merSrc === 'manual' ? ['mer', 'merSrc'] : [])].filter((k) => prev[k] != null && prev[k] !== '').map((k) => [k, prev[k]])) : {};
  return enrich({ ...base, ...keep, provider: 'reference' });
}
// SharePoint: every CSV in <SP_FOLDER>/Research/Reference data. Re-imports files whose modified time changed and
// drops files that were deleted there. Returns { imported, removed, errors }.
async function syncFromSharePoint(graph) {
  if (!graph.enabled()) return { imported: [], removed: [], errors: ['SharePoint is not configured on the server'] };
  const folder = [graph.SP_FOLDER, FOLDER_NAME].filter(Boolean).join('/');
  const list = (await graph.listFolder(folder)).filter((f) => !f.folder && /\.csv$/i.test(f.name));
  const st = load(); const imported = [], removed = [], errors = [];
  for (const f of list) {
    const have = st.files.find((x) => x.name === f.name);
    if (have && have.modified === f.modified) continue;
    try { const buf = await graph.download(f.spId); const r = importText(buf.toString('utf8'), f.name, f.modified, f.spId); imported.push(r); } catch (e) { errors.push(`${f.name}: ${e.message}`); }
  }
  for (const f of st.files.slice()) if (f.spId && !list.some((x) => x.name === f.name)) { removeFile(f.name); removed.push(f.name); }
  if (imported.length || removed.length) applyToLibrary();
  // Company lists are added in the background (a few seconds per company). Loaded here to avoid a require cycle.
  for (const r of imported) if (r.kind === 'list') require('./market').startList(r.name, 'refdata');
  return { imported, removed, errors };
}
module.exports = { parseCsv, parseExport, importText, removeFile, listFile, setProgress, untag, listName, lookup, search, status, enrich, applyToLibrary, fundRecord, syncFromSharePoint, clsOf, FOLDER_NAME };
