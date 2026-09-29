/**
 * In-browser sample practice for demo mode. Mirrors the API's routes closely
 * enough to click through every screen; changes live until the page reloads.
 */
import {
  TOOLS,
  TOOLS_BY_ID,
  type CalendarEvent,
  type ChatChannel,
  type ChatMessage,
  type Client,
  type DashboardSummary,
  type DocumentRecord,
  type EmailMessage,
  type Task,
  type ToolId,
  type ToolRun,
  type ToolRunEvent,
  type User,
} from '@tms/shared';

let counter = 1000;
const id = (prefix: string) => `${prefix}-${(counter++).toString(16)}-demo`;

const now = () => new Date();
const day = (offset: number) => {
  const d = now();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};
const at = (offsetDays: number, hour: number, minute = 0) => {
  const d = now();
  d.setDate(d.getDate() + offsetDays);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const users: User[] = [
  { id: 'u-alex', name: 'Alex Morgan', email: 'alex@brightday.com.au', role: 'adviser', initials: 'AM', msConnected: true },
  { id: 'u-sam', name: 'Sam Lee', email: 'sam@brightday.com.au', role: 'paraplanner', initials: 'SL' },
  { id: 'u-jordan', name: 'Jordan Patel', email: 'jordan@brightday.com.au', role: 'admin', initials: 'JP' },
];
const me = users[0]!;

const c = (
  key: string,
  name: string,
  type: Client['type'],
  emails: string[],
  platform: string,
  fum: number,
  ongoingFee: number,
  review: number,
  ofa: number,
  notes: string | null = null,
  status: Client['status'] = 'active',
): Client => ({
  id: `c-${key}`,
  name,
  type,
  status,
  emails,
  phone: '04' + String(Math.abs(hash(key)) % 100000000).padStart(8, '0'),
  adviserId: me.id,
  adviserName: me.name,
  platform,
  fum,
  ongoingFee,
  reviewMonth: new Date(day(review)).getMonth() + 1,
  nextReviewDate: day(review),
  ofaRenewalDate: day(ofa),
  notes,
  createdAt: ago(60 * 24 * 400),
});

function hash(s: string) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return h;
}

const clients: Client[] = [
  c('nguyen', 'Harper & Eli Nguyen', 'couple', ['harper.nguyen@outlook.com', 'eli.nguyen@gmail.com'], 'HUB24', 1_240_000, 6600, 9, 26, 'Pre-retirees. Eli retiring March next year; wants TTR strategy reviewed.'),
  c('wilson', 'Wilson Family SMSF', 'smsf', ['trustee@wilsonsmsf.com.au'], 'Netwealth', 2_150_000, 9900, 21, 45, 'Corporate trustee. Property held outside platform.'),
  c('raman', 'Priya Raman', 'individual', ['priya.raman@icloud.com'], 'Macquarie Wrap', 480_000, 3850, 4, 12, 'Accumulation phase, salary sacrificing to cap.'),
  c('okafor', 'Daniel & Ruth Okafor', 'couple', ['dokafor@bigpond.com', 'ruth.okafor@gmail.com'], 'CFS Edge', 910_000, 5500, 38, 61),
  c('chen', 'Mei Chen', 'individual', ['mei.chen@chenarch.com.au'], 'BT Panorama', 1_620_000, 7700, 55, 80, 'Business owner; sale of practice expected FY27.'),
  c('fraser', 'Fraser Holdings Trust', 'trust', ['accounts@fraserholdings.com.au'], 'HUB24', 3_400_000, 13200, 72, 95),
  c('kelly', 'Tom Kelly', 'individual', ['tomkelly88@gmail.com'], 'Netwealth', 265_000, 2750, 110, 130),
  c('rossi', 'Marco & Sofia Rossi', 'couple', ['marco@rossiconstructions.com.au', 'sofia.rossi@outlook.com'], 'Macquarie Wrap', 1_880_000, 8800, 16, 33),
  c('begum', 'Ayesha Begum', 'individual', ['ayesha.begum@health.nsw.gov.au'], '—', 0, 0, 20, 20, 'Referred by Mei Chen. Discovery meeting booked.', 'prospect'),
];
const clientById = (cid: string | null) => clients.find((x) => x.id === cid) ?? null;

