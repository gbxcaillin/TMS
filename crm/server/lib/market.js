'use strict';
// Market data via yahoo-finance2 (free, delayed). Results are cached in SQLite so a provider
// hiccup never blanks the research section.
//
// The research library is the `securities` collection (id = ticker). Records are built here from three Yahoo calls
// (quote, daily chart with dividends, quoteSummary profile) so every field the app shows is either a number or
// null, never a blank string. Fields a person can correct on the security page (asset class, type, sector, fee,
// franking, description) are only filled when empty, so a refresh never overwrites someone's edit.
const D = require('./db');
const refdata = require('./refdata');
let yf = null;
async function yahoo() { if (!yf) { const { default: YahooFinance } = await import('yahoo-finance2'); yf = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] }); } return yf; }
const QUOTE_TTL = 15 * 60e3, HIST_TTL = 12 * 3600e3, PROFILE_TTL = 7 * 86400e3;
const r2 = (n, d = 2) => (n == null || !isFinite(n) ? null : +(+n).toFixed(d));
const fmtCap = (n, ccy) => { if (!n) return ''; const p = ccy === 'USD' ? 'US$' : ccy === 'AUD' ? 'A$' : (ccy || '') + ' '; return n >= 1e12 ? p + (n / 1e12).toFixed(2) + 't' : n >= 1e9 ? p + (n / 1e9).toFixed(1) + 'b' : n >= 1e6 ? p + (n / 1e6).toFixed(0) + 'm' : p + Math.round(n); };
const KIND = { ETF: 'ETF', MUTUALFUND: 'Managed fund', INDEX: 'Index', EQUITY: 'Share', CURRENCY: 'FX', CRYPTOCURRENCY: 'Crypto' };
// Yahoo's `dividendYield` on quote() is already a percentage (0.32 means 0.32%); the trailing yield is a fraction.
const yieldPct = (q) => (q.dividendYield != null ? r2(q.dividendYield) : q.trailingAnnualDividendYield != null ? r2(q.trailingAnnualDividendYield * 100) : null);

async function quote(sym) {
  const key = 'q2:' + sym;
  const c = D.cache.get(key, QUOTE_TTL); if (c) return c;
  try {
    const q = await (await yahoo()).quote(sym);
    if (!q || q.regularMarketPrice == null) return D.cache.get(key) || null;
    const out = { t: q.symbol || sym, name: q.longName || q.shortName || sym, price: q.regularMarketPrice, chg: q.regularMarketChangePercent != null ? r2(q.regularMarketChangePercent) : 0, ccy: q.currency || 'AUD', ex: q.fullExchangeName || q.exchange || '', mcap: fmtCap(q.marketCap || q.netAssets, q.currency), pe: q.trailingPE ? r2(q.trailingPE, 1) : null, yld: yieldPct(q), mer: q.netExpenseRatio != null ? r2(q.netExpenseRatio) : null, w52: [r2(q.fiftyTwoWeekLow), r2(q.fiftyTwoWeekHigh)], kind: KIND[q.quoteType] || 'Share', qtype: q.quoteType || '', asOf: q.regularMarketTime ? new Date(q.regularMarketTime).toISOString() : new Date().toISOString(), src: 'Yahoo Finance' };
    D.cache.set(key, out); return out;
  } catch (e) { console.error('[market] quote', sym, e.message); return D.cache.get(key) || null; }
}
async function quotes(syms) { const out = []; for (const s of syms) { const q = await quote(s); if (q) out.push(q); } return out; }

