'use strict';
// Access levels: what each part of the CRM a user may use. Admins (full access) can do everything and
// cannot be restricted. Every other level starts from the defaults below, the workspace's own matrix in
// settings.access.levels overrides those, and a user's own perms override the level. The client keeps a
// copy of LEVELS, FUNCTIONS and DEFAULTS (wireframe.html, "ACCESS") for the settings screen; keep them in step.

const LEVELS = [
  { key: 'admin', role: 'Admin', label: 'Admin (full access)', desc: 'Everything, including team, access levels and security. Cannot be restricted.' },
  { key: 'manager', role: 'Manager', label: 'Manager', desc: 'Runs the practice day to day.' },
  { key: 'paraplanner', role: 'Paraplanner', label: 'Paraplanner', desc: 'Prepares advice and research.' },
  { key: 'clientmanager', role: 'Client manager', label: 'Client manager', desc: 'Looks after their own clients.' },
  { key: 'basic', role: 'Basic', label: 'Basic', desc: 'The essentials: the day-to-day sections and nothing to configure.' },
];
const ROLES = LEVELS.map((l) => l.role);
const LEGACY = { Member: 'Client manager' };

const FUNCTIONS = [
  { id: 'dashboard', label: 'Dashboard', group: 'Sections' },
  { id: 'pipeline', label: 'Pipeline and leads', group: 'Sections' },
  { id: 'clients', label: 'Clients', group: 'Sections' },
  { id: 'tasks', label: 'Tasks', group: 'Sections' },
  { id: 'calendar', label: 'Calendar', group: 'Sections' },
  { id: 'email', label: 'Email', group: 'Sections' },
  { id: 'calls', label: 'Calls', group: 'Sections' },
  { id: 'chat', label: 'Chat', group: 'Sections' },
  { id: 'mailing', label: 'Mailing list and newsletters', group: 'Sections' },
  { id: 'nurture', label: 'Nurture sequences', group: 'Sections' },
  { id: 'files', label: 'Files', group: 'Sections' },
  { id: 'invoices', label: 'Invoices', group: 'Sections' },
  { id: 'reports', label: 'Reports', group: 'Sections' },
  { id: 'research', label: 'Research and models', group: 'Sections' },
  { id: 'integrations', label: 'Integrations', group: 'Configure' },
  { id: 'workspace', label: 'Workspace settings (fields, stages, invoicing, research, storage)', group: 'Configure' },
  { id: 'routing', label: 'Lead routing', group: 'Configure' },
  { id: 'allRecords', label: "See everyone's deals and clients (off: only their own)", group: 'Data' },
  { id: 'deleteRecords', label: 'Delete deals, clients and invoices', group: 'Data' },
  { id: 'exportData', label: 'Export CSV files', group: 'Data' },
];
const FN_IDS = FUNCTIONS.map((f) => f.id);
const on = (...ids) => Object.fromEntries(FN_IDS.map((id) => [id, ids.includes(id)]));
// Starting points only; the owner sets the real matrix under Settings, Access levels.
const DEFAULTS = {
  admin: on(...FN_IDS),
  manager: on('dashboard', 'pipeline', 'clients', 'tasks', 'calendar', 'email', 'calls', 'chat', 'mailing', 'nurture', 'files', 'invoices', 'reports', 'research', 'integrations', 'workspace', 'allRecords', 'deleteRecords', 'exportData'),
  paraplanner: on('dashboard', 'pipeline', 'clients', 'tasks', 'calendar', 'email', 'calls', 'chat', 'files', 'reports', 'research', 'allRecords', 'exportData'),
  clientmanager: on('dashboard', 'pipeline', 'clients', 'tasks', 'calendar', 'email', 'calls', 'chat', 'files', 'invoices'),
  basic: on('dashboard', 'pipeline', 'clients', 'tasks', 'calendar', 'email', 'calls', 'chat', 'mailing', 'files', 'invoices', 'allRecords', 'exportData'),
};