const tasks: Task[] = [
  { id: 't1', title: 'Send OFA renewal for signature', notes: 'Renewal falls due within 30 days.', status: 'todo', priority: 'high', dueDate: day(1), clientId: 'c-raman', assigneeId: 'u-alex', createdAt: ago(3000) },
  { id: 't2', title: 'Chase SMSF bank statements from accountant', notes: null, status: 'waiting', priority: 'normal', dueDate: day(-2), clientId: 'c-wilson', assigneeId: 'u-alex', createdAt: ago(9000) },
  { id: 't3', title: 'Prepare annual review pack', notes: 'Run Annual Review tool once HUB24 reports are in.', status: 'in_progress', priority: 'high', dueDate: day(3), clientId: 'c-nguyen', assigneeId: 'u-sam', createdAt: ago(5000) },
  { id: 't4', title: 'Book discovery meeting', notes: null, status: 'done', priority: 'normal', dueDate: day(-5), clientId: 'c-begum', assigneeId: 'u-jordan', createdAt: ago(12000) },
  { id: 't5', title: 'Review tax-loss harvesting ideas before 30 June', notes: null, status: 'todo', priority: 'normal', dueDate: day(0), clientId: 'c-rossi', assigneeId: 'u-alex', createdAt: ago(2000) },
  { id: 't6', title: 'Update fee schedule for Netwealth menu change', notes: null, status: 'todo', priority: 'low', dueDate: day(12), clientId: null, assigneeId: 'u-alex', createdAt: ago(1000) },
  { id: 't7', title: 'File note: phone call re. contributions', notes: null, status: 'todo', priority: 'normal', dueDate: day(2), clientId: 'c-okafor', assigneeId: 'u-alex', createdAt: ago(600) },
  { id: 't8', title: 'Platform switch ROA — sign-off', notes: 'Draft generated; check fee disclosure section.', status: 'todo', priority: 'high', dueDate: day(0), clientId: 'c-chen', assigneeId: 'u-alex', createdAt: ago(300) },
];
const withTaskNames = (t: Task): Task => ({
  ...t,
  clientName: clientById(t.clientId)?.name ?? null,
  assigneeName: users.find((u) => u.id === t.assigneeId)?.name ?? null,
});

const ev = (key: string, subject: string, d: number, h: number, m: number, mins: number, clientId: string | null, online = true, location: string | null = null): CalendarEvent => {
  const client = clientById(clientId);
  return {
    id: `e-${key}`,
    subject,
    start: at(d, h, m),
    end: new Date(new Date(at(d, h, m)).getTime() + mins * 60_000).toISOString(),
    location,
    isOnline: online,
    attendees: client ? client.emails.map((e) => ({ name: e.split('@')[0]!, email: e })) : [],
    clientId,
    clientName: client?.name ?? null,
    webLink: null,
  };
};
const events: CalendarEvent[] = [
  ev('1', 'Annual review — Harper & Eli', 0, 9, 30, 60, 'c-nguyen', false, 'Brightday office, Level 4'),
  ev('2', 'Team huddle', 0, 12, 0, 30, null),
  ev('3', 'SMSF strategy call', 0, 14, 0, 45, 'c-wilson'),
  ev('4', 'Discovery meeting — Ayesha Begum', 1, 10, 0, 60, 'c-begum', false, 'Brightday office, Level 4'),
  ev('5', 'Platform switch discussion', 1, 15, 30, 30, 'c-chen'),
  ev('6', 'Licensee compliance catch-up', 2, 11, 0, 60, null),
  ev('7', 'Contributions strategy', 3, 9, 0, 45, 'c-okafor'),
  ev('8', 'Review prep with Sam', 3, 13, 30, 30, null),
  ev('9', 'Estate planning intro — Rossi', 4, 16, 0, 60, 'c-rossi', false, 'Client home, Balmain'),
  ev('10', 'Quarterly catch-up — Mei Chen', -3, 10, 0, 45, 'c-chen'),
];