// Daily closes for up to 5 years with dividends, plus derived return/vol/drawdown stats.
async function history(sym, years = 5) {
  const key = `h2:${sym}:${years}`;
  const c = D.cache.get(key, HIST_TTL); if (c) return c;
  try {
    const p1 = new Date(); p1.setFullYear(p1.getFullYear() - years);
    const r = await (await yahoo()).chart(sym, { period1: p1, interval: '1d', events: 'div' });
    const pts = (r.quotes || []).filter((x) => x.close != null).map((x) => ({ d: new Date(x.date).toISOString().slice(0, 10), c: +x.close.toFixed(4), a: x.adjclose != null ? +x.adjclose.toFixed(4) : null }));
    const divs = ((r.events && r.events.dividends) || []).map((x) => ({ d: new Date(x.date).toISOString().slice(0, 10), amt: +(+x.amount).toFixed(4) })).sort((a, b) => b.d.localeCompare(a.d));
    const out = { t: sym, pts, divs, stats: stats(pts), asOf: new Date().toISOString() };
    D.cache.set(key, out); return out;
  } catch (e) { console.error('[market] history', sym, e.message); return D.cache.get(key) || null; }
}
function stats(pts) {
  if (pts.length < 30) return null;
  const px = pts.map((p) => p.a ?? p.c); const last = px[px.length - 1];
  const back = (days) => { const i = Math.max(0, px.length - 1 - days); return (last / px[i] - 1) * 100; };
  const yrs = (px.length - 1) / 252;
  // Annualised over n years, or over the history there is when it is shorter (null under a year).
  const cagr = (n) => { if (yrs < Math.min(n, 1)) return null; const i = Math.max(0, px.length - 1 - n * 252); const y = Math.min(n, yrs); return (Math.pow(last / px[i], 1 / y) - 1) * 100; };
  const rets = []; for (let i = 1; i < px.length; i++) rets.push(Math.log(px[i] / px[i - 1]));
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length; const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length) * Math.sqrt(252) * 100;
  let peak = px[0], mdd = 0; for (const v of px) { if (v > peak) peak = v; mdd = Math.min(mdd, (v / peak - 1) * 100); }
  return { m1: r2(back(21), 1), m3: r2(back(63), 1), y1: yrs >= 0.9 ? r2(back(252), 1) : null, y3: r2(cagr(3), 1), y5: r2(cagr(5), 1), vol: r2(sd, 1), mdd: r2(mdd, 1), years: r2(yrs, 1) };
}
// Company or fund profile: description, sector, beta, fee. Cached for a week; best effort.
async function profile(sym) {
  const key = 'p:' + sym;
  const c = D.cache.get(key, PROFILE_TTL); if (c) return c;
  try {
    const r = await (await yahoo()).quoteSummary(sym, { modules: ['assetProfile', 'summaryDetail', 'defaultKeyStatistics', 'fundProfile'] });
    const ap = r.assetProfile || {}, sd = r.summaryDetail || {}, ks = r.defaultKeyStatistics || {}, fp = r.fundProfile || {};
    const fe = fp.feesExpensesInvestment || {};
    const out = { desc: String(ap.longBusinessSummary || '').trim().slice(0, 1500), sector: ap.sector || '', beta: r2(sd.beta ?? ks.beta ?? ks.beta3Year), mer: fe.annualReportExpenseRatio != null ? r2(fe.annualReportExpenseRatio * 100) : null, family: fp.family || '' };
    D.cache.set(key, out); return out;
  } catch (e) { console.error('[market] profile', sym, e.message); return D.cache.get(key) || { desc: '', sector: '', beta: null, mer: null, family: '' }; }
}
async function search(q) {
  q = String(q || '').trim(); if (!q) return [];
  try { const r = await (await yahoo()).search(q, { quotesCount: 10, newsCount: 0 }); return (r.quotes || []).filter((x) => x.symbol && x.isYahooFinance !== false).map((x) => ({ t: x.symbol, name: x.longname || x.shortname || x.symbol, ex: x.exchDisp || x.exchange || '', kind: KIND[x.quoteType] || x.quoteType || '' })); }
  catch (e) { console.error('[market] search', e.message); return []; }
}
// US dollars per Australian dollar (Yahoo's AUDUSD=X). AUD=X is the other way round, USD priced in AUD.
async function fx() { const q = await quote('AUDUSD=X'); return q ? { pair: 'AUDUSD', rate: q.price, asOf: q.asOf } : null; }

