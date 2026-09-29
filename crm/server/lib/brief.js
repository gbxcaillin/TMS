'use strict';
// The morning briefing on the dashboard: two or three sentences about what matters today, with
// buttons that open the deals it names. Built from the pipeline each day (per user, in their
// scope), written by Claude through the helper when it is configured and by rules otherwise.
// Cached in job_state for the day; Refresh rebuilds it.
const D = require('./db');
const claude = require('./claude');
const { scopeFor, visible } = require('./state');

const money = (n) => 'A$' + Math.round(Number(n) || 0).toLocaleString('en-AU');
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);
const first = (n) => String(n || '').split(' ')[0];
const stageName = (id) => ((D.kvGet('stages') || []).find((s) => s.id === id) || {}).name || id;

function facts(user) {
  const today = D.today(); const scope = scopeFor(user);
  const stages = D.kvGet('stages') || [];
  const closed = new Set(stages.filter((s) => s.closed).map((s) => s.id));
  const deals = D.listCol('deals').filter((d) => visible(scope, 'deals', d));
  const open = deals.filter((d) => !closed.has(d.stage));
  const changes = D.listCol('changes').filter((c) => c.entity === 'deal' && c.field === 'Stage');
  const stageAt = {}; for (const c of changes) if (!stageAt[c.ref] || c.at > stageAt[c.ref]) stageAt[c.ref] = c.at;
  const inStage = (d) => daysBetween((stageAt[d.id] || d.created || today).slice(0, 10), today);
  const tasks = D.listCol('tasks').filter((t) => !t.done && (t.who || []).includes(user.id));
  const users = Object.fromEntries(D.users.all().map((u) => [u.id, u.name]));
  const name = (id) => first(users[id]) || 'nobody';
  // Client emails waiting on our reply: the contact wrote last in the deal's conversation and nobody has emailed or
  // had a connected call since (same rule as the dashboard's Waiting on us card).
  const threadsBy = {}; for (const t of D.listCol('threads')) if (t.deal) (threadsBy[t.deal] = threadsBy[t.deal] || []).push(t);
  const callsBy = {}; for (const c of D.listCol('calls')) if (c.deal && c.status !== 'missed' && (+c.duration || 0) > 0) (callsBy[c.deal] = callsBy[c.deal] || []).push(c);
  const waitingOf = (d) => { const ev = []; for (const t of threadsBy[d.id] || []) for (const m of t.msgs || []) if (m.at) ev.push({ at: m.at, dir: m.out ? 'out' : 'in', subject: t.subject }); for (const c of callsBy[d.id] || []) ev.push({ at: c.at, dir: 'out' }); ev.sort((a, b) => new Date(a.at) - new Date(b.at)); const last = ev[ev.length - 1]; if (!last || last.dir !== 'in' || (d.noReplyAt && d.noReplyAt >= last.at)) return null; return { since: last.at, hours: (Date.now() - new Date(last.at)) / 36e5, subject: last.subject || '' }; };
  const age = (h) => (h < 48 ? Math.max(1, Math.round(h)) + ' hours' : Math.round(h / 24) + ' days');
  const line = (d, extra) => ({ id: d.id, text: `${d.practice} (${stageName(d.stage)}, ${money(d.value)}, owner ${name(d.owner)}${extra ? ', ' + extra : ''})` });
  return {
    today, user: first(user.name), scopeAll: !scope,
    newLeads: open.filter((d) => d.stage === 'new' && daysBetween(d.created || today, today) <= 1).map((d) => line(d, `from ${d.source || 'unknown'}${d.aiScore ? ', score ' + d.aiScore : ''}`)),
    uncontacted: open.filter((d) => d.stage === 'new' && daysBetween(d.created || today, today) >= 2).sort((a, b) => (b.aiScore || 0) - (a.aiScore || 0)).slice(0, 5).map((d) => line(d, `waiting ${daysBetween(d.created, today)} days`)),
    closingSoon: open.filter((d) => d.close && daysBetween(today, d.close) <= 7).map((d) => line(d, daysBetween(today, d.close) < 0 ? `expected close ${-daysBetween(today, d.close)} days ago` : `closes in ${daysBetween(today, d.close)} days`)),
    waiting: open.map((d) => ({ d, w: waitingOf(d) })).filter((x) => x.w).sort((a, b) => b.w.hours - a.w.hours).slice(0, 5).map((x) => line(x.d, `${x.d.contact || 'the contact'} emailed ${age(x.w.hours)} ago${x.w.subject ? ' about "' + x.w.subject.slice(0, 60) + '"' : ''} with no reply yet`)),
    stale: open.filter((d) => d.stage !== 'new' && inStage(d) >= 14).sort((a, b) => b.value - a.value).slice(0, 5).map((d) => line(d, `${inStage(d)} days in stage`)),
    overdue: tasks.filter((t) => t.due && t.due < today).map((t) => ({ id: t.deal || 0, practice: t.deal ? ((deals.find((d) => d.id === t.deal) || {}).practice || '') : '', text: `${t.title}${t.deal ? ' for ' + ((deals.find((d) => d.id === t.deal) || {}).practice || 'a deal') : ''} (due ${t.due})` })),
    dueToday: tasks.filter((t) => t.due === today).map((t) => ({ id: t.deal || 0, text: t.title })),
    events: D.listCol('events').filter((e) => e.date === today && (e.who || []).includes(user.id)).map((e) => ({ id: e.deal || 0, text: `${e.allDay ? 'all day' : e.start} ${e.title}` })),
    pipeline: { open: open.length, value: open.reduce((a, d) => a + (Number(d.value) || 0), 0), won7: deals.filter((d) => d.stage === 'won' && d.close && daysBetween(d.close, today) <= 7).length },
    sends: D.listCol('sends').filter((s) => s.finishedAt && daysBetween(s.finishedAt.slice(0, 10), today) <= 1).map((s) => ({ id: 0, text: `"${s.subject}" went to ${s.sent} of ${s.total}${s.failed ? ' (' + s.failed + ' failed)' : ''}` })),
  };
}