const em = (key: string, subject: string, fromName: string, fromEmail: string, minsAgo: number, preview: string, clientId: string | null, isRead = false, att = false): EmailMessage => ({
  id: `m-${key}`,
  subject,
  fromName,
  fromEmail,
  to: [me.email],
  preview,
  receivedAt: ago(minsAgo),
  isRead,
  hasAttachments: att,
  clientId,
  clientName: clientById(clientId)?.name ?? null,
  webLink: null,
});
const emails: EmailMessage[] = [
  em('1', 'Re: Transition to retirement question', 'Eli Nguyen', 'eli.nguyen@gmail.com', 25, 'Thanks Alex, before Thursday could you confirm whether I can keep salary sacrificing once the TTR pension starts?', 'c-nguyen'),
  em('2', 'FY26 financial statements', 'Wilson SMSF Trustee', 'trustee@wilsonsmsf.com.au', 95, 'Hi Alex, attached are the draft financials from our accountant. The property valuation is still outstanding.', 'c-wilson', false, true),
  em('3', 'Signed authority to proceed', 'Mei Chen', 'mei.chen@chenarch.com.au', 180, 'Please find the signed ATP attached for the Panorama to HUB24 switch.', 'c-chen', false, true),
  em('4', 'Menu changes effective 1 November', 'Netwealth Adviser Services', 'adviser@netwealth.com.au', 300, 'We are updating the managed fund menu. Three funds will close to new investment and two will be added.', null, true),
  em('5', 'Question about my statement', 'Priya Raman', 'priya.raman@icloud.com', 60 * 20, 'Hi, my quarterly statement shows a fee I don’t recognise, “admin fee rebate reversal”. Can you explain?', 'c-raman', true),
  em('6', 'Referral: Ayesha Begum', 'Mei Chen', 'mei.chen@chenarch.com.au', 60 * 26, 'Ayesha is a colleague who has just inherited some shares and would like advice. Her details are below.', 'c-chen', true),
  em('7', 'Your ASIC levy invoice', 'ASIC', 'noreply@asic.gov.au', 60 * 30, 'Your industry funding levy invoice for the 2025–26 financial year is now available.', null, true),
  em('8', 'Contribution caps', 'Ruth Okafor', 'ruth.okafor@gmail.com', 60 * 50, 'Daniel and I were wondering if we can use the carry-forward rule this year after the bonus.', 'c-okafor', true),
];

const channels: ChatChannel[] = [
  { id: 'ch-general', name: 'general', description: 'Practice-wide chat', clientId: null, unread: 0 },
  { id: 'ch-para', name: 'paraplanning', description: 'Advice docs and file notes', clientId: null, unread: 2 },
  { id: 'ch-admin', name: 'admin', description: 'Ops, platforms and paperwork', clientId: null, unread: 0 },
];
const msg = (channelId: string, authorId: string, minsAgo: number, body: string, clientId: string | null = null): ChatMessage => ({
  id: id('msg'),
  channelId,
  authorId,
  authorName: users.find((u) => u.id === authorId)!.name,
  body,
  createdAt: ago(minsAgo),
  clientId,
});
const messages: ChatMessage[] = [
  msg('ch-general', 'u-jordan', 240, 'Morning all. Coffee order going in at 9:45 ☕'),
  msg('ch-general', 'u-alex', 230, 'Flat white please. Also reminder the licensee audit sample is due Friday.'),
  msg('ch-general', 'u-sam', 200, 'On it — I’ll pull the file notes for the three sampled clients.'),
  msg('ch-para', 'u-sam', 90, 'Nguyen review pack: HUB24 reports are uploaded. Running the annual review tool now.', 'c-nguyen'),
  msg('ch-para', 'u-sam', 45, 'Chen ROA draft is ready for your sign-off. Fee disclosure table needs the new HUB24 admin fee confirmed.', 'c-chen'),
  msg('ch-admin', 'u-jordan', 600, 'Netwealth menu changes land 1 Nov. I’ve added a task to update our fee schedule.'),
];

