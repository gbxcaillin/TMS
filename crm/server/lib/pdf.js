'use strict';
// Tiny dependency-free PDF writer: one-page tax invoices, security fact sheets and model portfolio client packs. Uses the three
// built-in PDF standard fonts (Helvetica, Helvetica-Bold, Courier) so nothing is embedded.
// A4 in points (72/inch): 595.28 x 841.89. Origin is bottom-left.
const PAGE_W = 595.28, PAGE_H = 841.89, M = 50;

// PDF text is Latin-1-ish with these standard fonts; transliterate common typographic
// characters to ASCII and drop anything else so the output never mis-renders.
function ascii(s) {
  return String(s == null ? '' : s)
    .replace(/[‐-―−]/g, '-').replace(/[·•]/g, '-')
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/…/g, '...').replace(/ /g, ' ')
    .replace(/[^\x20-\x7e]/g, '');
}
const esc = (s) => ascii(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
const fmtMoney = (n) => 'A$' + (Math.round((+n || 0) * 100) / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (iso) => { const d = new Date(String(iso).slice(0, 10) + 'T00:00:00'); return isNaN(d) ? String(iso || '') : d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' }); };

// Builder: accumulate content-stream operators; y arguments are measured from the page top.
function builder() {
  const ops = [];
  const yy = (top) => (PAGE_H - top).toFixed(2);
  const F = { reg: 'F1', bold: 'F2', mono: 'F3' };
  return {
    ops,
    text(x, top, str, { font = F.reg, size = 10, color } = {}) {
      if (color) ops.push(`${color} rg`);
      ops.push(`BT /${font} ${size} Tf ${x.toFixed(2)} ${yy(top)} Td (${esc(str)}) Tj ET`);
      if (color) ops.push('0 0 0 rg');
    },
    // Right-align using Courier's fixed 0.6em advance (only used for numeric columns).
    rightMono(xRight, top, str, size = 10) {
      const w = ascii(str).length * size * 0.6;
      this.text(xRight - w, top, str, { font: F.mono, size });
    },
    line(x1, top1, x2, top2, w = 0.7, gray) {
      ops.push(`${w} w`); if (gray != null) ops.push(`${gray} G`);
      ops.push(`${x1.toFixed(2)} ${yy(top1)} m ${x2.toFixed(2)} ${yy(top2)} l S`);
      if (gray != null) ops.push('0 G');
    },
    rect(x, top, w, h, gray) { ops.push(`${gray} rg ${x.toFixed(2)} ${yy(top + h)} ${w.toFixed(2)} ${h.toFixed(2)} re f 0 0 0 rg`); },
    // The approved logo (embedded JPEG XObject /Im1), drawn w x h points with its top-left at (x, top).
    image(x, top, w, h) { ops.push(`q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${yy(top + h)} cm /Im1 Do Q`); },
    polyline(pts, rgb = '0.1 0.36 0.29', w = 1.4) {
      if (pts.length < 2) return;
      ops.push(`q ${rgb} RG ${w} w 1 J 1 j ${pts[0][0].toFixed(2)} ${yy(pts[0][1])} m ${pts.slice(1).map(([x, t]) => `${x.toFixed(2)} ${yy(t)} l`).join(' ')} S Q`);
    },
    // Word-wrapped paragraph; returns the top after the last line. Helvetica averages ~0.5em per character.
    para(x, top, str, { size = 9, color = '0.3 0.3 0.28', width = PAGE_W - 2 * M, lead = 1.35 } = {}) {
      const max = Math.max(20, Math.floor(width / (size * 0.5)));
      let y = top;
      for (const raw of ascii(str).split('\n')) {
        const words = raw.split(/\s+/).filter(Boolean); let line = '';
        const flush = () => { if (line) { this.text(x, y, line, { font: F.reg, size, color }); y += size * lead; line = ''; } };
        for (const w of words) { if ((line + ' ' + w).trim().length > max) flush(); line = (line + ' ' + w).trim(); }
        flush(); if (!words.length) y += size * lead * 0.6;
      }
      return y;
    },
    build() { return ops.join('\n'); },
  };
}
const LOGO = (() => { try { return require('node:fs').readFileSync(require('node:path').join(__dirname, 'logo-light.jpg')); } catch (_) { return null; } })();
// Shared page header: the approved logo, the document type on the right, and a rule. Returns the next top.
function header(b, kind, sub) {
  const rightX = PAGE_W - M;
  if (LOGO) b.image(M, M - 6, 46, 46); else b.text(M, M + 10, 'Brightday', { font: 'F2', size: 12 });
  b.text(rightX - 200, M + 8, kind, { font: 'F2', size: 13 });
  if (sub) b.text(rightX - 200, M + 22, ascii(sub), { font: 'F1', size: 8.5, color: '0.42 0.42 0.4' });
  b.line(M, M + 48, rightX, M + 48, 0.6, 0.8);
  return M + 66;
}
// A small line chart: series = [{ pts: [numbers], rgb }], labels = { left, right } for the x axis. Returns the top below it.
function chart(b, x, top, w, h, series, labels = {}) {
  const all = series.flatMap((s) => s.pts).filter((v) => Number.isFinite(v));
  if (all.length < 2) return top;
  const lo = Math.min(...all), hi = Math.max(...all), span = hi - lo || 1;
  b.rect(x, top, w, h, '0.975 0.97 0.95');
  for (let i = 0; i <= 4; i++) { const gy = top + (h * i) / 4; b.line(x, gy, x + w, gy, 0.3, 0.86); }
  b.text(x + w + 4, top + 3, (labels.fmt || ((v) => v.toFixed(0)))(hi), { font: 'F3', size: 7, color: '0.45 0.45 0.43' });
  b.text(x + w + 4, top + h + 2, (labels.fmt || ((v) => v.toFixed(0)))(lo), { font: 'F3', size: 7, color: '0.45 0.45 0.43' });
  for (const s of series) {
    const n = s.pts.length; if (n < 2) continue;
    b.polyline(s.pts.map((v, i) => [x + (w * i) / (n - 1), top + h - ((v - lo) / span) * h]), s.rgb || '0.1 0.36 0.29', s.w || 1.3);
  }
  if (labels.left) b.text(x, top + h + 11, ascii(labels.left), { font: 'F1', size: 7.5, color: '0.45 0.45 0.43' });
  if (labels.right) b.text(x + w - 60, top + h + 11, ascii(labels.right), { font: 'F1', size: 7.5, color: '0.45 0.45 0.43' });
  return top + h + 20;
}
const GENERAL_ADVICE = 'General information only. This document has been prepared without taking into account your objectives, financial situation or needs. It is not personal financial advice and is not a recommendation to buy, sell or hold any security. Past performance is not a reliable indicator of future performance. Consider the relevant PDS and TMD, and seek advice from a licensed financial adviser before acting.';
function footer(b, top, opts = {}) {
  const rightX = PAGE_W - M;
  let y = Math.max(top, PAGE_H - 118);
  b.line(M, y, rightX, y, 0.5, 0.85); y += 12;
  if (opts.disclaimer !== false) { b.text(M, y, 'IMPORTANT', { font: 'F2', size: 7.5, color: '0.42 0.42 0.4' }); y += 10; y = b.para(M, y, GENERAL_ADVICE, { size: 7.5, color: '0.42 0.42 0.4', lead: 1.3 }); }
  b.text(M, PAGE_H - M + 14, ascii([opts.entity || 'Brightday', opts.abn ? 'ABN ' + opts.abn : '', 'brightday.com.au'].filter(Boolean).join('  -  ')), { font: 'F1', size: 7.5, color: '0.5 0.5 0.48' });
  b.text(rightX - 170, PAGE_H - M + 14, ascii('Prepared ' + fmtDate(opts.asOf || new Date().toISOString()) + (opts.source ? ' - data: ' + opts.source : '')), { font: 'F1', size: 7.5, color: '0.5 0.5 0.48' });
}
const pctS = (v, d = 1) => (v == null || !Number.isFinite(+v)) ? '-' : ((+v >= 0 ? '+' : '') + (+v).toFixed(d) + '%');

// Render an invoice to a PDF Buffer. inv: the invoice record; calc: { lines, sub, gst, total, rate };
// s: settings.invoice (entity, abn, address, email, phone, bank, footer).
function invoicePdf(inv, calc, s = {}) {
  const b = builder();
  const rightX = PAGE_W - M;
  let y = M + 6;
  // Header: the approved logo + TAX INVOICE
  if (LOGO) b.image(M, y - 6, 46, 46); else b.text(M, y, 'Brightday', { font: 'F2', size: 12 });
  b.text(rightX - 120, y, 'TAX INVOICE', { font: 'F2', size: 16 });
  if ((inv.status || 'Draft') === 'Draft') b.text(rightX - 120, y + 16, 'DRAFT - not yet issued', { font: 'F1', size: 8, color: '0.7 0.28 0.24' });
  y += 52;
  b.text(M, y, ascii(s.entity || 'Brightday'), { font: 'F1', size: 9, color: '0.35 0.35 0.33' });
  y += 12;
  (s.abn ? ['ABN ' + s.abn] : []).concat(String(s.address || '').split('\n')).filter(Boolean).forEach((ln) => { b.text(M, y, ln, { font: 'F1', size: 8.5, color: '0.42 0.42 0.4' }); y += 11; });
  if (s.email || s.phone) { b.text(M, y, [s.email, s.phone].filter(Boolean).join('  -  '), { font: 'F1', size: 8.5, color: '0.42 0.42 0.4' }); y += 11; }

  // Meta block (right)
  let my = M + 30;
  const meta = [['Invoice', inv.number], ['Issued', fmtDate(inv.issued)], ['Due', fmtDate(inv.due)]];
  if (inv.ref) meta.push(['Reference', inv.ref]);
  meta.forEach(([k, v]) => { b.text(rightX - 200, my, k, { font: 'F1', size: 9, color: '0.42 0.42 0.4' }); b.text(rightX - 120, my, String(v), { font: 'F2', size: 9 }); my += 13; });

  // Bill to
  y = Math.max(y, my) + 16;
  b.text(M, y, 'BILL TO', { font: 'F2', size: 8, color: '0.42 0.42 0.4' }); y += 14;
  const c = inv.client || {};
  [c.name, c.contact, ...String(c.address || '').split('\n'), c.abn ? 'ABN ' + c.abn : '', c.email].filter(Boolean).forEach((ln, i) => { b.text(M, y, ln, { font: i === 0 ? 'F2' : 'F1', size: i === 0 ? 11 : 9, color: i === 0 ? null : '0.3 0.3 0.28' }); y += i === 0 ? 15 : 12; });

  // Line items table
  y += 14;
  const colQty = rightX - 210, colUnit = rightX - 120, colAmt = rightX;
  b.rect(M, y - 10, rightX - M, 20, '0.95 0.94 0.91');
  b.text(M + 6, y + 4, 'DESCRIPTION', { font: 'F2', size: 8, color: '0.35 0.35 0.33' });
  b.text(colQty - 24, y + 4, 'QTY', { font: 'F2', size: 8, color: '0.35 0.35 0.33' });
  b.text(colUnit - 30, y + 4, 'UNIT', { font: 'F2', size: 8, color: '0.35 0.35 0.33' });
  b.text(colAmt - 44, y + 4, 'AMOUNT', { font: 'F2', size: 8, color: '0.35 0.35 0.33' });
  y += 24;
  (calc.lines || []).forEach((l) => {
    const desc = ascii(l.desc || '');
    b.text(M + 6, y, desc.length > 58 ? desc.slice(0, 57) + '...' : desc, { font: 'F1', size: 9.5 });
    b.rightMono(colQty, y, String(l.qty ?? ''), 9.5);
    b.rightMono(colUnit, y, fmtMoney(l.unit), 9.5);
    b.rightMono(colAmt, y, fmtMoney(l.total), 9.5);
    y += 16; b.line(M, y - 6, rightX, y - 6, 0.4, 0.85);
  });

  // Totals
  y += 8;
  const gstLabel = `GST (${Math.round((calc.rate || 0.1) * 100)}%)`;
  const totals = [['Subtotal (ex GST)', fmtMoney(calc.sub)], [gstLabel, fmtMoney(calc.gst)]];
  totals.forEach(([k, v]) => { b.text(colUnit - 30, y, k, { font: 'F1', size: 9.5, color: '0.35 0.35 0.33' }); b.rightMono(colAmt, y, v, 9.5); y += 15; });
  b.line(colUnit - 34, y - 2, rightX, y - 2, 0.7, 0.6);
  y += 8;
  b.text(colUnit - 30, y, 'Total inc GST', { font: 'F2', size: 11 }); b.rightMono(colAmt, y, fmtMoney(calc.total), 11);
  y += 30;

  // Payment details + footer
  if (s.bank) { b.text(M, y, 'PAYMENT', { font: 'F2', size: 8, color: '0.42 0.42 0.4' }); y += 13; b.text(M, y, ascii(s.bank), { font: 'F1', size: 9.5 }); y += 16; }
  if (inv.notes) { String(inv.notes).split('\n').forEach((ln) => { b.text(M, y, ln, { font: 'F1', size: 9, color: '0.3 0.3 0.28' }); y += 12; }); y += 4; }
  if (s.footer) b.text(M, y, ascii(s.footer), { font: 'F1', size: 8.5, color: '0.5 0.5 0.48' });

  return assemble(b.build());
}

// Assemble a minimal PDF file with a content stream and the three standard fonts.
function assemble(content) {
  const objs = [];
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
  objs[3] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 5 0 R /F2 6 0 R /F3 7 0 R >> ${LOGO ? '/XObject << /Im1 8 0 R >>' : ''} >> /Contents 4 0 R >>`;
  objs[4] = `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`;
  objs[5] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objs[6] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  objs[7] = '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>';
  if (LOGO) objs[8] = `<< /Type /XObject /Subtype /Image /Width 400 /Height 400 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${LOGO.length} >>\nstream\n${LOGO.toString('latin1')}\nendstream`;
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets = [];
  for (let i = 1; i < objs.length; i++) { offsets[i] = Buffer.byteLength(out); out += `${i} 0 obj\n${objs[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i++) out += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

// Render a model portfolio "client pack" to a PDF Buffer. m: the model record; data: {
// holdings:[{t,name,cls,w,yld,mer,y1,price}], alloc:[{cls,pct}], tw, wYield, wFee, wY1, growth:{pts,bench,from,to}, value };
// opts: { entity, abn, disclaimer, asOf, source }.
function modelPdf(m, data, opts = {}) {
  const b = builder();
  const rightX = PAGE_W - M;
  let y = header(b, 'MODEL PORTFOLIO', 'Client pack');
  b.text(M, y, ascii(m.name || 'Model portfolio'), { font: 'F2', size: 17 }); y += 18;
  [['Risk profile', m.risk], ['Objective', m.objective], ['Benchmark', m.benchmark], ['Rebalancing', m.rebal], ['Minimum', m.minInv ? fmtMoney(m.minInv).replace('.00', '') : '']].filter(([, v]) => v).forEach(([k, v]) => { b.text(M, y, k, { font: 'F2', size: 8.5, color: '0.42 0.42 0.4' }); b.text(M + 78, y, ascii(v).slice(0, 110), { font: 'F1', size: 9 }); y += 12.5; });
  // Headline metrics
  y += 6;
  const tiles = [['5 yr return p.a.', pctS(data.wY5)], ['1 yr return', pctS(data.wY1)], ['Running fee', (data.wFee || 0).toFixed(2) + '% p.a.'], ['Yield', (data.wYield || 0).toFixed(1) + '%']];
  const tw = (rightX - M - 3 * 8) / 4;
  tiles.forEach(([k, v], i) => { const x = M + i * (tw + 8); b.rect(x, y, tw, 40, '0.96 0.95 0.92'); b.text(x + 8, y + 12, k.toUpperCase(), { font: 'F2', size: 6.5, color: '0.42 0.42 0.4' }); b.text(x + 8, y + 30, v, { font: 'F2', size: 14 }); });
  y += 54;
  // Allocation + growth chart side by side
  const colW = (rightX - M - 24) / 2;
  b.text(M, y, 'ASSET ALLOCATION', { font: 'F2', size: 8, color: '0.42 0.42 0.4' });
  b.text(M + colW + 24, y, 'GROWTH OF $100 - 5 YEARS', { font: 'F2', size: 8, color: '0.42 0.42 0.4' });
  y += 12; let ay = y;
  (data.alloc || []).forEach((a) => { b.text(M, ay + 9, ascii(a.cls).slice(0, 34), { font: 'F1', size: 9 }); b.rect(M, ay + 13, colW - 60, 5, '0.9 0.89 0.86'); b.rect(M, ay + 13, (colW - 60) * Math.min(1, a.pct / 100), 5, '0.1 0.36 0.29'); b.rightMono(M + colW - 4, ay + 9, a.pct.toFixed(1) + '%', 8.5); ay += 22; });
  let cy = y;
  if (data.growth && data.growth.pts && data.growth.pts.length > 5) {
    const series = [{ pts: data.growth.pts, rgb: '0.1 0.36 0.29', w: 1.4 }];
    if (data.growth.bench && data.growth.bench.length > 5) series.push({ pts: data.growth.bench, rgb: '0.55 0.55 0.52', w: 0.9 });
    cy = chart(b, M + colW + 24, y, colW - 34, 96, series, { left: data.growth.from, right: data.growth.to, fmt: (v) => '$' + v.toFixed(0) });
    b.text(M + colW + 24, cy + 2, ascii(`Model $${data.growth.pts[data.growth.pts.length - 1].toFixed(0)}` + (data.growth.bench ? ` - Benchmark ${data.growth.bench[data.growth.bench.length - 1].toFixed(0)} (grey)` : '')), { font: 'F1', size: 7.5, color: '0.42 0.42 0.4' }); cy += 10;
  } else { b.text(M + colW + 24, y + 40, 'Price history is not available for every holding yet.', { font: 'F1', size: 8.5, color: '0.5 0.5 0.48' }); cy = y + 60; }
  y = Math.max(ay, cy) + 8;
  // Holdings table
  const sized = data.value > 0;
  const cW = rightX - 40, cF = rightX - 96, cY = rightX - 150, cT = rightX - 206, cD = rightX - 276, cU = rightX - 340;
  b.rect(M, y - 10, rightX - M, 20, '0.95 0.94 0.91');
  b.text(M + 6, y + 4, 'HOLDING', { font: 'F2', size: 8, color: '0.35 0.35 0.33' });
  if (sized) { b.text(cU - 30, y + 4, 'UNITS', { font: 'F2', size: 8, color: '0.35 0.35 0.33' }); b.text(cD - 44, y + 4, 'AMOUNT', { font: 'F2', size: 8, color: '0.35 0.35 0.33' }); }
  b.text(cT - 32, y + 4, 'TARGET', { font: 'F2', size: 8, color: '0.35 0.35 0.33' });
  b.text(cY - 26, y + 4, 'YIELD', { font: 'F2', size: 8, color: '0.35 0.35 0.33' });
  b.text(cF - 16, y + 4, 'FEE', { font: 'F2', size: 8, color: '0.35 0.35 0.33' });
  b.text(cW - 18, y + 4, '1 YR', { font: 'F2', size: 8, color: '0.35 0.35 0.33' });
  y += 24;
  (data.holdings || []).slice(0, 14).forEach((h) => {
    const nm = ascii(`${h.name || h.t} (${h.t})`); const maxLen = sized ? 27 : 46;
    b.text(M + 6, y, nm.length > maxLen ? nm.slice(0, maxLen - 1) + '...' : nm, { font: 'F1', size: 8.5 });
    if (sized) { const amt = data.value * (h.w || 0) / 100; b.rightMono(cU, y, h.price ? String(Math.floor(amt / h.price)) : '-', 8.5); b.rightMono(cD, y, fmtMoney(amt).replace('.00', ''), 8.5); }
    b.rightMono(cT, y, (h.w || 0) + '%', 8.5);
    b.rightMono(cY, y, (h.yld != null ? (+h.yld).toFixed(1) : '-') + '%', 8.5);
    b.rightMono(cF, y, (h.mer != null ? (+h.mer).toFixed(2) + '%' : '-'), 8.5);
    b.rightMono(cW, y, pctS(h.y1), 8.5);
    y += 14; b.line(M, y - 5, rightX, y - 5, 0.3, 0.88);
  });
  y += 4;
  b.text(M + 6, y, sized ? `Weighted - sized for ${fmtMoney(data.value).replace('.00', '')}` : 'Weighted', { font: 'F2', size: 8.5 });
  b.rightMono(cT, y, (data.tw || 0).toFixed(0) + '%', 8.5);
  b.rightMono(cY, y, (data.wYield || 0).toFixed(1) + '%', 8.5);
  b.rightMono(cF, y, (data.wFee || 0).toFixed(2) + '%', 8.5);
  b.rightMono(cW, y, pctS(data.wY1), 8.5);
  y += 22;
  if (m.notes) { b.text(M, y, 'NOTES', { font: 'F2', size: 8, color: '0.42 0.42 0.4' }); y += 11; y = b.para(M, y, m.notes, { size: 9 }); }
  footer(b, y + 4, opts);
  return assemble(b.build());
}

// Render a security fact sheet to a PDF Buffer. s: the security record; hist: { pts:[{d,c,a}], stats, asOf } or null;
// models: [{ name, w }] the model portfolios holding it; opts: { entity, abn, disclaimer, asOf, source }.
function factsheetPdf(s, hist, models = [], opts = {}) {
  const b = builder();
  const rightX = PAGE_W - M;
  let y = header(b, 'FACT SHEET', [s.kind, s.cls].filter(Boolean).join(' - '));
  b.text(M, y, ascii(s.name || s.t).slice(0, 64), { font: 'F2', size: 17 }); y += 16;
  b.text(M, y, ascii([s.t, s.ex, s.ccy, s.sector].filter(Boolean).join('  -  ')), { font: 'F3', size: 9, color: '0.35 0.35 0.33' }); y += 18;
  // Price + change
  const price = Number(s.price); const dp = price < 10 ? 4 : 2;
  b.text(M, y + 10, (s.ccy === 'AUD' && s.kind !== 'Index' ? 'A$' : '') + (Number.isFinite(price) ? price.toFixed(dp) : '-') + (s.kind === 'Index' ? ' points' : ''), { font: 'F2', size: 22 });
  b.text(M, y + 24, pctS(s.chg, 2) + ' today', { font: 'F1', size: 9, color: (s.chg || 0) >= 0 ? '0.1 0.36 0.29' : '0.7 0.28 0.24' });
  const st = (hist && hist.stats) || {}; const ret = s.ret || {};
  const perf = [['1 month', st.m1 ?? ret.m1], ['3 months', st.m3 ?? ret.m3], ['1 year', st.y1 ?? ret.y1], ['3 yr p.a.', st.y3 ?? ret.y3], ['5 yr p.a.', st.y5 ?? ret.y5], ['Volatility', st.vol ?? s.vol], ['Max drawdown', st.mdd ?? s.mdd]];
  const pw = (rightX - M - 175) / perf.length;
  perf.forEach(([k, v], i) => { const x = M + 175 + i * pw; b.text(x, y, k.toUpperCase(), { font: 'F2', size: 6.5, color: '0.42 0.42 0.4' }); b.text(x, y + 13, (k === 'Volatility' ? (v == null ? '-' : (+v).toFixed(1) + '%') : pctS(v)), { font: 'F2', size: 11, color: k === 'Max drawdown' ? '0.7 0.28 0.24' : null }); });
  y += 44;
  // 5-year chart
  const pts = hist && hist.pts ? hist.pts.map((p) => p.a ?? p.c).filter((v) => Number.isFinite(v)) : [];
  b.text(M, y, `PRICE - ${pts.length ? Math.min(5, Math.round((hist.stats && hist.stats.years) || 5)) + ' YEARS' : 'HISTORY NOT AVAILABLE'}`, { font: 'F2', size: 8, color: '0.42 0.42 0.4' }); y += 10;
  if (pts.length > 5) { const step = Math.max(1, Math.floor(pts.length / 260)); const sampled = pts.filter((_, i) => i % step === 0 || i === pts.length - 1); y = chart(b, M, y, rightX - M - 44, 150, [{ pts: sampled }], { left: fmtDate(hist.pts[0].d), right: fmtDate(hist.pts[hist.pts.length - 1].d), fmt: (v) => v.toFixed(dp) }); }
  else y += 14;
  // Key facts (two columns)
  y += 4; b.text(M, y, 'KEY FACTS', { font: 'F2', size: 8, color: '0.42 0.42 0.4' }); y += 12;
  const facts = [['Market cap / fund size', s.mcap], ['Price / earnings', s.pe ? (+s.pe).toFixed(1) + 'x' : null], ['Distribution yield', s.yld != null ? (+s.yld).toFixed(2) + '%' + (s.frank ? ' - ' + s.frank + '% franked' : '') : null], ['Management fee', s.mer != null ? (+s.mer).toFixed(2) + '% p.a.' : null], ['52-week range', Array.isArray(s.w52) ? s.w52[0] + ' - ' + s.w52[1] : null], ['Beta', s.beta != null ? (+s.beta).toFixed(2) : null], ['Holdings', s.hold ? String(s.hold) : null], ['Exchange', s.ex]].filter(([, v]) => v);
  const half = Math.ceil(facts.length / 2); const fy0 = y;
  facts.forEach(([k, v], i) => { const col = i < half ? 0 : 1; const fy = fy0 + (i - (col ? half : 0)) * 13; const x = M + col * ((rightX - M) / 2); b.text(x, fy, k, { font: 'F1', size: 8.5, color: '0.42 0.42 0.4' }); b.text(x + 118, fy, ascii(String(v)), { font: 'F2', size: 8.5 }); });
  y = fy0 + half * 13 + 6;
  if (s.desc) { b.text(M, y, 'ABOUT', { font: 'F2', size: 8, color: '0.42 0.42 0.4' }); y += 11; y = b.para(M, y, String(s.desc).length > 900 ? String(s.desc).slice(0, 900).replace(/\s+\S*$/, '') + '...' : s.desc, { size: 9 }); y += 4; }
  if (s.note) { b.text(M, y, 'RESEARCH NOTE' + (s.noteBy ? ' - ' + ascii(s.noteBy).toUpperCase() : '') + (s.noteAt ? ' - ' + fmtDate(s.noteAt).toUpperCase() : '') + (s.noteStatus === 'Approved' ? ' - SIGNED OFF' + (s.noteApprovedName ? ' BY ' + ascii(s.noteApprovedName).toUpperCase() : '') : ' - DRAFT, NOT SIGNED OFF'), { font: 'F2', size: 8, color: s.noteStatus === 'Approved' ? '0.42 0.42 0.4' : '0.7 0.28 0.24' }); y += 11; y = b.para(M, y, String(s.note).slice(0, 1400), { size: 9 }); y += 4; }
  if (models.length) { b.text(M, y, 'IN MODEL PORTFOLIOS', { font: 'F2', size: 8, color: '0.42 0.42 0.4' }); y += 11; b.text(M, y, ascii(models.map((m) => `${m.name} ${m.w}%`).join('  -  ')).slice(0, 120), { font: 'F1', size: 9 }); y += 14; }
  footer(b, y, opts);
  return assemble(b.build());
}

module.exports = { invoicePdf, modelPdf, factsheetPdf };
