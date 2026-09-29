# Acme CRM server

Plain Node 22 (`node:http`, `node:sqlite`), no framework. Three runtime
dependencies: `web-push`, `qrcode`, `yahoo-finance2`. Email goes out through the Resend HTTP API.

```
server/
  index.js          HTTP server: /api/v1/* → routes, everything else → dist/
  routes/api.js     every endpoint
  lib/db.js         SQLite schema, record store, users, logs
  lib/auth.js       scrypt passwords, cookie sessions, invite/reset tokens, API keys, rate limit
  lib/state.js      bootstrap snapshot + sync (apply client ops, return changes since rev)
  lib/notify.js     bell + push + email fan-out, hooks that watch synced records
  lib/leads.js      lead intake: normalise, de-duplicate, create deal/task/activity
  lib/push.js       VAPID web push, subscriptions
  lib/mail.js       Resend email with the ACME template
  lib/graph.js      Microsoft Graph: SharePoint list/upload/download, Bookings
  lib/refdata.js    Morningstar screener exports (CSV) from SharePoint: fees, ratings, 3y risk, unlisted
                    funds by APIR; stored in DATA_DIR/refdata.json, applied to the research library
  lib/market.js     Yahoo Finance quotes/history/profiles/search with SQLite cache; builds research
                    library records, the starter library, and model growth series
  lib/jobs.js       scheduler: chat digest, task digest, market refresh, nightly backup
```

## How state works

The front end keeps one state object. In server mode every collection
(`deals`, `tasks`, `clients`, `invoices`, `events`, `messages`, `rooms`,
`threads`, `files`, `notifs`, `activity`, `changes`, `models`, `securities`)
is stored as JSON records in the `records` table, and the configuration
documents (`stages`, `sources`, `fields`, `colors`, `campaigns`, `spend`,
`watchlist`, `settings`) in `kv`. Every write bumps a global `rev`.

- `GET /api/v1/bootstrap` → the whole workspace for the signed-in user.
- `POST /api/v1/sync {base, ops, kv}` → applies record upserts/deletes and
  document replacements (last write wins per record), returns everything
  changed since `base`.
- `GET /api/v1/sync?since=rev` → pull everything since `rev` (on focus, on a
  live event, and as a fallback poll every 60 s, or 15 s without the stream).
- `GET /api/v1/live` → Server-Sent Events. Sends `event: rev` with the new
  revision whenever anything changes (`lib/live.js`, hooked into `bumpRev`),
  plus a comment every 25 s to keep proxies from closing the connection.
  Clients pull on each event, so a chat message lands on every open tab
  within about a second.

Users live in their own table; `users` ops in a sync are limited to role and
status (admins) or name/colour/focus (self). `fields`, `stages`, `sources`
and `colors` need Admin or Manager. The server owns `settings.apiKeys` and
`settings.push.devices` and overwrites them in every snapshot.

## Endpoints

Session cookie (`acme_session`, HttpOnly, SameSite=Lax) or
`Authorization: Bearer acme_live_…` where noted. Mutating cookie requests must
send `X-Requested-With: acme`.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | – | liveness |
| POST | `/auth/setup` | – (empty DB only) | create the first admin |
| POST | `/auth/login` | – | `{email,password,remember}` |
| POST | `/auth/logout` | session | |
| GET | `/auth/token/:token` | – | who an invite/reset link belongs to |
| POST | `/auth/accept` | – | `{token,password}` finish invite or reset |
| POST | `/auth/forgot` | – | `{email}` emails a reset link |
| POST | `/auth/password` | session | `{current,password}` |
| GET | `/bootstrap` | session | full state |
| GET/POST | `/sync` | session | see above |
| POST | `/users` | admin | invite `{name,email,role,focus}` → `inviteUrl`, `emailed` |
| POST | `/users/:id/invite` | admin | re-issue invite |
| POST | `/users/:id/reset` | admin | issue a reset link |
| POST | `/keys` | admin | `{name,scopes}` → full key once |
| DELETE | `/keys/:id` | admin | revoke |
| GET | `/push/key` | – | VAPID public key |
| POST | `/push/subscribe` `/push/unsubscribe` `/push/test` | session | |
| GET | `/leads` | session or key `deals:read` | filters `stage`, `owner`, `source`, `since`, `limit` |
| GET | `/leads/:id` | key `deals:read` | lead + activity, tasks, changes, files, invoices |
| POST | `/leads` | key `deals:write` | create; `409` on duplicate (`allowDuplicate:true` overrides) |
| PATCH | `/leads/:id` | key `deals:write` | any deal field, `stage`, `owner`; logs the change |
| POST | `/leads/:id/activity` | key `ai:write` | `{text,detail,type,score,notifyOwner}` |
| GET | `/stages`, `/users` | key `deals:read` | lookups |
| POST | `/hooks/google-ads` | `google_key` | Google Ads lead form webhook |
| GET/POST | `/hooks/meta` | signature | Meta webhook verify + leadgen events |
| POST | `/hooks/lead` | key `deals:write` | generic lead relay (Zapier etc.) |
| GET | `/files?deal=ID` | session | SharePoint folder for the deal (mirrors into `files`) |
| PUT | `/files/upload?deal=ID&name=` | session | raw body → SharePoint |
| GET | `/market/quotes?symbols=` `/market/history?symbol=&years=` `/market/search?q=` | session | Yahoo Finance |
| POST | `/market/refresh` | session | refresh stored securities |
| POST | `/research/securities` `{t}` | Research | add or re-fetch a ticker (full record: price, history stats, distributions, profile) |
| POST | `/research/starter` | Research | add the starter library (core ASX ETFs and shares) |
| POST | `/research/portfolio` `{holdings,bench}` | Research | growth of $100 and return/risk stats from month-end prices |
| POST | `/mail/backfill` `{deal}` | Email | add every email with the deal's contact from the connected mailboxes to its conversation |
| GET | `/research/refdata` | Research | Morningstar reference data status (files, fund count) |
| POST | `/research/refdata/sync` | Research | re-import the CSVs in `<SP_FOLDER>/Research/Reference data` |
| POST | `/research/refdata/upload?name=` (raw CSV body) | Research | import a Morningstar ETF or managed fund export, or a list of ASX codes (Code, Company; its companies are added in the background), and save it to that SharePoint folder |
| GET | `/admin/status` | admin | features, mail/webhook logs, jobs |
| POST | `/admin/backup` `/admin/test-mail` `/admin/run-job` | admin | ops |

## Notifications

`notify(eventId, [userIds], {...})` writes a bell record addressed to the
recipients, pushes to each of their subscribed devices (outside quiet hours)
and emails when the workspace preference for that event has email on. Sync
hooks raise `assigned`, `completed_by`, `completed_cc`, `mention`, `invite`
and `lead` from the records clients write; webhooks raise `lead` and
`lead_any`; jobs raise `chat` (unread > `chatHours`), `due` and `overdue`.

## Running locally

```bash
cd server && npm install
sh ../build.sh
DATA_DIR=../data PORT=3000 DEMO_DATA=1 node index.js
# open http://localhost:3000 → "Create the first admin"
```

## Tests

`sh build.sh && node tests/run.js` from the repo root runs every `tests/*.test.js` (offline browser tests against the page source, and server tests that boot `index.js` on a throwaway `DATA_DIR`). `--live` adds the Yahoo-backed tests. CI runs the same on every pull request (`.github/workflows/ci.yml`).
