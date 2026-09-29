# Deploying portal.brightday.com.au

The CRM rides on the same Sydney VPS as `office.brightday.com.au` and
`play.brightday.com.au`: one Docker Compose stack, one front Caddy doing HTTPS.

**What this deploys:** the full app. A Node server (`server/`) keeps the
shared workspace in SQLite, handles login and invites, receives lead
webhooks, sends push notifications and email, talks to SharePoint through
Microsoft Graph, pulls market data from Yahoo Finance, and backs the
database up nightly. It also serves the installable PWA (`dist/`).

## First-time setup

```bash
ssh root@YOUR_SERVER_IP
cd /root/crm && git pull                       # already cloned during the preview
cp .env.production.example .env.production
node server/tools/keygen.js 2>/dev/null || docker run --rm -v /root/crm:/app -w /app node:22-alpine node server/tools/keygen.js
# paste the printed key into .env.production as  DATA_KEYS=v1:<key>  and keep a copy off the server
chmod 600 .env.production
mkdir -p /root/crm-data && chown -R 1000:1000 /root/crm-data && chmod 700 /root/crm-data
sudo bash deploy/harden.sh                      # once per VPS: updates, firewall, fail2ban, SSH keys only
```

The server will not start in production without `DATA_KEYS`; see
`SECURITY.md` for what it protects and how to rotate it.

Replace the `crm:` service in `/root/familyoffice/docker-compose.yml` with the
one in `deploy/compose-service.yml` (it adds the env file and the data
volume), and replace the `portal.brightday.com.au` block in
`/root/familyoffice/deploy/Caddyfile` with `deploy/caddy-site.txt`
(`reverse_proxy crm:3000`, no `basic_auth`). Then:

```bash
cd /root/familyoffice
docker compose config >/dev/null && echo compose OK
docker compose up -d --build crm
docker compose up -d --force-recreate caddy   # picks up the edited Caddyfile
docker compose logs -f crm           # "[boot] Brightday Portal on :3000 · db /app/data/crm.db · dist ok"
```

**Applying Caddyfile changes:** the Caddyfile is a read-only single-file bind
mount, so use `docker compose up -d --force-recreate caddy`, not
`docker compose exec caddy caddy reload`. Editing the file on the host (with an
editor or `sed -i`) replaces its inode; the running container keeps the old
inode mounted, so a plain `reload` re-reads the *pre-edit* file and your change
silently does nothing. Recreating the container re-establishes the mount against
the current file. (This once caused a persistent `502` with Caddy dialing the
wrong upstream port even though the host file looked correct.)

Open https://portal.brightday.com.au. The database is empty, so the app shows
**Create the first admin**. Set your own account, then invite the team under
Settings → Team. Without email configured, each invite shows a one-time link
to send yourself.

Set `DEMO_DATA=1` in `.env.production` before the first visit if you want the
sample deals, tasks and chat loaded into the new workspace.

## Updating

```bash
/root/crm/deploy/update.sh          # defaults to main
```

Rebuilds only the `crm` container; the data volume is untouched. Browsers
pick up the new shell on next load (`index.html` and `sw.js` are served
`no-cache`).

### Automatic deploys

`deploy/autodeploy.sh` makes merged pull requests go live on their own. Cron
runs it every 5 minutes; it fetches `origin/main` and, only when main has
moved, runs `update.sh`. Nothing reaches into the server: no keys in GitHub,
no open ports, and Cloudflare Access is untouched. Switch it on once:

```bash
/root/crm/deploy/update.sh                 # get the script onto the server
/root/crm/deploy/autodeploy.sh --install   # adds the cron entry, runs one check now
```

| Command | What it does |
|---|---|
| `autodeploy.sh --status` | Live commit, whether a rollback hold is on, the last five log lines |
| `autodeploy.sh --rollback` | Rebuilds the commit that was live before the last deploy and holds auto deploy |
| `autodeploy.sh --resume` | Lifts the hold, checks out main and deploys it again |
| `autodeploy.sh --remove` | Takes the cron entry out; deploys are manual again |