// Rule-based briefing: the two or three most pressing things, in priority order.
function byRules(f) {
  const parts = []; const actions = []; const act = (label, id) => { if (id && actions.length < 3 && !actions.some((a) => a.deal === id)) actions.push({ label, deal: id }); };
  const practice = (t) => t.text.split(' (')[0];
  if (f.overdue.length) { parts.push(`${f.overdue.length} task${f.overdue.length === 1 ? ' is' : 's are'} overdue, starting with ${f.overdue[0].text.split(' (')[0]}.`); act(f.overdue[0].practice || 'Overdue task', f.overdue[0].id); }
  if (f.waiting.length) { const d = f.waiting[0]; parts.push(`${f.waiting.length} client email${f.waiting.length === 1 ? ' is' : 's are'} waiting on a reply; the oldest is ${practice(d)} (${d.text.match(/emailed ([^,]+?) ago/)[1]}).`); act(practice(d), d.id); }
  if (f.closingSoon.length) { const d = f.closingSoon[0]; parts.push(`${f.closingSoon.length === 1 ? d.text.split(' (')[0] + ' is' : f.closingSoon.length + ' deals are'} due to close within a week${f.closingSoon.length === 1 ? ' (' + d.text.split(', ').pop() : ''}; make sure the last email is answered.`); act(practice(d), d.id); }
  if (f.newLeads.length) { const d = f.newLeads[0]; parts.push(`${f.newLeads.length} new lead${f.newLeads.length === 1 ? '' : 's'} since yesterday${f.newLeads.length === 1 ? ': ' + practice(d) : ', led by ' + practice(d)}. Call within 24 hours.`); act(practice(d), d.id); }
  if (f.uncontacted.length) { const d = f.uncontacted[0]; parts.push(`${f.uncontacted.length} lead${f.uncontacted.length === 1 ? ' has' : 's have'} sat in New lead for two days or more; ${practice(d)} is the strongest.`); act(practice(d), d.id); }
  if (f.stale.length && parts.length < 3) { const d = f.stale[0]; parts.push(`${practice(d)} has not moved in ${d.text.match(/(\d+) days in stage/)[1]} days; decide whether it is still live.`); act(practice(d), d.id); }
  if (f.sends.length && parts.length < 3) parts.push(`Newsletter ${f.sends[0].text}.`);
  if (!parts.length) parts.push(f.pipeline.open ? `Nothing urgent. ${f.pipeline.open} open deal${f.pipeline.open === 1 ? '' : 's'} worth ${money(f.pipeline.value)}${f.pipeline.won7 ? ', ' + f.pipeline.won7 + ' won this week' : ''}. A good day to work the middle of the pipeline.` : 'Nothing in the pipeline yet. New leads from the website, Google and Meta will show up here as they arrive.');
  return { text: parts.slice(0, 3).join(' '), actions };
}