// First guess at the asset class for a new security; the security page lets a person change it.
function classify(q) {
  const n = String(q.name || ''); const asx = /\.AX$/.test(q.t);
  if (q.kind === 'Index') return /ASX|australia/i.test(n) ? 'Australian equities' : 'International equities';
  if (/property|reit|infrastructure/i.test(n)) return 'Property & infrastructure';
  if (/\b(bond|fixed|treasury|credit|income|government|hybrid|loan)s?\b/i.test(n) && !/equity income|dividend/i.test(n)) return 'Fixed interest';
  if (/\bcash\b|high interest|money market|savings/i.test(n)) return 'Cash';
  if (/diversified|balanced|conservative|multi.?asset|high growth/i.test(n)) return 'Multi‑asset';
  if (!asx) return 'International equities';
  if (q.kind === 'ETF' && (/international|global|world|msci|s&p 500|nasdaq|emerging|asia|europe|japan|china|india|ex.?australia|hedged|america/i.test(n) || /\bU\.?S\.?\b/.test(n))) return 'International equities';
  return 'Australian equities';
}
// A complete library record for a ticker, merged over the existing record (if any). Null when Yahoo has no quote.
async function buildSecurity(sym, prev) {
  const q = await quote(sym); if (!q) return null;
  const [h, p] = [await history(q.t, 5), await profile(q.t)];
  const ref = refdata.lookup(q.t);
  const s = prev ? { ...prev } : { t: q.t, cls: (ref && ref.cls) || classify(q), kind: q.kind, frank: /\.AX$/.test(q.t) ? null : 0, added: D.today() };
  const fill = (k, v) => { if ((s[k] == null || s[k] === '') && v != null && v !== '') s[k] = v; };
  Object.assign(s, { name: q.name, ex: q.ex, ccy: q.ccy, price: q.price, chg: q.chg, w52: q.w52[0] != null ? q.w52 : (s.w52 || [null, null]), mcap: q.mcap || s.mcap || '', pe: q.pe, yld: q.yld ?? s.yld ?? null, src: 'Yahoo Finance', asOf: q.asOf, provider: 'yahoo' });
  fill('mer', q.mer ?? p.mer); fill('beta', p.beta); fill('sector', p.sector); fill('desc', p.desc); fill('family', p.family);
  if (h && h.stats) { s.ret = { m1: h.stats.m1, m3: h.stats.m3, y1: h.stats.y1, y3: h.stats.y3, y5: h.stats.y5 }; s.vol = h.stats.vol; s.mdd = h.stats.mdd; s.years = h.stats.years; }
  else if (!s.ret) { s.ret = { m1: null, m3: null, y1: null, y3: null, y5: null }; s.vol = null; s.mdd = null; }
  if (h && h.divs) s.divs = h.divs.slice(0, 8);
  // Blank strings from older lookups become nulls so the page never tries to format them.
  for (const k of ['mer', 'beta', 'pe', 'hold', 'yld', 'frank']) if (s[k] === '') s[k] = null;
  // Fees, ratings and risk from the Morningstar reference data, when the fund is in it.
  return refdata.enrich(s);
}
// A rebuilt record is written over the record as it is now, changing only the fields the rebuild changed: fetching
// prices takes seconds, and someone may have saved a note, a fee or a sign-off on the same security meanwhile.
function writeRebuilt(before, next, by) {
  const fresh = D.getRecord('securities', before.t); if (!fresh) return false;
  const out = { ...fresh }; let changed = false;
  for (const k of new Set([...Object.keys(next), ...Object.keys(before)])) if (JSON.stringify(next[k]) !== JSON.stringify(before[k])) { out[k] = next[k]; changed = true; }
  if (!changed || JSON.stringify(out) === JSON.stringify(fresh)) return false;
  D.putRecord('securities', out, by); return true;
}
// Add (or re-fetch) one ticker in the library. Returns the record, or null when Yahoo does not know it.
async function addSecurity(sym, by = 'market') {
  sym = String(sym || '').trim().toUpperCase(); if (!sym) return null;
  const prev = D.getRecord('securities', sym);
  // Unlisted funds (APIR codes, Morningstar numbers) have no market price: their record comes from the reference data.
  if (/^[A-Z]{3}\d{4}AU$|^MS\d+$/.test(sym) || (prev && prev.provider === 'reference')) { const f = refdata.fundRecord(sym, prev); if (!f) return null; D.putRecord('securities', f, by); return f; }
  let s = await buildSecurity(sym, prev);
  if (!s) { const f = refdata.fundRecord(sym, prev); if (!f) return null; s = f; }
  if (s.t !== sym && D.getRecord('securities', s.t)) return D.getRecord('securities', s.t);
  if (prev && s.t === prev.t) { writeRebuilt(prev, s, by); return D.getRecord('securities', s.t); }
  D.putRecord('securities', s, by); return s;
}