Every deploy, failure or rollback is one line in `/var/log/crm-autodeploy.log`
(the rebuild output sits above it). A failed rebuild is logged once and not
retried: the checkout has already moved, so fix forward with a new merge or
run `--rollback`. If the checkout on the server is on a branch other than
main (testing something by hand), the script logs a skip and leaves it alone.

With this on, everything merged to main is live within five minutes, so
unfinished work stays on a branch.

## Switching features on

Everything below is optional and turns on when its variables are set in
`/root/crm/.env.production` (then `docker compose up -d crm`).

| Feature | Variables | Notes |
|---|---|---|
| Email (invites, resets, task and lead alerts, digests, invoices, newsletters) | `RESEND_API_KEY` plus `MAIL_FROM`, `MAIL_CAMPAIGN_FROM`, `MAIL_REPLY_TO`, `MAIL_WEBHOOK_SECRET` | See *Email deliverability* below. Test from Integrations → Server → *Send me a test email*. |
| SharePoint files | `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `SP_SITE`, `SP_LIBRARY`, optional `SP_FOLDER`, optional `SP_INVOICE_FOLDER` | Azure app registration with application permission `Sites.Selected` (grant it on the site) or `Sites.ReadWrite.All`. `SP_LIBRARY` is a document library display name (default library is `Documents`); optional `SP_FOLDER` nests per-client folders under a base folder inside it (e.g. `SP_LIBRARY=Documents`, `SP_FOLDER=Client Files`). Files upload to `<library>/<folder>/<Client>/`; nightly DB backups also copy to `<library>/<folder>/_CRM Backups/`. Invoice PDFs save to `<library>/<SP_INVOICE_FOLDER>/` (default `Invoices`) as drafts, then the invoice can be emailed from the CRM (PDF attached) or downloaded from SharePoint and sent manually. Emailing invoices needs email configured (below) with `Mail.Send` if using Graph. |
| Claude lead scoring (automatic) | the Claude helper (`CLAUDE_HELPER_SOCKET`) | With the helper on, every new lead is scored within about five minutes and the score, priority and rationale land on the lead. Switch off under Settings → Claude triggers → Score. Research pages get *Draft research note* and *Compare peers* the same way. |
| Microsoft Bookings | `BOOKINGS_BUSINESS` + the `MS_*` app | Grant the Graph app the application permission `Bookings.Read.All` (in the tenant that owns the booking mailbox), then set `BOOKINGS_BUSINESS` to the booking business id (usually the booking mailbox address). Booked calls sync every 15 min into activity + a task on the matching lead, or become a new lead. Trigger on demand with `POST /api/v1/integrations/bookings/sync` (admin). |
| Google Ads lead forms | `GOOGLE_ADS_KEY` | In Google Ads → lead form asset → *Lead delivery option* → Webhook: URL `https://portal.brightday.com.au/api/v1/hooks/google-ads`, key = the same string. Use *Send test data* to check. |
| Meta Lead Ads | `META_VERIFY_TOKEN`, `META_APP_SECRET`, `META_PAGE_TOKEN` | Meta app → Webhooks → Page → `leadgen`, callback `https://portal.brightday.com.au/api/v1/hooks/meta`. The page token needs `leads_retrieval` and `pages_manage_ads`. Zapier or a similar relay can instead POST straight to `/api/v1/hooks/lead` with an API key. |
| Push | none | VAPID keys are generated into `/root/crm-data/vapid.json` on first boot. Users turn push on per device under Settings → Notifications. |
| Market data | none | Yahoo Finance via `yahoo-finance2`; quotes cached 15 min, history 12 h, profiles 7 days, stored securities refreshed every `refreshMins` (Settings, Research). An empty library is filled with the starter set on the first refresh after setup. |
| Fund reference data | SharePoint (`SP_*`) for the automatic re-import | Morningstar ETF and managed fund screener exports (CSV) in `<SP_FOLDER>/Research/Reference data`, re-imported hourly when a file changes, or uploaded under Settings, Research. Kept in `DATA_DIR/refdata.json`. |
| Website analytics | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_SITE_TAG` | Read-only Cloudflare Web Analytics for brightday.com.au on the dashboard "Website → pipeline" tile (visits, page views, 7-day trend next to leads and pipeline). Token needs `Account Analytics: Read`; the site tag is the Web Analytics RUM site tag (a 32-char hex id, **not** the JS beacon token, which differs) - find it in the Web Analytics dashboard URL or by listing `rumPageloadEventsAdaptiveGroups` grouped by `dimensions.siteTag`. Cached 15 min; refresh on demand from Integrations → Website analytics or `POST /api/v1/integrations/cloudflare/sync` (admin). |
| First admin from env | `ADMIN_NAME/EMAIL/PASSWORD` | Alternative to the setup form. Only read when the database is empty. |
| Microsoft 365 sign-in (click-by-click guide: `deploy/SSO.md`) | `SSO_CLIENT_ID`, `SSO_CLIENT_SECRET`, `SSO_TENANT` | Entra app registration (Web platform) with redirect URI `https://portal.brightday.com.au/api/v1/auth/microsoft/callback` and the `openid profile email` scopes. Entra's MFA and conditional access then govern sign-in. `SSO_AUTO_PROVISION=1` + `SSO_DOMAIN` lets any tenant user in on the default access level without an invite. |
| Softphone calls (JustCall, Dialpad, Aircall) | `CALLS_WEBHOOK_SECRET` (+ `DIALPAD_API_KEY`, or `AIRCALL_API_ID`/`AIRCALL_API_TOKEN`/`AIRCALL_WEBHOOK_TOKEN`) | In the provider, add a webhook for finished calls pointing at `https://portal.brightday.com.au/api/v1/hooks/calls/<provider>/<secret>`. JustCall (Team plan and up) sends recording link, transcript and AI summary in the payload. Dialpad needs a company API key to fetch transcripts (API access is on Pro and up). Aircall: subscribe the webhook to `call.ended`, `call.voicemail_left`, `call.commented`, `message.sent`, `message.received` and, with AI Assist, `summary.created` and `transcription.created`. Calls, texts and Aircall comments match deals and clients by phone number and appear under Calls and on the deal's notes and timeline. |
| Email on the card | none (uses connected mailboxes) | Every 15 minutes the `mailsync` job logs inbox and sent messages to or from a deal or client contact on that record's timeline, with an Open in Outlook link. |
| Connected mailboxes (per-user email) | the `MS_*` app (falls back to `SSO_*` only when `MS_*` is unset) | Lets each user connect their own Microsoft 365 inbox (Settings → Email accounts → Connect a mailbox) so the CRM can read recent mail, draft replies with Claude and send as them. On whichever app it uses, add **delegated** permissions `Mail.Read`, `Mail.Send`, `Calendars.ReadWrite` (for the calendar sync), `offline_access`, `openid`, `email` (Grant admin consent), and add the **Web** redirect URI `https://portal.brightday.com.au/api/v1/mail/connect/callback`. Tokens are stored encrypted on the server (never synced to browsers) and refresh automatically. No new env vars. It uses the `MS_*` app; refresh tokens are bound to the app that issued them, so adding `SSO_*` later does not disturb connected mailboxes. |

