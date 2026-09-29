// Writes what a tool needs from the CRM into <run>/context/ as plain files, so the agent reads files and never has
// CRM or database access. Only the context the tool declares is written.
import fs from 'node:fs';
import path from 'node:path';

const inPeriod = (iso, p) => !p || (!!iso && iso.slice(0, 10) >= p.start && iso.slice(0, 10) <= p.end);

export function periodFor(inputs) {
  if (!inputs.periodStart && !inputs.periodEnd) return null;
  const end = inputs.periodEnd || new Date().toISOString().slice(0, 10);
  const start = inputs.periodStart || new Date(Date.parse(end) - 365 * 864e5).toISOString().slice(0, 10);
  return { start, end };
}

export function writeContext(runDir, tool, recs, inputs) {
  const dir = path.join(runDir, 'context');
  fs.mkdirSync(dir, { recursive: true });
  const written = [];
  const put = (name, text) => { fs.writeFileSync(path.join(dir, name), text); written.push('context/' + name); };
  if (!recs) return written;
  const { client, users } = recs;
  const period = periodFor(inputs);
  const who = (ids) => (ids || []).map((id) => users[id] || id).join(', ');

  if (tool.context.includes('client')) {
    const { deals, ...profile } = client;
    put('client.json', JSON.stringify({ ...profile, owner: users[client.owner] || client.owner, deals: recs.deals.map((d) => ({ id: d.id, title: d.practice || d.title, stage: d.stage, value: d.value, notes: d.notes })) }, null, 2));
  }
  if (tool.context.includes('emails')) {
    const msgs = [];
    for (const t of recs.threads) for (const m of t.msgs || []) if (inPeriod(m.at, period)) msgs.push({ subject: t.subject, ...m, contact: t.from });
    msgs.sort((a, b) => String(a.at).localeCompare(String(b.at)));
    const body = msgs.map((m) => `## ${m.subject || '(no subject)'}\nDate: ${m.at}\n${m.out ? 'From: ' + (m.from || 'the practice') + ' (sent)' : 'From: ' + (m.from || m.contact)}\n\n${m.body || m.preview || ''}`).join('\n\n---\n\n');
    put('emails.md', `# Correspondence${period ? ` ${period.start} to ${period.end}` : ''} (${msgs.length} emails)\n\n${body || 'No emails with this client in the CRM for the period.'}`);
  }
  if (tool.context.includes('meetings')) {
    const ev = recs.events.filter((e) => inPeriod(e.start, period)).sort((a, b) => String(a.start).localeCompare(String(b.start)))
      .map((e) => ({ title: e.title, kind: e.kind, start: e.start, end: e.end, attendees: who(e.who), notes: e.notes || '' }));
    put('meetings.json', JSON.stringify(ev, null, 2));
  }
  if (tool.context.includes('notes')) {
    const acts = recs.activity.filter((a) => inPeriod(a.at, period)).sort((a, b) => String(a.at).localeCompare(String(b.at)))
      .map((a) => `## ${String(a.at).slice(0, 16).replace('T', ' ')} · ${a.type || 'note'}${a.who ? ' · ' + (users[a.who] || a.who) : ''}\n${a.text || ''}${a.detail ? '\n' + a.detail : ''}`);
    put('file-notes.md', `# File notes and activity\n\n${client.notes ? '## Client profile notes\n' + client.notes + '\n\n' : ''}${acts.join('\n\n') || 'No activity recorded for the period.'}`);
  }
  if (tool.context.includes('tasks')) {
    put('tasks.json', JSON.stringify(recs.tasks.map((t) => ({ title: t.title, detail: t.desc || '', due: t.due, done: !!t.done, assigned: who(t.who) })), null, 2));
  }
  return written;
}
