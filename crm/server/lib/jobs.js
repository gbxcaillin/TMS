'use strict';
// In-process scheduler (no host cron needed): chat digests, daily task digest, market refresh,
// nightly SQLite backup (+ SharePoint copy), session pruning.
// Modules switched off in brand.json at the project root (see tools/rebrand.js).
const MODULES_OFF = (() => { try { const m = require('../../brand.json').modules || {}; return Object.keys(m).filter((k) => m[k] === false); } catch { return []; } })();
const fs = require('node:fs');
const path = require('node:path');
const D = require('./db');
const mail = require('./mail');
const graph = require('./graph');
const auth = require('./auth');
const market = require('./market');
const bookings = require('./bookings');
const { notify, prefs } = require('./notify');
const nurture = require('./nurture');
const scoring = require('./scoring');
const mailing = require('./mailing');
const calendar = require('./calendar');
const mailsync = require('./mailsync');
const health = require('./health');

const ran = (name, key) => { const j = D.jobs.get.get(name); return j && j.last_run === key; };
const mark = (name, key, detail = '') => D.jobs.set.run(name, key, detail);
const hoursSince = (iso) => (Date.now() - new Date(iso).getTime()) / 36e5;
const first = (n) => (n || '').split(' ')[0];

async function chatDigest() {
  const h = prefs().chatHours || 24;
  const rooms = Object.fromEntries(D.listCol('rooms').map((r) => [r.id, r]));
  const msgs = D.listCol('messages');
  const perUser = {};
  for (const m of msgs) {
    const r = rooms[m.room]; if (!r || !m.at || hoursSince(m.at) < h) continue;
    for (const u of r.members || []) { if (u === m.who || (m.read || []).includes(u) || (m.emailed || []).includes(u)) continue; (perUser[u] = perUser[u] || []).push(m); }
  }
  for (const [uid, list] of Object.entries(perUser)) {
    const u = D.users.get(uid); if (!u || u.status !== 'Active') continue;
    const p = (prefs().events || []).find((e) => e.id === 'chat');
    if (p && p.email === false) continue;
    const html = list.slice(0, 12).map((m) => `<p style="margin:0 0 10px"><b>${mail.esc(first((D.users.get(m.who) || {}).name))}</b> in <i>${mail.esc(rooms[m.room].name || 'direct message')}</i> · ${mail.esc(m.at.replace('T', ' '))}<br>${mail.esc(m.text)}</p>`).join('');
    await mail.send({ to: u.email, subject: `${list.length} unread chat message${list.length === 1 ? '' : 's'} in Pipeline`, title: 'Unread for over ' + h + ' hours', html, cta: { label: 'Open chat', url: mail.BASE + '/#/chat' }, kind: 'chat' });
    for (const m of list) { m.emailed = [...new Set([...(m.emailed || []), uid])]; D.putRecord('messages', m, 'system'); }
  }
}
async function dailyDigest() {
  const today = D.today();
  const tasks = D.listCol('tasks').filter((t) => !t.done && t.due && t.due <= today);
  const per = {};
  for (const t of tasks) for (const u of t.who || []) (per[u] = per[u] || []).push(t);
  for (const [uid, list] of Object.entries(per)) {
    const overdue = list.filter((t) => t.due < today), due = list.filter((t) => t.due === today);
    if (overdue.length) await notify('overdue', [uid], { title: `${overdue.length} overdue task${overdue.length === 1 ? '' : 's'}`, body: overdue.slice(0, 3).map((t) => t.title).join(' · '), url: '#/tasks', kind: 'task', id: 'overdue-' + today, emailHtml: overdue.map((t) => `<p><b>${mail.esc(t.title)}</b> · due ${t.due}</p>`).join('') });
    if (due.length) await notify('due', [uid], { title: `${due.length} task${due.length === 1 ? '' : 's'} due today`, body: due.slice(0, 3).map((t) => t.title).join(' · '), url: '#/tasks', kind: 'task', id: 'due-' + today });
  }
}
async function backup() {
  const dir = path.join(D.DATA_DIR, 'backups'); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `crm-${D.today()}.db`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  D.backup(file);
  for (const f of fs.readdirSync(dir)) { const p = path.join(dir, f); if (Date.now() - fs.statSync(p).mtimeMs > 14 * 86400e3) fs.unlinkSync(p); }
  let sp = '';
  if (graph.enabled()) { try { await graph.upload([graph.SP_FOLDER, '_CRM Backups'].filter(Boolean).join('/'), path.basename(file), fs.readFileSync(file)); sp = ' + SharePoint'; } catch (e) { sp = ' (SharePoint copy failed: ' + e.message + ')'; } }
  console.log('[backup]', file + sp);
  return file + sp;
}