## Claude agent / API

A ready-made agent that scores new leads with headless Claude Code (your
subscription, no API key) lives in `deploy/agent/` - see `deploy/agent/README.md`
for setup and the cron entry.

To drive the API yourself, create a key under Integrations → API keys (scopes
`deals:read`, `deals:write`, `ai:write`). Then:

```bash
curl -H "Authorization: Bearer brightday_live_…" https://portal.brightday.com.au/api/v1/leads?stage=new
curl -H "Authorization: Bearer brightday_live_…" https://portal.brightday.com.au/api/v1/leads/13
curl -H "Authorization: Bearer brightday_live_…" -H 'content-type: application/json' \
  -X PATCH https://portal.brightday.com.au/api/v1/leads/13 -d '{"priority":"High","owner":"u1"}'
curl -H "Authorization: Bearer brightday_live_…" -H 'content-type: application/json' \
  -X POST https://portal.brightday.com.au/api/v1/leads/13/activity \
  -d '{"text":"Claude scored lead 81 / 100","detail":"Segment fit, paid campaign match","score":81,"notifyOwner":true}'
curl -H "Authorization: Bearer brightday_live_…" -H 'content-type: application/json' \
  -X POST https://portal.brightday.com.au/api/v1/leads \
  -d '{"practice":"Riverbend FA","contact":"Olivia Grant","email":"olivia@riverbendfa.com.au","source":"referral","value":41000}'
```

