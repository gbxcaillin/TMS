'use strict';
/* Start the workspace fresh: remove the working records (leads, clients, tasks, activity, files, chat,
 * calendar, invoices, notifications, sends, logs) while keeping everything that is configuration or
 * identity: user accounts and sign-in links, settings, stages, sources, fields, routing, API keys,
 * push devices, connected mailboxes, the research library and model portfolios, nurture sequences,
 * and mailing-list subscribers. A backup is written first. Deletions go through the normal record
 * path, so every signed-in browser removes the records on its next sync.
 *
 * Inside the container (from /root/familyoffice on the VPS):
 *   docker compose exec crm node server/tools/reset-data.js              # dry run: shows what would go
 *   docker compose exec crm node server/tools/reset-data.js --yes        # backs up, then wipes
 * Options: --wipe-subscribers  --wipe-research  --wipe-sequences  --wipe-audit
 */
const fs = require('node:fs');
const path = require('node:path');
const D = require('../lib/db');

const args = new Set(process.argv.slice(2));
const YES = args.has('--yes');
const WIPE = ['deals', 'clients', 'tasks', 'activity', 'changes', 'threads', 'files', 'notifs', 'events', 'messages', 'invoices', 'enrolments', 'sends'];
if (args.has('--wipe-subscribers')) WIPE.push('subscribers');
if (args.has('--wipe-research')) WIPE.push('securities', 'models');
if (args.has('--wipe-sequences')) WIPE.push('sequences');
const KEEP = Object.keys(D.COLS).filter((c) => !WIPE.includes(c));

const counts = {}; for (const c of Object.keys(D.COLS)) counts[c] = D.listCol(c).length;
const logs = { mail_log: D.db.prepare('SELECT COUNT(*) n FROM mail_log').get().n, webhook_log: D.db.prepare('SELECT COUNT(*) n FROM webhook_log').get().n, push_log: D.db.prepare('SELECT COUNT(*) n FROM push_log').get().n, job_state: D.db.prepare('SELECT COUNT(*) n FROM job_state').get().n, send_items: D.db.prepare('SELECT COUNT(*) n FROM send_items').get().n };
console.log(`Database: ${D.DB_PATH}`);
console.log('Will remove:   ' + WIPE.map((c) => `${c} ${counts[c]}`).join(', '));
console.log('Will keep:     ' + KEEP.map((c) => `${c} ${counts[c]}`).join(', ') + `, users ${D.users.all().length}, settings and every other kv key, API keys, push devices, connected mailboxes, market cache${args.has('--wipe-audit') ? '' : ', audit log'}`);
console.log('Logs cleared:  ' + Object.entries(logs).map(([k, n]) => `${k} ${n}`).join(', ') + '; kv campaigns reset; chat rooms reset to General and Pipeline with every active user');
if (!YES) { console.log('\nDry run. Add --yes to do it (a backup is taken first).'); process.exit(0); }

const dir = path.join(D.DATA_DIR, 'backups'); fs.mkdirSync(dir, { recursive: true });
const bak = path.join(dir, `pre-reset-${D.nowIso().replace(/[:T]/g, '-').slice(0, 16)}.db`);
D.backup(bak); console.log(`\nBackup written: ${bak}`);

let removed = 0;
D.transaction(() => {
  for (const c of WIPE) for (const r of D.listCol(c)) { D.delRecord(c, r[D.COLS[c]], 'system'); removed++; }
  D.db.prepare('DELETE FROM send_items').run(); D.db.prepare('DELETE FROM send_jobs').run();
  D.db.prepare('DELETE FROM mail_log').run(); D.db.prepare('DELETE FROM webhook_log').run(); D.db.prepare('DELETE FROM push_log').run(); D.db.prepare('DELETE FROM job_state').run();
  if (args.has('--wipe-audit')) D.db.prepare('DELETE FROM audit').run();
  D.kvSet('campaigns', {});
  const ids = D.users.all().filter((u) => u.status === 'Active').map((u) => u.id);
  for (const r of D.listCol('rooms')) D.delRecord('rooms', r.id, 'system');
  D.putRecord('rooms', { id: 'general', name: 'General', kind: 'room', members: ids, desc: 'Whole team' }, 'system');
  D.putRecord('rooms', { id: 'pipeline', name: 'Pipeline', kind: 'room', members: ids, desc: 'Deals, proposals, closes' }, 'system');
})();
D.audit('system', '', 'data.reset', WIPE.join(','), `${removed} records removed; backup ${path.basename(bak)}`);
console.log(`Done: ${removed} records removed. Open browsers pick up the change on their next sync (within 15 seconds); a hard refresh is not needed.`);