const runs: ToolRun[] = [];
const documents: DocumentRecord[] = [];
const runEvents = new Map<string, ToolRunEvent[]>();
let eventId = 1;

function seedRun(tool: ToolId, clientId: string | null, status: ToolRun['status'], minsAgo: number, inputs: Record<string, unknown>, docs: string[], summary: string) {
  const runId = id('run');
  const createdAt = ago(minsAgo);
  runs.push({
    id: runId, tool, status, clientId, clientName: clientById(clientId)?.name ?? null, inputs, summary, error: null,
    costUsd: 1.84, createdById: 'u-sam', createdByName: 'Sam Lee', createdAt, finishedAt: status === 'completed' ? ago(minsAgo - 6) : null,
  });
  for (const filename of docs) {
    documents.push({
      id: id('doc'), runId, clientId, filename, mimeType: filename.endsWith('.xlsx') ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sizeBytes: 48_000 + filename.length * 1000, status: TOOLS_BY_ID[tool].requiresApproval && status !== 'completed' ? 'draft' : 'approved', approvedAt: null, createdAt,
    });
  }
  runEvents.set(runId, scriptFor(tool, clientById(clientId)).map((m, i) => ({ id: eventId++, runId, kind: m.kind, message: m.message, createdAt: new Date(new Date(createdAt).getTime() + i * 20_000).toISOString() })));
}

function scriptFor(tool: ToolId, client: Client | null): { kind: ToolRunEvent['kind']; message: string }[] {
  const def = TOOLS_BY_ID[tool];
  const who = client?.name ?? 'the scenario';
  return [
    { kind: 'status', message: 'Queued' },
    { kind: 'status', message: 'Preparing client context' },
    { kind: 'status', message: `Starting ${def.name}` },
    { kind: 'tool', message: `Loading skill ${def.skill}` },
    { kind: 'tool', message: 'Reading run.json' },
    ...(def.context.includes('emails') ? [{ kind: 'tool' as const, message: 'Reading emails.md' }, { kind: 'text' as const, message: `Found 37 emails and 5 meetings with ${who} in the review period. Key themes: retirement timing, TTR pension, contribution caps.` }] : []),
    { kind: 'tool', message: 'Searching files (inputs/**/*)' },
    { kind: 'tool', message: 'Running: Extract holdings and fees from platform reports' },
    { kind: 'text', message: 'Extracted holdings, fees and transactions from the uploaded reports.' },
    ...def.expectedOutputs.map((o) => ({ kind: 'tool' as const, message: `Writing ${o.replace(/ \(.*\)$/, '')}` })),
    { kind: 'result', message: def.requiresApproval ? `${def.expectedOutputs.length} document(s) ready for adviser review` : `Finished with ${def.expectedOutputs.length} document(s)` },
  ];
}

seedRun('annual-review', 'c-okafor', 'awaiting_review', 60 * 26, { periodStart: day(-365), periodEnd: day(-1), ongoingFee: '$5,500 p.a. incl. GST' },
  ['Annual Review - Daniel & Ruth Okafor - FY26.docx', 'Ongoing Fee Arrangement - Okafor - FY27.docx'],
  'Drafted the FY26 annual review and OFA renewal.\n\nCheck before sending:\n- [[CONFIRM: insurance premiums]] — not in the platform reports\n- Performance figures are net of fees, 1 July to 30 June\n- OFA fee kept at $5,500 p.a. incl. GST as instructed');