Duplicates (same email, same email domain or same practice name) return
`409` with the match. Full endpoint list: `server/README.md`.

## Connect the brightday.com.au website

The marketing site (`gbxcaillin/TMS`, on Cloudflare Pages) posts every tool
and contact submission straight into the pipeline via `/api/v1/hooks/lead`, so
leads captured on brightday.com.au land in the CRM as scored deals.

1. In the CRM: Integrations → API keys → create a key named `website` with the
   `deals:write` scope. Copy it once.
2. In Cloudflare Pages → the **Website** project → Settings → Variables and
   secrets, add:
   - `CRM_WEBHOOK_URL` = `https://portal.brightday.com.au/api/v1/hooks/lead`
   - `CRM_API_KEY` = the key (mark it encrypted)
3. Redeploy the Website project.

The site side is best effort: if the CRM is down, the site still records the
lead in its own D1 log and emails as normal. Duplicates return `409` and are
logged, not created twice. The website's own setup is documented in that repo's
`docs/lead-capture-setup.md`.

### Mailing list signups

Newsletter / mailing-list signups on brightday.com.au post to a second webhook so they
land in the CRM's **Mailing list** immediately (instead of only emailing you):

- `POST /api/v1/hooks/subscribe` with `{ "email": "...", "name": "...",
  "source": "website", "tags": ["newsletter"] }` and an API key with the
  `subscribers:write` scope (the existing `deals:write` website key also works).
- Idempotent on email: a repeat signup re-subscribes rather than duplicating.

Manage the list under **Mailing list** in the CRM: add subscribers, unsubscribe,
and **Compose email** to send to everyone subscribed, a tag, or a hand-picked
selection. Three formats: a **branded newsletter** built from headline, intro,
up to four sections, a button and a sign-off (matches brightday.com.au; *Draft with
Claude* writes an issue from a topic when the helper is on; *Preview* renders
it in a sandboxed frame; *Send me a test* emails it to you first), a plain
message in the notification layout, or an uploaded HTML file (put
`{{unsubscribe}}` where the link should go, or a line is appended). Drafts
survive closing the modal (kept in the browser until sent). Every bulk email personalises `{{name}}` and appends a working
unsubscribe link (`/api/v1/unsubscribe/<token>`, public) plus one-click
`List-Unsubscribe` headers, as required by the Spam Act 2003 and by Gmail, Yahoo
and Outlook. Sending goes through the campaign identity (`MAIL_CAMPAIGN_FROM`),
one message per recipient, rate-limited to ~4/second.

Website signups are **single-click** by default: the address is subscribed
immediately and the site sends its welcome email. Set `MAILING_DOUBLE_OPTIN=1`
to require confirmation instead: the address then lands as *pending*, gets a
confirmation email, and only becomes *subscribed* once the link
(`/api/v1/subscribe/confirm/<token>`) is clicked. People you add by hand in
the CRM are always subscribed straight away.

## Email deliverability (newsletters and nurture without landing in junk)

**Do not send bulk mail from a Microsoft 365 mailbox.** Exchange Online caps it
(10,000 recipients/day, 30/minute) and, worse, a flagged mailbox drags every 1:1
client email on `brightday.com.au` into junk too. All CRM mail goes through Resend, with
campaigns on a **separate subdomain**:

