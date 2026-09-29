# Brightly

The adviser portal for Brightday: client list, tasks, calendar and inbox synced with Outlook, practice chat, and
the advice tools (fee comparison, product feature comparison, tax minimisation and loss harvesting, annual review
with the Ongoing Fee Arrangement, SOA/ROA), all behind one sign-in on one address.

| Folder | What it is |
| --- | --- |
| `crm/` | The portal, started from the CRM starter and branded Brightday (`crm/brand.json`). Single-file app plus a Node 22 server with SQLite. Clients, tasks, calendar, email, chat, files, access levels, MFA and Microsoft 365 sign-in, encryption at rest. Start with `crm/START-HERE.md`. |
| `tools/` | The advice tools service, mounted at `/tools/`. Signs in through the CRM session, reads clients from the CRM, and runs the practice's Claude skills with the Claude Agent SDK. |
| `tools/agent/skills/` | Where the five skills go (`tools/agent/skills/README.md` says what each receives). |
| `deploy/` | Docker Compose (CRM, tools, Caddy) and the Caddyfile for Cloudflare in front. Start with `deploy/README.md`. |

## Run it locally

```sh
# The portal (http://localhost:3000). ADMIN_* creates the first user.
cd crm/server && npm ci && cd .. && sh build.sh
DATA_DIR=./data ALLOW_UNENCRYPTED=1 ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='choose-a-long-one' node server/index.js

# The advice tools, in another terminal. AGENT_FAKE=1 runs a stand-in agent; set ANTHROPIC_API_KEY to run the real skills.
cd tools && npm ci
DATA_DIR=./data ALLOW_UNENCRYPTED=1 CRM_URL=http://localhost:3000 AGENT_FAKE=1 node server/index.js
```

The two need one address for the shared sign-in, as Caddy gives them in production: put any reverse proxy on one
port that sends `/tools/*` to `:3100` and everything else to `:3000`. Try the portal alone with `open crm/wireframe.html`
(demo mode with sample data, no server).

## Tests

```sh
cd crm && sh build.sh && node tests/run.js     # the portal (Chromium via playwright-core: set CHROME_BIN)
cd tools && npm test                           # the tools against the real CRM, with the stand-in agent
```

GitHub Actions runs both on every pull request (`.github/workflows/ci.yml`).

## Before going live

- **Logo**: `crm/brand/` holds a drawn approximation of the flower mark and wordmark. Replace them with the
  official files and run `node tools/rebrand.js` in `crm/`.
- **Names and addresses**: `crm/brand.json` has `Brightday Pty Ltd`, `brightday.com.au` and
  `portal.brightday.com.au` as placeholders. Confirm the legal entity, domain and bank details.
- **Modules**: calls, mailing lists, nurture, invoices and research came with the starter and are on.
  Switch off what the practice won't use under `modules` in `crm/brand.json`.
- **Dark theme**: `brand.json` has no dark-mode colours, so the portal's dark theme still carries the starter's
  green tints. The advice tools' dark theme is Brightday throughout.
- **Skills**: the Client profile skill is included; the advice skills are built on it and on the practice's
  building blocks (fee engine, newsoatool) and go in `tools/agent/skills/`.