// The starter library: the ASX building blocks the BD starter models are made of, plus a few direct shares and the
// Vanguard diversified ETFs the models use as benchmarks. Classes are fixed here rather than guessed.
const STARTER = [
  ['VAS.AX', 'Australian equities'], ['VGS.AX', 'International equities'], ['NDQ.AX', 'International equities'], ['VAP.AX', 'Property & infrastructure'],
  ['VAF.AX', 'Fixed interest'], ['VGB.AX', 'Fixed interest'], ['AAA.AX', 'Cash'], ['CBA.AX', 'Australian equities'], ['BHP.AX', 'Australian equities'], ['CSL.AX', 'Australian equities'],
  ['VDCO.AX', 'Multi‑asset'], ['VDBA.AX', 'Multi‑asset'], ['VDGR.AX', 'Multi‑asset'], ['VDHG.AX', 'Multi‑asset'],
  ['^AXJO', 'Australian equities'],
];
// The largest companies in the S&P/ASX 200 by index weight, biggest first; the first 20 are the ASX 20. A fixed list
// because Yahoo has no constituent feed and its market caps are missing or global for several large names (NAB, ANZ,
// Macquarie; Newmont, ResMed). Review it when the index rebalances; shares already in a library are left alone.
const ASX_TOP = ['CBA', 'BHP', 'CSL', 'NAB', 'WBC', 'ANZ', 'MQG', 'WES', 'GMG', 'WDS', 'RIO', 'TLS', 'FMG', 'WOW', 'TCL', 'ALL', 'QBE', 'NST', 'COL', 'REA',
  'SIG', 'EVN', 'BXB', 'SUN', 'ORG', 'S32', 'JHX', 'SOL', 'SCG', 'PME', 'XRO', 'WTC', 'RMD', 'CPU', 'IAG', 'STO', 'APA', 'QAN', 'MPL', 'ASX', 'COH', 'SHL', 'RHC', 'VCX', 'SGP', 'ALQ', 'LYC', 'PLS', 'TNE', 'CAR'];
