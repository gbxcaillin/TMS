'use strict';
// Phone calls from a softphone (JustCall, Dialpad or Aircall) into the CRM. Each provider posts a webhook
// when a call ends; the adapter below turns it into one shape, ingest() stores it in the synced `calls`
// collection, matches the number to a deal or client, and writes a call entry (with the summary) on the
// deal's timeline. Recording links and transcripts stay in the call record. When a provider gives a
// transcript but no summary, Claude writes one if the helper is configured.
//   Webhook: POST /api/v1/hooks/calls/<provider>/<CALLS_WEBHOOK_SECRET>
const D = require('./db');
const claude = require('./claude');
const { notify } = require('./notify');

const env = process.env;
const enabled = () => !!env.CALLS_WEBHOOK_SECRET;

// Phone numbers as Australians write them -> E.164 where possible, so 0412 345 678, +61 412 345 678 and
// 61412345678 all match.
function normPhone(s) {
  let raw = String(s || '').trim();
  if (!raw) return '';
  const trunk = /^\+?\s*61\s*\(0\)/.test(raw);                       // +61 (0)412 ... : the (0) is dropped when dialling internationally
  let d = raw.replace(/[^\d+]/g, '');
  if (trunk) d = d.replace(/^(\+?61)0/, '$1');
  if (!d) return '';
  if (d.startsWith('+')) d = '+' + d.slice(1).replace(/\D/g, '');
  else if (d.startsWith('0011')) d = '+' + d.slice(4);                 // Australian international prefix
  else if (d.startsWith('0') && d.length === 10) d = '+61' + d.slice(1);   // 04xx xxx xxx, 03 xxxx xxxx
  else if (d.startsWith('61') && (d.length === 11 || d.length === 12)) d = '+' + d;
  if (/^\+610\d{9}$/.test(d)) d = '+61' + d.slice(4);                  // +61 0412 ... written with the zero kept
  return d;
}
// Every phone-type field on a record (the built-in Phone plus any custom phone fields), normalised.
function phonesOf(rec, fields) {
  const ids = ['phone', 'mobile', ...(fields || []).filter((f) => f && f.type === 'phone').map((f) => f.id)];
  return [...new Set(ids.map((k) => normPhone(rec[k])).filter((n) => n && n.length >= 8))];
}
const fmtDur = (s) => { s = Math.round(Number(s) || 0); return s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`; };
const stageClosed = () => new Set((D.kvGet('stages') || []).filter((s) => s.closed).map((s) => s.id));

// The deal (open first, then most recent) or client whose phone matches.
function match(number) {
  const n = normPhone(number); if (!n || n.length < 8) return {};
  const closed = stageClosed();
  const fields = D.kvGet('fields') || [];
  const deals = D.listCol('deals').filter((d) => phonesOf(d, fields).includes(n)).sort((a, b) => (closed.has(a.stage) - closed.has(b.stage)) || String(b.created || '').localeCompare(String(a.created || '')));
  if (deals.length) return { deal: deals[0].id, client: deals[0].client || 0 };
  const c = D.listCol('clients').find((c) => phonesOf(c, fields).includes(n));
  if (c) return { deal: (c.deals || [])[0] || 0, client: c.id };
  return {};
}

function timelineText(c) { if (c.kind === 'sms') return `Text ${c.direction === 'in' ? 'received from' : 'sent to'} ${c.number || 'unknown'}`; return `${c.direction === 'in' ? 'Inbound' : 'Outbound'} call${c.status === 'missed' ? ' missed' : c.status === 'voicemail' ? ' to voicemail' : ' · ' + fmtDur(c.duration)}${c.number ? ' · ' + c.number : ''}`; }
function writeTimeline(c, existingActivity) {
  if (!c.deal && !c.client) return;
  const acts = existingActivity || D.listCol('activity');
  const prev = acts.find((a) => a.call === c.id);
  const rec = { id: prev ? prev.id : Date.now() + Math.floor(Math.random() * 1e4), deal: c.deal || 0, client: c.client || 0, type: c.kind === 'sms' ? 'sms' : 'call', who: c.who || '', text: timelineText(c), detail: c.kind === 'sms' ? (c.text || '') : (c.summary || (c.transcript ? 'Transcript available' : '')), at: c.at, call: c.id, url: c.sourceUrl || '' };
  if (!prev || JSON.stringify(prev) !== JSON.stringify(rec)) D.putRecord('activity', rec, 'system');
}

// One call in, in the common shape. Repeated deliveries for the same provider call id merge into one record.
async function ingest(c) {
  const key = `${c.provider}:${c.extId}`;
  const prev = D.listCol('calls').find((x) => x.key === key);
  if (!prev && !c.number && !c.direction && !c.note) return null;   // an intelligence event for a call we never saw
  if (c.note) {   // an agent's comment in the softphone -> a timestamped note on the deal
    const mm = match(c.number); const target = prev || { deal: mm.deal || 0, client: mm.client || 0, id: 0 };
    if (target.deal || target.client) { const u = c.agentEmail ? D.users.byEmail(String(c.agentEmail).toLowerCase()) : null; D.putRecord('activity', { id: Date.now() + Math.floor(Math.random() * 1e4), deal: target.deal || 0, client: target.client || 0, type: 'note', who: u ? u.id : '', text: 'Note from ' + (c.provider === 'aircall' ? 'Aircall' : c.provider), detail: c.note, at: D.nowIso(), call: target.id || undefined }, 'system'); }
    return prev || null;
  }
  const user = c.agentEmail ? D.users.byEmail(String(c.agentEmail).toLowerCase()) : null;
  const m = match(c.number || (prev ? prev.number : ''));
  const rec = {
    id: prev ? prev.id : D.nextId('calls'), key, provider: c.provider, extId: String(c.extId), kind: c.kind || (prev ? prev.kind : 'call') || 'call', text: c.text || (prev ? prev.text : ''), direction: c.direction ? (c.direction === 'in' ? 'in' : 'out') : (prev ? prev.direction : 'out'), number: c.number || (prev ? prev.number : ''), normNumber: normPhone(c.number || (prev ? prev.number : '')),
    who: user ? user.id : (prev ? prev.who : ''), at: c.at || (prev ? prev.at : D.nowIso()), duration: Number(c.duration) || (prev ? prev.duration : 0), status: c.status || (prev ? prev.status : 'completed'),
    deal: prev && prev.deal ? prev.deal : (m.deal || 0), client: prev && prev.client ? prev.client : (m.client || 0),
    recording: c.recording || (prev ? prev.recording : ''), sourceUrl: c.sourceUrl || (prev ? prev.sourceUrl : ''), transcript: c.transcript || (prev ? prev.transcript : ''), summary: c.summary || (prev ? prev.summary : ''), sentiment: c.sentiment || (prev ? prev.sentiment : ''), score: c.score != null ? c.score : (prev ? prev.score : null),
  };
  if (rec.kind !== 'sms' && !rec.summary && rec.transcript && claude.enabled()) { try { rec.summary = await summarise(rec); } catch (e) { console.error('[calls] summary', e.message); } }
  D.putRecord('calls', rec, 'system');
  writeTimeline(rec);
  if (!prev && rec.kind !== 'sms' && rec.status === 'missed' && rec.direction === 'in' && rec.deal) {
    const d = D.getRecord('deals', rec.deal);
    if (d && d.owner) await notify('lead', [d.owner], { title: `Missed call from ${d.practice}`, body: `${rec.number} · call back`, url: '#/deal/' + d.id, kind: 'lead', id: 'call-' + rec.id });
  }
  D.log.hook.run(D.nowIso(), 'calls:' + c.provider, prev ? 'updated' : 'created', `${rec.kind === 'sms' ? 'text' : 'call'} ${rec.direction === 'in' ? 'in' : 'out'} ${rec.number}${rec.kind === 'sms' ? '' : ' ' + fmtDur(rec.duration)}${rec.deal ? ' → deal ' + rec.deal : ' (unmatched)'}`, String(rec.deal || ''));
  return rec;
}
async function summarise(rec) {
  const d = rec.deal ? D.getRecord('deals', rec.deal) : null;
  const prompt = ['Summarise this phone call for a CRM timeline at Brightday. Two sentences on what was discussed and decided, then "Next: " and the follow-ups, in plain Australian English, no em dashes, at most 70 words. Return only the text.', '', d ? `Deal: ${d.practice} (${d.contact || ''})` : '', `Direction: ${rec.direction === 'in' ? 'inbound' : 'outbound'}, ${fmtDur(rec.duration)}`, '', 'Transcript:', String(rec.transcript).slice(0, 12000)].filter(Boolean).join('\n');
  return String(await claude.run(prompt)).replace(/\s+/g, ' ').trim().slice(0, 600);
}
// Link an unmatched call to a deal by hand.
function link(id, dealId, by) {
  const c = D.getRecord('calls', id); if (!c) return null;
  const d = D.getRecord('deals', dealId); if (!d) return null;
  const next = { ...c, deal: d.id, client: d.client || c.client || 0 };
  D.putRecord('calls', next, by); writeTimeline(next); return next;
}

/* ---------- provider adapters: webhook body -> common shape (or null to ignore) ---------- */
const transcriptText = (t) => { if (!t) return ''; if (typeof t === 'string') return t; if (Array.isArray(t)) return t.map((l) => (l.speaker || l.name || l.role || '') + (l.time || l.timestamp ? ` [${l.time || l.timestamp}]` : '') + ': ' + (l.text || l.content || l.message || '')).join('\n'); return JSON.stringify(t); };
const localFromEpoch = (ms) => D.localIso(new Date(Number(ms))).slice(0, 16);

function fromJustCall(body) {
  const d = body && body.data; if (!d) return null;
  const type = String(body.type || ''); if (type && !/call\.(completed|updated|ai_report|missed|voicemail)/.test(type) && !/call_completed|call_updated/.test(type)) return null;
  const info = d.call_info || {}; const dur = d.call_duration || {}; const ai = d.justcall_ai || {};
  const dir = /in/i.test(info.direction || d.direction || '') ? 'in' : 'out';
  const st = String(info.type || info.status || type).toLowerCase();
  const status = /missed|no.?answer|unanswered/.test(st) ? 'missed' : /voicemail/.test(st) ? 'voicemail' : 'completed';
  const when = d.call_date && d.call_time ? `${d.call_date}T${String(d.call_time).slice(0, 5)}` : (d.datetime ? String(d.datetime).replace(' ', 'T').slice(0, 16) : D.nowIso().slice(0, 16));
  return { provider: 'justcall', extId: d.call_sid || d.id, direction: dir, number: d.contact_number || d.contact_phone || '', agentEmail: d.agent_email || '', at: when, duration: Number(dur.conversation_time || dur.total_duration || d.duration || 0), status, recording: info.recording || d.recording || '', transcript: transcriptText(ai.call_transcription), summary: typeof ai.call_summary === 'string' ? ai.call_summary : (ai.call_summary && ai.call_summary.summary) || '', sentiment: typeof ai.customer_sentiment === 'string' ? ai.customer_sentiment : '', score: ai.call_score != null ? Number(ai.call_score) : null };
}
async function fromDialpad(body) {
  if (!body || !body.call_id) return null;
  const state = String(body.state || ''); if (!['hangup', 'recording', 'call_transcription', 'missed', 'voicemail', 'recap_summary'].includes(state)) return null;
  const out = { provider: 'dialpad', extId: body.call_id, direction: body.direction === 'inbound' ? 'in' : 'out', number: body.external_number || '', agentEmail: (body.target && body.target.email) || '', at: body.date_started ? localFromEpoch(body.date_started) : undefined, duration: Math.round((Number(body.duration) || 0) / 1000), status: state === 'missed' ? 'missed' : state === 'voicemail' ? 'voicemail' : 'completed' };
  const rd = Array.isArray(body.recording_details) ? body.recording_details.find((r) => r && (r.url || r.id)) : null;
  if (rd) {
    out.recording = rd.url || '';
    // Dialpad's own recording URL needs a Dialpad login. A share link opens (and, when DIALPAD_SHARE_PRIVACY=public, plays) without one.
    if (rd.id && env.DIALPAD_API_KEY) {
      try {
        const r = await fetch('https://dialpad.com/api/v2/recordingsharelink', { method: 'POST', headers: { authorization: 'Bearer ' + env.DIALPAD_API_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ recording_id: String(rd.id), recording_type: rd.recording_type || 'callrecording', privacy: env.DIALPAD_SHARE_PRIVACY || 'company' }) });
        const j = await r.json(); if (r.ok && j.access_link) { out.recording = j.access_link; out.sourceUrl = j.access_link; }
      } catch (e) { console.error('[calls] dialpad share link', e.message); }
    }
  }
  if (state === 'voicemail' && body.transcription_text) out.transcript = body.transcription_text;
  if (state === 'recap_summary' && body.summary) out.summary = typeof body.summary === 'string' ? body.summary : JSON.stringify(body.summary);
  if (state === 'call_transcription' && env.DIALPAD_API_KEY) {
    try { const r = await fetch(`https://dialpad.com/api/v2/transcripts/${encodeURIComponent(body.call_id)}`, { headers: { authorization: 'Bearer ' + env.DIALPAD_API_KEY } }); const j = await r.json(); if (r.ok && Array.isArray(j.lines)) out.transcript = j.lines.filter((l) => l.type === 'transcript').map((l) => `${l.name || ''}: ${l.content || ''}`).join('\n'); }
    catch (e) { console.error('[calls] dialpad transcript', e.message); }
  }
  return out;
}
// Aircall. Events worth keeping: call.ended (the call), call.voicemail_left, call.commented (an agent's note in
// Aircall becomes a note on the deal), the conversation-intelligence events (summary/transcription/sentiment
// created: fetched via the public API, needs AI Assist), and message.sent / message.received (SMS).
const acUrl = (v) => (typeof v === 'string' ? v : (v && (v.url || v.link || v.href)) || '');
async function acGet(path) {
  const h = { authorization: 'Basic ' + Buffer.from(env.AIRCALL_API_ID + ':' + env.AIRCALL_API_TOKEN).toString('base64') };
  const r = await fetch('https://api.aircall.io/v1' + path, { headers: h }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error('Aircall ' + path + ': ' + r.status); return j;
}
async function acIntelligence(callId) {
  const out = {}; if (!(env.AIRCALL_API_ID && env.AIRCALL_API_TOKEN)) return out;
  try { const j = await acGet(`/calls/${callId}/transcription`); const utt = j && j.transcription && j.transcription.content && j.transcription.content.utterances; if (Array.isArray(utt)) out.transcript = utt.map((u) => `${u.participant_type === 'agent' ? 'Agent' : u.participant_type === 'customer' ? 'Customer' : (u.participant_type || 'Speaker')}: ${u.text || ''}`).join('\n'); } catch (e) { /* not on the plan yet or not ready */ }
  try { const j = await acGet(`/calls/${callId}/summary`); if (j && j.summary && j.summary.content) out.summary = String(j.summary.content); } catch (e) { /* ignore */ }
  try { const j = await acGet(`/calls/${callId}/sentiments`); const arr = j && j.sentiments; if (Array.isArray(arr) && arr.length) { const last = arr[arr.length - 1]; out.sentiment = String(last.sentiment || last.value || '').replace(/^\w/, (c) => c.toUpperCase()); } } catch (e) { /* ignore */ }
  return out;
}
function acNumber(d) { return d.raw_digits || (d.number && typeof d.number === 'object' && d.number.digits) || (d.contact && Array.isArray(d.contact.phone_numbers) && d.contact.phone_numbers[0] && d.contact.phone_numbers[0].value) || (typeof d.external_number === 'string' ? d.external_number : '') || ''; }
const acWhen = (v) => (v == null ? undefined : localFromEpoch(/^\d+$/.test(String(v)) ? Number(v) * 1000 : Date.parse(v)));
async function fromAircall(body) {
  const d = body && body.data; if (!d) return null;
  if (env.AIRCALL_WEBHOOK_TOKEN && body.token !== env.AIRCALL_WEBHOOK_TOKEN) throw Object.assign(new Error('Aircall token mismatch'), { status: 403 });
  const ev = String(body.event || '');
  if (ev === 'message.sent' || ev === 'message.received') {
    const num = acNumber(d) || (ev === 'message.sent' ? (d.to || '') : (d.from || ''));
    return { provider: 'aircall', kind: 'sms', extId: 'sms-' + d.id, direction: ev === 'message.received' ? 'in' : 'out', number: num, agentEmail: (d.user && d.user.email) || '', at: acWhen(d.created_at), duration: 0, status: 'completed', text: String(d.body || d.content || d.text || d.message || '').slice(0, 2000), sourceUrl: acUrl(d.asset) };
  }
  if (ev === 'call.commented') {
    const c = d.comment || (Array.isArray(d.comments) && d.comments[d.comments.length - 1]) || {};
    const text = String(c.content || c.body || d.content || '').trim(); if (!text) return null;
    return { provider: 'aircall', extId: d.id, direction: d.direction === 'inbound' ? 'in' : 'out', number: acNumber(d), agentEmail: (d.user && d.user.email) || (c.posted_by && c.posted_by.email) || '', duration: Number(d.duration) || 0, note: text };
  }
  if (/^(summary|transcription|sentiment|topics)\.created$/.test(ev)) {
    const id = d.call_id || (d.call && d.call.id) || d.id; if (!id) return null;
    const out = { provider: 'aircall', extId: id };
    if (ev === 'summary.created' && (d.content || (d.summary && d.summary.content))) out.summary = String(d.content || d.summary.content);
    if (ev === 'transcription.created' && d.content && Array.isArray(d.content.utterances)) out.transcript = d.content.utterances.map((u) => `${u.participant_type === 'agent' ? 'Agent' : 'Customer'}: ${u.text || ''}`).join('\n');
    if (!out.summary && !out.transcript) Object.assign(out, await acIntelligence(id));
    return out;
  }
  if (!/^call\.(ended|hungup|voicemail_left)$/.test(ev)) return null;
  const missed = d.status === 'missed' || !!d.missed_call_reason || (d.direction === 'inbound' && !d.answered_at && ev !== 'call.voicemail_left');
  const out = { provider: 'aircall', extId: d.id, direction: d.direction === 'inbound' ? 'in' : 'out', number: acNumber(d), agentEmail: (d.user && d.user.email) || '', at: acWhen(d.started_at), duration: Number(d.duration) || 0, status: ev === 'call.voicemail_left' || d.voicemail ? 'voicemail' : missed ? 'missed' : 'completed', recording: acUrl(d.recording) || acUrl(d.voicemail), sourceUrl: acUrl(d.asset) };
  if (out.status === 'completed' && ev === 'call.ended') Object.assign(out, await acIntelligence(d.id));
  return out;
}
const ADAPTERS = { justcall: fromJustCall, dialpad: fromDialpad, aircall: fromAircall };
async function handle(provider, body) {
  const fn = ADAPTERS[provider]; if (!fn) throw Object.assign(new Error('Unknown phone provider'), { status: 404 });
  const c = await fn(body); if (!c || !c.extId) return { ignored: true };
  const rec = await ingest(c); if (!rec) return { ignored: true };
  return { call: rec };
}
module.exports = { enabled, normPhone, phonesOf, match, ingest, link, handle, fromJustCall, fromDialpad, fromAircall, providers: Object.keys(ADAPTERS) };