function levelOf(role) { const r = LEGACY[role] || role; const l = LEVELS.find((x) => x.role === r); return l ? l.key : 'clientmanager'; }
function roleOf(key) { const l = LEVELS.find((x) => x.key === key); return l ? l.role : 'Client manager'; }
function normRole(role) { const r = LEGACY[role] || role; return ROLES.includes(r) ? r : null; }

// The workspace matrix, cleaned: only known levels and functions, booleans only. Admin is never stored.
function cleanAccess(a) {
  a = a && typeof a === 'object' ? a : {};
  const levels = {};
  for (const l of LEVELS) { if (l.key === 'admin' || !a.levels || !a.levels[l.key]) continue; const src = a.levels[l.key]; const row = {}; for (const id of FN_IDS) if (typeof src[id] === 'boolean') row[id] = src[id]; levels[l.key] = row; }
  const dl = LEVELS.find((x) => x.key === a.defaultLevel && x.key !== 'admin') ? a.defaultLevel : 'clientmanager';
  return { defaultLevel: dl, levels };
}
function cleanPerms(p) { if (!p || typeof p !== 'object') return null; const out = {}; for (const id of FN_IDS) if (typeof p[id] === 'boolean') out[id] = p[id]; return Object.keys(out).length ? out : null; }

// Effective permissions for a user: level defaults < workspace matrix < the user's own overrides.
function resolve(user, settings) {
  const key = levelOf(user && user.role);
  if (key === 'admin') return { ...DEFAULTS.admin, level: 'admin', admin: true };
  const ws = ((settings && settings.access && settings.access.levels) || {})[key] || {};
  let own = (user && user.perms) || {};
  if (typeof own === 'string') { try { own = JSON.parse(own); } catch (e) { own = {}; } }
  if (!own || typeof own !== 'object') own = {};
  const out = {};
  for (const id of FN_IDS) out[id] = typeof own[id] === 'boolean' ? own[id] : typeof ws[id] === 'boolean' ? ws[id] : !!DEFAULTS[key][id];
  return { ...out, level: key, admin: false };
}

// Which function owns each synced collection. Core records (deals, clients, tasks, events, activity,
// files, notifs, changes) always sync so cards and links keep working; a section's own data stays on
// the server when that section is off.
const COL_READ = { messages: 'chat', rooms: 'chat', threads: 'email', subscribers: 'mailing', sends: 'mailing', sequences: 'nurture', enrolments: 'nurture', invoices: 'invoices', models: 'research', securities: 'research', calls: 'calls' };
const COL_WRITE = { ...COL_READ, deals: 'pipeline', clients: 'clients', tasks: 'tasks', events: 'calendar', files: 'files', activity: 'clients' };
const KV_READ = { watchlist: 'research' };
const KV_WRITE = { fields: 'workspace', stages: 'workspace', sources: 'workspace', colors: 'workspace', campaigns: 'reports', spend: 'reports', watchlist: 'research' };
const DELETE_GUARDED = ['deals', 'clients', 'invoices'];
// API paths that belong to one section; anything else is open to every signed-in user.
const PATHS = [
  [/^\/(leads|stages)\b/, 'pipeline'], [/^\/(subscribers|newsletter)\b/, 'mailing'], [/^\/(nurture|sequences|enrolments)\b/, 'nurture'],
  [/^\/invoices\b/, 'invoices'], [/^\/(research|models|market)\b/, 'research'], [/^\/calls\b/, 'calls'], [/^\/files\b/, 'files'],
  [/^\/mail\b/, 'email'], [/^\/email\b/, 'email'], [/^\/calendar\b/, 'calendar'], [/^\/(brief|analytics)\b/, 'dashboard'], [/^\/integrations\b/, 'integrations'],
];
function pathFunction(p) { for (const [re, fn] of PATHS) if (re.test(p || '')) return fn; return null; }

module.exports = { LEVELS, ROLES, FUNCTIONS, FN_IDS, DEFAULTS, levelOf, roleOf, normRole, cleanAccess, cleanPerms, resolve, COL_READ, COL_WRITE, KV_READ, KV_WRITE, DELETE_GUARDED, pathFunction };