// Property trusts and listed infrastructure among them sit in the property & infrastructure sleeve.
const PROPERTY = new Set(['GMG', 'SCG', 'VCX', 'SGP', 'TCL', 'APA']);
const asxRank = (t) => { const i = ASX_TOP.indexOf(String(t).replace(/\.AX$/, '')); return i < 0 ? null : i + 1; };
// Add the top n (20 or 50) as shares. Returns { added, failed, existing }.
async function addTopAsx(n = 20, by = 'market') {
  const added = [], failed = [], existing = [];
  for (const code of ASX_TOP.slice(0, Math.min(50, Math.max(1, n)))) {
    const t = code + '.AX'; const prev = D.getRecord('securities', t);
    if (prev) { if (!prev.asxRank) D.putRecord('securities', { ...prev, asxRank: asxRank(t) }, by); existing.push(t); continue; }
    const s = await buildSecurity(t, null).catch(() => null);
    if (!s) { failed.push(t); continue; }
    s.cls = PROPERTY.has(code) || s.sector === 'Real Estate' ? 'Property & infrastructure' : 'Australian equities'; s.kind = 'Share'; s.asxRank = asxRank(t); if (FRANK[t] != null) s.frank = FRANK[t];
    D.putRecord('securities', s, by); added.push(t);
  }
  return { added, failed, existing };
}
// Runs in the background (fetching 50 companies takes a minute or two); new shares reach browsers through live sync.
let topRun = null;
function startTopAsx(n, by) { if (topRun) return { running: true }; topRun = addTopAsx(n, by).catch((e) => { console.error('[market] top ASX', e.message); return null; }).finally(() => { topRun = null; }); return { started: true, n }; }
// A company list uploaded in Settings (lib/refdata.js): each code is added as a security tagged with the list's name,
// codes already in the library just gain the tag, and the tag comes off securities whose code has left the list.
// Codes Yahoo no longer knows (delisted, taken over) are reported, as are codes that now belong to a different
// company than the one the file names (ASX codes are reused, so an old list can point at an unrelated small cap).
const STOP = new Set(['limited', 'ltd', 'the', 'group', 'holdings', 'holding', 'corporation', 'corp', 'company', 'co', 'inc', 'plc', 'nl', 'of', 'and', 'australia', 'australian', 'trust', 'fund', 'etf', 'stapled', 'units', 'fpo', 'reit', 'property', 'properties', 'resources', 'energy', 'mining', 'minerals', 'international', 'global']);
const words = (n) => String(n || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w));
// Renamed companies keep their code, and the new name often is the code ("ANZ Group Holdings", "CAR Group").
function sameCompany(listed, yahooName, code = '') {
  const a = words(listed), b = words(yahooName); if (!a.length || !b.length) return true;
  if (code && b.includes(String(code).toLowerCase())) return true;
  return a.some((w) => b.some((x) => x === w || (w.length >= 4 && x.length >= 4 && (x.startsWith(w.slice(0, 4)) || w.startsWith(x.slice(0, 4))))));
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function addList(file, by = 'market', gap = 250) {
  const f = refdata.listFile(file); if (!f) return null;
  const { list, codes, names = {} } = f; const total = codes.length;
  const tickers = new Set(codes.map((c) => c + '.AX'));
  refdata.untag(list, (s) => !tickers.has(s.t));
  const added = [], existing = [], missing = [], other = []; let done = 0;
  const note = (state) => refdata.setProgress(file, { state, done, total, added: added.length, existing: existing.length, missing, other, at: D.nowIso() });
  note('running');
  for (const code of codes) {
    const t = code + '.AX'; const prev = D.getRecord('securities', t);
    if (prev) {
      const lists = (prev.lists || []).includes(list) ? prev.lists : [...(prev.lists || []), list];
      if (lists !== prev.lists || (!prev.asxRank && asxRank(t))) D.putRecord('securities', { ...prev, lists, ...(asxRank(t) ? { asxRank: asxRank(t) } : {}) }, by);
      existing.push(t);
    } else {
      const s = await buildSecurity(t, null).catch(() => null);
      if (!s || s.t !== t) missing.push(code);
      else if (!sameCompany(names[code], s.name, code)) other.push({ code, listed: names[code], now: s.name });
      else {
        if (s.kind === 'Share') s.cls = PROPERTY.has(code) || s.sector === 'Real Estate' ? 'Property & infrastructure' : 'Australian equities';
        if (asxRank(t)) s.asxRank = asxRank(t); if (FRANK[t] != null) s.frank = FRANK[t]; s.lists = [list];
        if (!D.getRecord('securities', t)) { D.putRecord('securities', s, by); added.push(t); } else existing.push(t);
      }
      await pause(gap);
    }
    done++; if (done % 10 === 0) note('running');
  }
  note('done');
  return { added, existing, missing, other };
}
// One list at a time, in the order they arrive; an upload of the same file while it runs is picked up after.
const listQueue = []; let listRun = null;
function startList(file, by = 'market') {
  if (!listQueue.includes(file)) listQueue.push(file);
  if (!listRun) listRun = (async () => { while (listQueue.length) { const f = listQueue.shift(); await addList(f, by).catch((e) => { console.error('[market] list', f, e.message); refdata.setProgress(f, { state: 'failed', error: e.message }); }); } })().finally(() => { listRun = null; });
  return { started: true };
}
const listBusy = () => listRun;
// Market indices kept in every library as reference points and chart benchmarks (added once to existing libraries).
const INDICES = ['^AXJO'];
const DESC = { '^AXJO': 'The S&P/ASX 200: the 200 largest companies listed on the ASX by float-adjusted market capitalisation, and the main benchmark for Australian shares. This is the price index, so its returns exclude dividends; with franked dividends reinvested the ASX 200 has returned roughly 4 percentage points a year more.' };
const FRANK = { 'CBA.AX': 100, 'BHP.AX': 100, 'CSL.AX': 0, 'VAS.AX': 75, 'VAP.AX': 5 };
async function addStarter(by = 'market') {
  const added = [], failed = [];
  for (const [t, cls] of STARTER) {
    if (D.getRecord('securities', t)) continue;
    const s = await buildSecurity(t, null).catch(() => null);
    if (!s) { failed.push(t); continue; }
    s.cls = cls; if (FRANK[t] != null) s.frank = FRANK[t]; if (DESC[t] && !s.desc) s.desc = DESC[t];
    D.putRecord('securities', s, by); added.push(t);
  }
  const st = D.kvGet('settings'); if (st) { st.research = { ...(st.research || {}), starterAt: D.nowIso() }; D.kvSet('settings', st); }
  return { added, failed };
}

// Refresh stored securities so every client sees the same prices via sync. A brand-new (empty) library is filled
// with the starter set once; after that an empty library stays empty.
async function refreshSecurities() {
  let st = D.kvGet('settings') || null;
  if (st && !(st.research || {}).starterAt && !D.listCol('securities').length) await addStarter();
  // Once per library: add the market indices (a library set up before they were part of the starter set).
  st = D.kvGet('settings');
  if (st && !(st.research || {}).indicesAt) {
    for (const t of INDICES) if (!D.getRecord('securities', t)) { const s = await addSecurity(t, 'market').catch(() => null); if (s && DESC[t] && !s.desc) D.putRecord('securities', { ...s, desc: DESC[t] }, 'market'); }
    const cur = D.kvGet('settings') || st; cur.research = { ...(cur.research || {}), indicesAt: D.nowIso() }; D.kvSet('settings', cur);
  }
  // Once per library: the ASX 20 as individual shares.
  st = D.kvGet('settings');
  if (st && !(st.research || {}).topAsxAt) {
    await addTopAsx(20, 'market').catch(() => null);
    const cur = D.kvGet('settings') || st; cur.research = { ...(cur.research || {}), topAsxAt: D.nowIso() }; D.kvSet('settings', cur);
  }
  const secs = D.listCol('securities'); let n = 0, failed = 0;
  for (const s of secs) {
    if (s.provider === 'manual' || s.provider === 'reference') continue;
    const next = await buildSecurity(s.t, s).catch(() => null);
    if (!next) { failed++; continue; }
    if (writeRebuilt(s, next, 'market')) n++;
  }
  st = D.kvGet('settings');
  if (st) { const f = await fx(); st.research = { ...(st.research || {}), lastRefresh: D.nowIso(), lastResult: { updated: n, failed, total: secs.length }, fx: f ? `A$1 = US$${f.rate.toFixed(4)}` : (st.research || {}).fx }; D.kvSet('settings', st); }
  return n;
}

// Month-end prices keyed YYYY-MM (last close in each month), so holdings on different exchanges line up by date.
function monthly(pts) { const m = new Map(); for (const p of pts) m.set(p.d.slice(0, 7), p.a ?? p.c); return m; }
// Growth of $100 for a weighted basket, rebalanced to target monthly, over the months every holding has a price for
// (up to five years), plus the stats that series implies. `bench` is an optional ticker drawn alongside.
async function portfolio(holdings, bench) {
  const hs = (holdings || []).filter((h) => h && h.t && +h.w > 0);
  if (!hs.length) return { ok: false, reason: 'No holdings with a weight' };
  const series = []; const missing = [];
  for (const h of hs) { const x = await history(h.t, 5).catch(() => null); if (!x || !x.pts || x.pts.length < 60) { missing.push(h.t); continue; } series.push({ t: h.t, w: +h.w, m: monthly(x.pts) }); }
  if (!series.length) return { ok: false, reason: 'No price history for these holdings', missing };
  let months = [...series[0].m.keys()].filter((k) => series.every((s) => s.m.has(k))).sort().slice(-61);
  let bm = null; if (bench) { const b = await history(bench, 5).catch(() => null); if (b && b.pts && b.pts.length > 60) { bm = monthly(b.pts); const keep = months.filter((k) => bm.has(k)); if (keep.length >= 3) months = keep; else bm = null; } }
  if (months.length < 3) return { ok: false, reason: 'Not enough shared history', missing };
  const tw = series.reduce((a, s) => a + s.w, 0);
  const model = [100]; for (let i = 1; i < months.length; i++) { const r = series.reduce((a, s) => a + (s.w / tw) * (s.m.get(months[i]) / s.m.get(months[i - 1]) - 1), 0); model.push(model[i - 1] * (1 + r)); }
  const benchPts = bm ? months.map((k) => (bm.get(k) / bm.get(months[0])) * 100) : null;
  return { ok: true, months, model: model.map((v) => r2(v)), bench: benchPts && benchPts.map((v) => r2(v)), benchT: bm ? bench : '', stats: seriesStats(model), missing, covered: r2(series.reduce((a, s) => a + s.w, 0) / (hs.reduce((a, h) => a + +h.w, 0) || 1), 3) };
}
function seriesStats(v) {
  const n = v.length - 1; const last = v[n];
  const ann = (k) => (n >= k ? (Math.pow(last / v[n - k], 12 / k) - 1) * 100 : null);
  const rets = []; for (let i = 1; i < v.length; i++) rets.push(v[i] / v[i - 1] - 1);
  const mean = rets.reduce((a, b) => a + b, 0) / (rets.length || 1); const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length || 1)) * Math.sqrt(12) * 100;
  let peak = v[0], mdd = 0; for (const x of v) { if (x > peak) peak = x; mdd = Math.min(mdd, (x / peak - 1) * 100); }
  return { y1: r2(n >= 12 ? (last / v[n - 12] - 1) * 100 : null, 1), y3: r2(ann(36), 1), y5: r2(ann(60), 1), vol: r2(sd, 1), mdd: r2(mdd, 1), years: r2(n / 12, 1) };
}
module.exports = { quote, quotes, history, profile, search, fx, classify, buildSecurity, addSecurity, addStarter, addTopAsx, startTopAsx, asxRank, addList, startList, listBusy, sameCompany, refreshSecurities, portfolio, STARTER, INDICES, ASX_TOP };
