# CRM starter

A complete, working CRM to start a new project from: pipeline, clients, tasks, calendar, email, chat, calls, mailing
lists and nurture, files, invoices, reports, research and model portfolios, team and access control, security (MFA,
Microsoft sign-in, encryption at rest), notifications and an installable app. It runs as one Node 22 server with a
SQLite database and a single-page app, and ships with made-up sample data so you can click through it straight away.

It comes branded as **Acme Advisory / Acme CRM**, a placeholder. Everything that makes it yours lives in one file,
`brand.json`, and one command applies it.

## 1. Try it (5 minutes)

```sh
sh build.sh                                    # builds index.html and dist/
open wireframe.html                            # demo mode: sample data, no server, click Sign in
```

With the server (real accounts, saving, email, live updates):

```sh
cd server && npm ci && cd ..
DATA_DIR=./data ALLOW_UNENCRYPTED=1 ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='choose-a-long-one' node server/index.js
# then http://localhost:3000
```

## 2. Make it yours

Edit `brand.json`, then run:

```sh
node tools/rebrand.js --dry     # see which files would change
node tools/rebrand.js           # apply
sh build.sh
node tests/run.js               # optional: the full test suite still passes after a rebrand
```

| Key | What it changes |
| --- | --- |
| `company`, `legal`, `product` | Company name, legal entity (invoices, footers), app name (title bar, install prompt, emails) |
| `short`, `slug` | Short mark (invoice numbers like ACME-1040, starter model names) and the lowercase id used in storage keys, cookies and service names. Keep the slug distinctive: it is replaced as a whole word everywhere |
| `monogram` | 1 to 3 letters for the generated app icon, when you have no logo file |
| `domain`, `appHost`, `sharepointHost` | Email addresses and links (`hello@domain`), the app address, the SharePoint site |
| `tagline`, `cities` | The two lines on the sign-in page and in newsletter footers |
| `bank` | Payment details printed on invoices |
| `people` | The five sample team members in the demo data (name, first name, email name) |
| `colors` | The palette: `accent` family for buttons, links and charts; `rail` for the left bar; the rest are page, card, line and text tones |
| `fonts` | Serif (headings), sans (body), mono (numbers), and the Google Fonts `url` that loads them |
| `logo.mark`, `logo.light` | Optional paths to your own logo files (put them in `brand/`): `mark` is a square image for the app icon and the dark left bar, `light` is for white backgrounds (sign-in, invoices, PDFs). Leave empty to get a monogram |
| `modules` | Set any to `false` to switch it off: it leaves the menus and its background jobs stop |

Run the script again whenever you change `brand.json`; it only touches what differs from `.brand-applied.json`
(the record of what the files hold now, so do not edit that one by hand). Icons need Chromium: set `CHROME_BIN`
and `NODE_PATH` to a `node_modules` with `playwright-core` (`cd tests && npm i` gives you one). Add `--shots` to
re-render the Help & training screenshots in `docs/img`.

Things the script does not decide for you, worth a look before going live:

- **Sample data** in `wireframe.html` (`const SEED`): deals, clients and emails about a consultancy. It only shows in
  demo mode and is stripped from production builds, but rewrite it to suit your industry for demos.
- **Help & training** (`docs/tutorial.json`) and the capabilities pages (`docs/*.html`) describe the features in
  general terms; adjust the wording to your business.
- **Research** (ASX securities, Morningstar reference data, model portfolios) is built for Australian financial
  advice. Switch it off in `modules` if the new project has no use for it.
- **Time zone**: Australia/Melbourne by default (`TZ` in the Dockerfile).

## 3. Put it online

`deploy/` has the full path: `DEPLOY.md` (VPS with Caddy and automatic HTTPS), `GO-LIVE.md` (the checklist),
`SSO.md` (Microsoft 365 sign-in), `cloudflare-access.md`, `harden.sh`. The `Dockerfile` builds a single container.
Every setting is documented in `.env.production.example`; production refuses to start without an encryption key
(`node server/tools/keygen.js`).

Integrations are all optional and switch on when their keys are set: Resend (email), Microsoft Graph (mailbox sync,
calendar, SharePoint files), Claude (AI briefs and drafts), Google Ads and Meta lead webhooks, JustCall/Aircall
(calls), Cloudflare Web Analytics, web push.

## 4. Start the new project's history

```sh
git init && git add -A && git commit -m "Start from CRM starter"
```

`CLAUDE.md` holds the engineering rules the codebase was built with (tests for every change, docs updated with
features, the checks to run); keep it and add your own working rules.

## What is where

| Path | |
| --- | --- |
| `wireframe.html` | The whole app (HTML, CSS, JS in one file). `build.sh` turns it into `index.html` + `dist/` |
| `server/` | Node 22 server: `index.js`, `routes/api.js`, `lib/` (one module per feature), `tools/` |
| `tests/` | `node tests/run.js` runs every `*.test.js` (browser tests use Chromium via playwright-core) |
| `docs/` | Help & training shown inside the app, changelog, capabilities statement, screenshots |
| `deploy/` | Deployment guides and scripts |
| `icons/` | App icons and logos (generated by `tools/rebrand.js`) |
| `brand.json`, `tools/rebrand.js` | Branding and module switches |