async function byClaude(f) {
  const list = (k, label) => f[k].length ? `${label}:\n` + f[k].map((x) => `- [deal ${x.id}] ${x.text}`).join('\n') : '';
  const prompt = [
    `You write the two-sentence morning briefing on a CRM dashboard for ${f.user} at Acme Advisory (B2B professional services and workplace financial education). Today is ${f.today}.`,
    'Say what matters most today and why, in plain Australian English, no headings, no bullet points, no em dashes, at most 45 words. Then choose up to three deals to open as buttons, most urgent first.',
    'Return ONLY compact JSON, no prose and no code fences: {"text":"<two sentences>","actions":[{"label":"<practice name, max 4 words>","deal":<deal id integer>}]}',
    '', 'Facts:',
    `Pipeline: ${f.pipeline.open} open deals worth ${money(f.pipeline.value)}, ${f.pipeline.won7} won in the last 7 days.`,
    list('overdue', 'Overdue tasks'), list('dueToday', 'Due today'), list('events', 'Today\'s events'), list('closingSoon', 'Closing within a week'),
    list('newLeads', 'New leads since yesterday'), list('uncontacted', 'Leads not yet worked'), list('waiting', 'Client emails waiting on our reply (oldest first)'), list('stale', 'Stalled deals'), list('sends', 'Newsletter sends'),
  ].filter(Boolean).join('\n');
  const text = await claude.run(prompt);
  const m = text.match(/\{[\s\S]*\}/); if (!m) throw new Error('no json');
  const j = JSON.parse(m[0]);
  const ids = new Set([...f.newLeads, ...f.uncontacted, ...f.waiting, ...f.closingSoon, ...f.stale, ...f.overdue, ...f.dueToday, ...f.events].map((x) => x.id).filter(Boolean));
  const actions = (Array.isArray(j.actions) ? j.actions : []).filter((a) => a && ids.has(Number(a.deal))).slice(0, 3).map((a) => ({ label: String(a.label || '').slice(0, 40), deal: Number(a.deal) }));
  const out = String(j.text || '').replace(/\s+/g, ' ').replace(/—|–/g, ',').trim().slice(0, 400);
  if (!out) throw new Error('empty');
  return { text: out, actions };
}

const key = (uid) => 'brief:' + uid;
async function get(user, { refresh = false } = {}) {
  const day = D.today();
  const cached = D.jobs.get.get(key(user.id));
  if (!refresh && cached && cached.last_run === day) { try { return JSON.parse(cached.detail); } catch (_) { /* rebuild */ } }
  const f = facts(user);
  let out, via = 'rules';
  if (claude.enabled()) { try { out = await byClaude(f); via = 'claude'; } catch (e) { console.error('[brief] claude failed, using rules:', e.message); } }
  if (!out) out = byRules(f);
  const brief = { day, at: D.nowIso(), via, text: out.text, actions: out.actions.map((a) => ({ label: a.label, url: '#/deal/' + a.deal })) };
  D.jobs.set.run(key(user.id), day, JSON.stringify(brief));
  return brief;
}
module.exports = { get, facts, byRules };