async function tick() {
  const now = new Date(); const hhmm = D.nowIso().slice(11, 16); const day = D.today();
  const settings = D.kvGet('settings'); if (!settings) return;
  // Every job runs through run(): returning SKIP means "not due", anything else is a successful run, and a throw is
  // a failure that lib/health.js counts (three in a row alerts the admins).
  const SKIP = Symbol('skip'); const due = (name, ms) => { const last = D.jobs.get.get(name); return !last || Date.now() - new Date(last.last_run).getTime() > ms; };
  // Jobs that belong to a module switched off in brand.json do not run.
  const JOB_MODULE = { market: 'research', refdata: 'research', notereview: 'research', bookings: 'calendar', calendar: 'calendar', mailsync: 'email', nurture: 'nurture', sendq: 'mailing', chat: 'chat' };
  const run = async (name, fn) => { if (MODULES_OFF.includes(JOB_MODULE[name])) return; try { if ((await fn()) !== SKIP) await health.jobOk(name); } catch (e) { await health.jobFailed(name, e); } };
  await run('chat', async () => { const k = day + 'T' + hhmm.slice(0, 4); if (now.getMinutes() % 15 !== 0 || ran('chat', k)) return SKIP; mark('chat', k); await chatDigest(); });
  await run('digest', async () => { const at = prefs().digest || '07:30'; if (hhmm < at || ran('digest', day)) return SKIP; mark('digest', day); await dailyDigest(); });
  await run('backup', async () => { if (hhmm < '02:30' || ran('backup', day)) return SKIP; mark('backup', day); mark('backup', day, await backup()); });
  await run('market', async () => {
    const mins = Math.max(5, Number((settings.research || {}).refreshMins) || 20); if (!due('market', mins * 60e3)) return SKIP;
    mark('market', new Date().toISOString()); const n = await market.refreshSecurities(); mark('market', new Date().toISOString(), n + ' updated');
    const lr = ((D.kvGet('settings') || {}).research || {}).lastResult || {};
    if (lr.total && lr.failed === lr.total) throw new Error(`None of the ${lr.total} securities could be priced. Yahoo Finance may be down or may have changed.`);
  });
  // Reference fund data (Morningstar exports in SharePoint, Research/Reference data): re-import changed files hourly.
  await run('refdata', async () => {
    const graph = require('./graph'); if (!graph.enabled() || !due('refdata', 60 * 60e3)) return SKIP;
    mark('refdata', new Date().toISOString()); const r = await require('./refdata').syncFromSharePoint(graph);
    mark('refdata', new Date().toISOString(), `${r.imported.length} imported, ${r.removed.length} removed${r.errors.length ? ', ' + r.errors.length + ' errors' : ''}`);
    if (r.errors.length) throw new Error(r.errors.join('; '));
  });
  await run('bookings', async () => { if (!bookings.enabled() || !due('bookings', 15 * 60e3)) return SKIP; mark('bookings', new Date().toISOString()); const r = await bookings.sync(); mark('bookings', new Date().toISOString(), (r.added || 0) + ' new'); });
  await run('calendar', async () => { if (!calendar.enabled() || !due('calendar', 15 * 60e3)) return SKIP; mark('calendar', new Date().toISOString()); const n = await calendar.syncAll(); mark('calendar', new Date().toISOString(), n + ' changes'); });
  await run('mailsync', async () => {
    if (!mailsync.enabled() || !due('mailsync', 15 * 60e3)) return SKIP;
    mark('mailsync', new Date().toISOString()); const n = await mailsync.syncAll(); const errs = mailsync.lastErrors();
    mark('mailsync', new Date().toISOString(), n + ' logged' + (errs.length ? ', ' + errs.length + ' errors' : ''));
    if (errs.length) throw new Error(errs.slice(0, 2).join('; '));
  });
  await run('nurture', async () => { if (!due('nurture', 10 * 60e3)) return SKIP; mark('nurture', new Date().toISOString()); const n = await nurture.run(); mark('nurture', new Date().toISOString(), n + ' sent'); });
  await run('score', async () => { if (!due('score', 5 * 60e3)) return SKIP; mark('score', new Date().toISOString()); const n = await scoring.autoScore(); if (n) mark('score', new Date().toISOString(), n + ' scored'); });
  await run('notereview', async () => { if (ran('notereview', day)) return SKIP; mark('notereview', day); mark('notereview', day, noteReviewTasks() + ' tasks'); });
  await run('sendq', async () => { if (!D.listCol('sends').some((r) => r.status === 'queued' || r.status === 'sending')) return SKIP; mark('sendq', new Date().toISOString()); mailing.processQueue().then((n) => { if (n) mark('sendq', new Date().toISOString(), n + ' sent'); }).catch((e) => health.jobFailed('sendq', e)); });
  try { if (!ran('prune', day)) { mark('prune', day); auth.pruneSessions(); const d = new Date(); d.setFullYear(d.getFullYear() - 2); D.auditPrune(D.localIso(d)); } } catch (e) { /* ignore */ }
}
// Research notes due for review within a week get a task for their author (or the admins when the author has left),
// once per note and review date.
function noteReviewTasks() {
  const soon = D.localIso(new Date(Date.now() + 7 * 864e5)).slice(0, 10); const tasks = D.listCol('tasks'); const users = D.users.all().filter((u) => u.status === 'Active'); let n = 0;
  for (const s of D.listCol('securities')) {
    if (!s.note || !s.noteReview || s.noteReview > soon) continue;
    const src = `note-review:${s.t}:${s.noteReview}`; if (tasks.some((t) => t.src === src)) continue;
    const author = users.find((u) => u.id === s.noteByUid) || users.find((u) => u.name === s.noteBy);
    const who = author ? [author.id] : users.filter((u) => u.role === 'Admin').map((u) => u.id);
    D.putRecord('tasks', { id: D.nextId('tasks'), title: `Review research note: ${s.t}`, desc: `The research note on ${s.name} is due for review by ${s.noteReview}. Check it still holds against the latest figures, then Mark reviewed, or edit it and have it signed off again.`, deal: 0, due: s.noteReview, who, by: '', notify: [], notifyBy: false, channels: ['app'], repeat: null, files: [], done: false, created: D.nowIso(), auto: 'research note review', src, link: '#/security/' + encodeURIComponent(s.t), linkLabel: 'Open ' + s.t }, 'system');
    n++;
  }
  return n;
}
function start() { setTimeout(() => { tick(); setInterval(tick, 60e3); }, 5000); }
module.exports = { start, tick, backup, chatDigest, dailyDigest, noteReviewTasks };