seedRun('fee-comparison', 'c-chen', 'completed', 60 * 30, { alternatives: 'HUB24 Choice, Netwealth Accelerator Core' },
  ['Fee comparison - Mei Chen.xlsx', 'Fee comparison summary - Mei Chen.docx'],
  'HUB24 Choice is $2,140 p.a. cheaper than the current BT Panorama position ($1.62m balance). Netwealth Accelerator Core is $1,310 p.a. cheaper. Transaction costs assume current trading frequency.');
seedRun('soa-roa', 'c-chen', 'awaiting_review', 50, { documentType: 'ROA', adviceType: 'platform-switch' },
  ['ROA - Platform switch - Mei Chen.docx'],
  'Drafted a Record of Advice for switching from BT Panorama to HUB24 Choice, referencing the SOA dated 14 March.\n\nConfirm: HUB24 admin fee tiers ([[CONFIRM]] marked in section 4).');
seedRun('tax-optimisation', 'c-rossi', 'completed', 60 * 72, { realisedGains: '$38,400' },
  ['Harvesting schedule - Rossi.xlsx', 'Tax opportunities memo - Rossi.docx'],
  'Identified $27,900 of harvestable losses across 6 parcels, offsetting 73% of realised gains. Two parcels are within 12 months of acquisition; flagged for discount-eligibility timing.');

type Listener<T> = (v: T) => void;
const runListeners = new Map<string, Set<Listener<ToolRunEvent>>>();
const chatListeners = new Set<Listener<ChatMessage>>();

function pushRunEvent(runId: string, kind: ToolRunEvent['kind'], message: string) {
  const e: ToolRunEvent = { id: eventId++, runId, kind, message, createdAt: new Date().toISOString() };
  const list = runEvents.get(runId) ?? [];
  list.push(e);
  runEvents.set(runId, list);
  runListeners.get(runId)?.forEach((fn) => fn(e));
}

function simulateRun(run: ToolRun) {
  const def = TOOLS_BY_ID[run.tool as ToolId];
  const script = scriptFor(run.tool as ToolId, clientById(run.clientId)).slice(1);
  let i = 0;
  const step = () => {
    const live = runs.find((r) => r.id === run.id);
    if (!live || live.status === 'cancelled') return;
    if (i === 1) live.status = 'running';
    const s = script[i++];
    if (!s) return;
    if (s.kind === 'result') {
      const clientName = live.clientName ?? 'Scenario';
      for (const o of def.expectedOutputs) {
        const ext = o.match(/\((\.\w+)\)/)?.[1] ?? '.docx';
        documents.push({
          id: id('doc'), runId: run.id, clientId: run.clientId, filename: `${o.replace(/ \(.*\)$/, '')} - ${clientName}${ext}`,
          mimeType: 'application/octet-stream', sizeBytes: 52_000, status: def.requiresApproval ? 'draft' : 'approved', approvedAt: null, createdAt: new Date().toISOString(),
        });
      }
      live.status = def.requiresApproval ? 'awaiting_review' : 'completed';
      live.summary = `Demo run: in the live portal this is the agent’s summary of what it produced and anything the adviser needs to confirm, e.g. [[CONFIRM: …]] placeholders.`;
      live.costUsd = 1.52;
      live.finishedAt = def.requiresApproval ? null : new Date().toISOString();
    }
    pushRunEvent(run.id, s.kind, s.message);
    setTimeout(step, s.kind === 'text' ? 2200 : 1300);
  };
  setTimeout(step, 600);
}

export function mockRunFeed(runId: string, onEvent: Listener<ToolRunEvent>) {
  (runEvents.get(runId) ?? []).forEach(onEvent);
  let set = runListeners.get(runId);
  if (!set) runListeners.set(runId, (set = new Set()));
  set.add(onEvent);
  return () => set.delete(onEvent);
}