1. **Provider.** Resend (the website already uses it). Set `RESEND_API_KEY=re_...`.
   Resend is the only provider in the code; if it ever has to be replaced, the
   Postmark, SMTP and Graph paths removed in September 2026 are in git history.
2. **Two identities, two reputations.**
   - `MAIL_FROM="Brightday <notifications@brightday.com.au>"` for transactional
     mail (invites, invoices, alerts).
   - `MAIL_CAMPAIGN_FROM="Brightday <hello@news.brightday.com.au>"`
     for newsletters and nurture. A subdomain keeps campaign complaints away
     from the main domain.
   - `MAIL_REPLY_TO=hello@brightday.com.au` (a real, monitored mailbox). The campaign
     address has no mailbox, so campaign mail carries a Reply-To: newsletters
     reply to whoever sent them (else `MAIL_REPLY_TO`), and nurture emails reply
     to the lead's owner, so the reply lands in a connected inbox, is logged on
     the lead, and stops the sequence.
3. **DNS (Cloudflare).** In the provider, add both `brightday.com.au` and
   `news.brightday.com.au` as sending domains and create the records it gives you:
   DKIM (CNAME/TXT), SPF (`v=spf1 include:<provider> ~all` on the subdomain;
   add the provider include to the root SPF next to Microsoft's), and the
   return-path/MAIL FROM CNAME. Then a DMARC record on the root:
   `_dmarc.brightday.com.au TXT "v=DMARC1; p=quarantine; sp=quarantine; rua=mailto:dmarc@brightday.com.au"`
   (start at `p=none` for two weeks if you want to watch reports first).
   Cloudflare's free *DMARC Management* reads the reports for you.
4. **Bounce / complaint webhook.** Set `MAIL_WEBHOOK_SECRET` to a long random
   string and, in the provider, add a webhook for bounce + spam-complaint
   events pointing at
   `https://portal.brightday.com.au/api/v1/hooks/mail-events/<MAIL_WEBHOOK_SECRET>`.
   Hard bounces and complaints then suppress the address automatically
   (status *bounced* / *complained* under Mailing list).
5. **Monitor.** Google Postmaster Tools and Microsoft SNDS for both domains;
   keep bounces under 2% and complaints under 0.1%. Send a steady cadence
   rather than bursts, mostly text, from a named person, and never import a
   bought or scraped list.

Ordinary 1:1 replies and follow-ups you write in the Email tab still go from
your own connected Microsoft 365 mailbox, which is exactly where they should
come from.

## Nurture sequences (automatic follow-ups for enquiries)

**Nurture** in the CRM holds sequences of timed emails (day offsets from
enrolment) with `{{name}}`, `{{practice}}`, `{{service}}` and `{{sender}}`
placeholders. Tick **auto-enrol** on a sequence and every new lead from the
chosen source (website, Google Ads, ...) is enrolled the moment the webhook
creates it; or press **Nurture** on any open lead to enrol by hand.

- Sends run every 10 minutes, **Melbourne weekday business hours only**
  (per-sequence window, default 8:00 to 18:00).
- A sequence **stops itself** when the lead replies or someone here emails
  them (any email activity on the deal), when the deal leaves *New Lead* or is
  marked lost, or when they use the **Stop these emails** link that every
  nurture email carries (`/api/v1/nurture/stop/<token>`, sets `noNurture` on
  the lead for good).
- "Send from" is either the campaign address (`MAIL_CAMPAIGN_FROM`, via
  Resend, with the unsubscribe footer) or the lead owner's own
  connected Microsoft 365 mailbox for a personal first touch.
- **Booking link**: defaults to the website booking page
  (`https://brightday.com.au/book/`, which embeds the Microsoft Bookings scheduler).
  Override at the top of the Nurture page or with `BOOKING_URL`. Every nurture
  email carries it: place it with `{{booking}}`, or it is appended as "Book a
  time that suits you: ..." when an email lacks it.
- Leads added by hand in the CRM are auto-enrolled too (not only webhook
  leads). Creating a sequence with auto-enrol offers to **backfill** the
  matching leads already in New Lead from the last 30 days; the same is
  available later from the sequence card (*Enrol matching leads*).
- A call booked through Microsoft Bookings (with `BOOKINGS_BUSINESS` sync on)
  also ends the sequence: the goal was reached.
- **Draft with Claude** writes a 4-step sequence from the service and source
  when the Claude helper is running; otherwise a built-in starter template
  loads. Every send is logged on the lead's timeline. Admins can force a run
  from Nurture → *Send due now*.

Spam Act note: an enquiry gives inferred consent for follow-up about that
enquiry, which is what a sequence is. It does not put the lead on the
newsletter; that stays opt-in.

## Data, backups, recovery

- `/root/crm-data/crm.db` — the workspace (SQLite, WAL mode).
- `/root/crm-data/backups/crm-YYYY-MM-DD.db` — nightly at 02:30 Melbourne
  time, 14 kept, plus a SharePoint copy when Graph is configured.
  Integrations → Server → *Back up database now* runs one on demand.
- Restore: stop the container, copy a backup over `crm.db` (delete
  `crm.db-wal` / `crm.db-shm`), start it again.
- Include `/root/crm-data` in the same off-box backup as the family-office
  data directory.
- Start fresh (remove leads, clients, tasks, activity, files, chat, calendar,
  invoices, notifications, sends and logs; keep accounts, settings, routing,
  API keys, push devices, connected mailboxes, research library, sequences and
  subscribers). Dry run first, then `--yes`; a backup is written before anything
  is removed:
  ```
  cd /root/familyoffice
  docker compose exec crm node server/tools/reset-data.js
  docker compose exec crm node server/tools/reset-data.js --yes
  ```
  Add `--wipe-subscribers`, `--wipe-research` or `--wipe-sequences` to remove
  those too. Signed-in browsers pick up the change on their next sync.

## Perimeter security (Cloudflare in front)

The app has strong built-in auth (scrypt passwords, TOTP MFA, secure sessions,
encryption at rest). To add TLS, DDoS protection and a Zero Trust login in front
of it without moving off the VPS, proxy `portal.brightday.com.au` through Cloudflare and
put Cloudflare Access over the UI. The one rule is to let the machine endpoints
(`/api/v1/hooks/*`, the Microsoft callback, `/api/v1/health`) bypass the login,
or the website lead webhook breaks. Full step-by-step: `deploy/cloudflare-access.md`.

## Live updates

Open tabs hold one `GET /api/v1/live` event stream each (Server-Sent Events, plain
HTTP, no WebSocket). Caddy streams `text/event-stream` responses without buffering
and Cloudflare passes them through; the server writes a comment every 25 seconds
so neither closes the connection as idle. Nothing to configure. If a proxy in
front ever buffers the stream, clients still work: they fall back to a 15-second
poll on their own. `GET /api/v1/admin/status` shows `live.streams`, the number of
tabs connected right now.

## Checks

- `curl -s https://portal.brightday.com.au/api/v1/health` → `{"ok":true,…}`.
- `curl -sN -H "Cookie: $SESSION_COOKIE" https://portal.brightday.com.au/api/v1/live | head -3`
  → `retry: 3000` then `event: rev` (live updates reach the browser through the proxy).
- `docker compose logs crm` shows `[mail:off]` lines while email is not
  configured; they become `[mail]` failures or nothing once it is.
- Chrome DevTools → Application → Manifest and Service Workers show no errors.

## Logo in email

Every email template (notifications, nurture, newsletters) shows the approved Brightday logo (light version, on the paper surface) in the header. It loads from the public website at `https://brightday.com.au/media/logo-light-email.png`, because the CRM itself sits behind Cloudflare Access and recipients could not fetch an image from portal.brightday.com.au. Set `MAIL_LOGO_URL` only if that file ever moves.