export function mockChatFeed(onMessage: Listener<ChatMessage>) {
  chatListeners.add(onMessage);
  return () => chatListeners.delete(onMessage);
}

const delay = <T,>(v: T, ms = 120) => new Promise<T>((r) => setTimeout(() => r(structuredClone(v)), ms));

class MockError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function formToObject(body: unknown): Record<string, unknown> {
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    const out: Record<string, unknown> = {};
    const files: Record<string, string[]> = {};
    body.forEach((v, k) => {
      if (typeof v === 'string') out[k] = v;
      else (files[k] ??= []).push(`inputs/${k}/${v.name}`);
    });
    return { ...out, files };
  }
  return (body as Record<string, unknown>) ?? {};
}

export async function mockRequest<T>(method: string, fullPath: string, body?: unknown): Promise<T> {
  const url = new URL(fullPath, 'http://demo');
  const p = url.pathname;
  const q = url.searchParams;
  const seg = p.split('/').filter(Boolean); // ['api', ...]
  const b = formToObject(body);
  const r = (v: unknown) => delay(v) as Promise<T>;

  if (p === '/api/me') return r(me);
  if (p === '/api/users') return r(users);
  if (p === '/api/auth/config') return r({ microsoft: true, devLogin: false });
  if (p === '/api/auth/logout') return r({ ok: true });
  if (p === '/api/sync') return r({ queued: true });
  if (p === '/api/sync/status') return r([{ resource: 'calendar', lastSyncedAt: ago(4), lastError: null }, { resource: 'mail:inbox', lastSyncedAt: ago(4), lastError: null }]);
  if (p === '/api/tools') return r(TOOLS);

  if (p === '/api/dashboard') {
    const today = day(0);
    const in7 = day(7);
    const in45 = day(45);
    const summary: DashboardSummary = {
      meetingsToday: events.filter((e) => new Date(e.start).toDateString() === now().toDateString()).sort((a, b2) => a.start.localeCompare(b2.start)),
      tasksDue: tasks.filter((t) => t.assigneeId === me.id && t.status !== 'done' && (t.dueDate ?? '9') <= in7).map(withTaskNames).sort((a, b2) => (a.dueDate ?? '').localeCompare(b2.dueDate ?? '')),
      unreadEmails: emails.filter((e) => !e.isRead && e.clientId),
      reviewsDue: clients
        .filter((x) => x.status === 'active' && [x.nextReviewDate, x.ofaRenewalDate].some((d) => d && d <= in45))
        .sort((a, b2) => (a.nextReviewDate ?? '').localeCompare(b2.nextReviewDate ?? '')),
      recentRuns: [...runs].sort((a, b2) => b2.createdAt.localeCompare(a.createdAt)).slice(0, 6),
      stats: {
        clients: clients.filter((x) => x.status === 'active').length,
        fum: clients.reduce((s, x) => s + (x.fum ?? 0), 0),
        reviewsThisMonth: clients.filter((x) => x.nextReviewDate?.slice(0, 7) === today.slice(0, 7)).length,
        openTasks: tasks.filter((t) => t.status !== 'done').length,
      },
    };
    return r(summary);
  }

  if (seg[1] === 'clients') {
    if (seg.length === 2 && method === 'GET') {
      const term = (q.get('q') ?? '').toLowerCase();
      return r(clients.filter((x) => !term || x.name.toLowerCase().includes(term) || x.emails.some((e) => e.includes(term))).sort((a, b2) => a.name.localeCompare(b2.name)));
    }
    if (seg.length === 2 && method === 'POST') {
      const created: Client = { ...(b as unknown as Client), id: id('c'), adviserName: me.name, createdAt: new Date().toISOString() } as Client;
      clients.push(created);
      return r(created);
    }
    const client = clientById(seg[2]!);
    if (!client) throw new MockError(404, 'Client not found');
    if (seg.length === 3 && method === 'GET') return r(client);
    if (seg.length === 3 && method === 'PATCH') {
      Object.assign(client, b);
      return r(client);
    }
    if (seg[3] === 'activity') {
      return r({
        emails: emails.filter((e) => e.clientId === client.id),
        meetings: events.filter((e) => e.clientId === client.id),
        notes: notes.filter((n) => n.clientId === client.id),
        tasks: tasks.filter((t) => t.clientId === client.id).map(withTaskNames),
        runs: runs.filter((x) => x.clientId === client.id),
        documents: documents.filter((d) => d.clientId === client.id),
      });
    }
    if (seg[3] === 'notes' && method === 'POST') {
      const note = { id: id('n'), clientId: client.id, body: String(b.body ?? ''), createdAt: new Date().toISOString(), authorName: me.name };
      notes.unshift(note);
      return r(note);
    }
  }

  if (seg[1] === 'tasks') {
    if (seg.length === 2 && method === 'GET') {
      const scope = q.get('scope') ?? 'mine';
      const includeDone = q.get('includeDone') === 'true';
      return r(tasks.filter((t) => (scope === 'all' || t.assigneeId === me.id) && (includeDone || t.status !== 'done')).map(withTaskNames));
    }
    if (seg.length === 2 && method === 'POST') {
      const t: Task = { id: id('t'), notes: null, status: 'todo', priority: 'normal', dueDate: null, clientId: null, assigneeId: me.id, createdAt: new Date().toISOString(), ...(b as Partial<Task>), title: String(b.title) };
      tasks.push(t);
      return r(withTaskNames(t));
    }
    const t = tasks.find((x) => x.id === seg[2]);
    if (!t) throw new MockError(404, 'Task not found');
    if (method === 'PATCH') {
      Object.assign(t, b);
      return r(withTaskNames(t));
    }
    if (method === 'DELETE') {
      tasks.splice(tasks.indexOf(t), 1);
      return r(undefined);
    }
  }

  if (p === '/api/calendar') {
    const from = q.get('from') ?? '';
    const to = q.get('to') ?? '';
    return r(events.filter((e) => e.end >= from && e.start < to).sort((a, b2) => a.start.localeCompare(b2.start)));
  }

  if (seg[1] === 'emails') {
    if (method === 'PATCH') {
      const e = emails.find((x) => x.id === seg[2]);
      if (e) {
        e.clientId = (b.clientId as string | null) ?? null;
        e.clientName = clientById(e.clientId)?.name ?? null;
      }
      return r({ ok: true });
    }
    const filter = q.get('filter') ?? 'all';
    const term = (q.get('q') ?? '').toLowerCase();
    return r(
      emails.filter(
        (e) =>
          (filter === 'all' || (filter === 'clients' && e.clientId) || (filter === 'unlinked' && !e.clientId) || (filter === 'unread' && !e.isRead)) &&
          (!term || `${e.subject} ${e.fromName} ${e.fromEmail}`.toLowerCase().includes(term)),
      ),
    );
  }

  if (seg[1] === 'chat') {
    if (p === '/api/chat/channels' && method === 'GET') return r(channels);
    if (p === '/api/chat/channels' && method === 'POST') {
      const ch: ChatChannel = { id: id('ch'), name: String(b.name).toLowerCase().replace(/[^a-z0-9-]+/g, '-'), description: (b.description as string) ?? null, clientId: null, unread: 0 };
      channels.push(ch);
      return r(ch);
    }
    const ch = channels.find((x) => x.id === seg[3]);
    if (!ch) throw new MockError(404, 'Channel not found');
    if (seg[4] === 'read') {
      ch.unread = 0;
      return r({ ok: true });
    }
    if (seg[4] === 'messages' && method === 'GET') return r(messages.filter((m) => m.channelId === ch.id));
    if (seg[4] === 'messages' && method === 'POST') {
      const m: ChatMessage = { id: id('msg'), channelId: ch.id, authorId: me.id, authorName: me.name, body: String(b.body), createdAt: new Date().toISOString(), clientId: (b.clientId as string) ?? null };
      messages.push(m);
      setTimeout(() => chatListeners.forEach((fn) => fn(m)), 50);
      if (ch.name === 'paraplanning') {
        setTimeout(() => {
          const reply = msg(ch.id, 'u-sam', 0, 'Got it, I’ll take a look this afternoon.');
          messages.push(reply);
          chatListeners.forEach((fn) => fn(reply));
        }, 2500);
      }
      return r(m);
    }
  }

  if (seg[1] === 'tools' && seg[3] === 'runs' && method === 'POST') {
    const tool = TOOLS_BY_ID[seg[2] as ToolId];
    if (!tool) throw new MockError(404, 'Unknown tool');
    for (const f of tool.fields) {
      const present = f.kind === 'files' ? !!(b.files as Record<string, string[]>)?.[f.key]?.length : !!b[f.key];
      if (f.required && !present) throw new MockError(400, `${f.label} is required`);
    }
    const clientId = (b.clientId as string) || null;
    const run: ToolRun = {
      id: id('run'), tool: tool.id, status: 'queued', clientId, clientName: clientById(clientId)?.name ?? null, inputs: b, summary: null,
      error: null, costUsd: null, createdById: me.id, createdByName: me.name, createdAt: new Date().toISOString(), finishedAt: null,
    };
    runs.push(run);
    runEvents.set(run.id, [{ id: eventId++, runId: run.id, kind: 'status', message: 'Queued', createdAt: run.createdAt }]);
    simulateRun(run);
    return r(run);
  }

  if (seg[1] === 'runs') {
    if (seg.length === 2) {
      const cid = q.get('clientId');
      const tool = q.get('tool');
      return r(runs.filter((x) => (!cid || x.clientId === cid) && (!tool || x.tool === tool)).sort((a, b2) => b2.createdAt.localeCompare(a.createdAt)));
    }
    const run = runs.find((x) => x.id === seg[2]);
    if (!run) throw new MockError(404, 'Run not found');
    if (seg[3] === 'cancel') {
      run.status = 'cancelled';
      pushRunEvent(run.id, 'result', 'Run cancelled');
      return r({ ok: true });
    }
    return r({ ...run, documents: documents.filter((d) => d.runId === run.id) });
  }

  if (seg[1] === 'documents' && seg[3] === 'decision') {
    const doc = documents.find((d) => d.id === seg[2]);
    if (!doc) throw new MockError(404, 'Document not found');
    doc.status = b.decision as DocumentRecord['status'];
    doc.approvedAt = new Date().toISOString();
    doc.approvedByName = me.name;
    const run = runs.find((x) => x.id === doc.runId);
    if (run && documents.filter((d) => d.runId === run.id).every((d) => d.status === 'approved')) {
      run.status = 'completed';
      run.finishedAt = new Date().toISOString();
    }
    return r(doc);
  }

  throw new MockError(404, `Demo mode has no handler for ${method} ${p}`);
}

const notes = [
  { id: 'n1', clientId: 'c-nguyen', body: 'Phone call with Eli. Confirmed retirement date of 31 March. Wants to understand how the TTR pension interacts with salary sacrifice. Agreed to cover at annual review.', createdAt: ago(60 * 24 * 12), authorName: 'Alex Morgan' },
  { id: 'n2', clientId: 'c-nguyen', body: 'HUB24 reports downloaded for FY26: performance, transactions, fee summary, CGT.', createdAt: ago(60 * 24 * 2), authorName: 'Sam Lee' },
  { id: 'n3', clientId: 'c-chen', body: 'Mei signed ATP for platform switch. Proceed with ROA.', createdAt: ago(60 * 3), authorName: 'Alex Morgan' },
];
