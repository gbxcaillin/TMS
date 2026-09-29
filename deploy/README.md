# Deploying Brightly

One VPS runs three containers behind Cloudflare:

```
browser ──HTTPS──▶ Cloudflare (proxy, WAF, optional Access) ──HTTPS──▶ Caddy :443 on the VPS
                                                                   ├─ /tools/*  → tools:3100  (advice tools)
                                                                   └─ everything else → crm:3000  (the portal)
```

- **crm**: the portal from `crm/` (clients, tasks, calendar and Outlook sync, email, chat, access levels,
  sign-in with MFA or Microsoft 365). Its own guides in `crm/deploy/` (`SSO.md`, `GO-LIVE.md`,
  `cloudflare-access.md`, `harden.sh`) still apply; this page covers how the pieces fit together.
- **tools**: the advice tools from `tools/`. People reach them from **Advice tools** in the portal menu. They sign in
  with the portal session and read clients from the CRM as that person.
- **caddy**: HTTPS at the origin with a Cloudflare Origin Certificate, and the `/tools` split.

## 1. Server

Any VPS with Docker and the Compose plugin: 2 vCPU and 4 GB RAM is comfortable for a small practice, since the
agent runs are the heavy part. Choose a Sydney or Melbourne region to keep client data in Australia.

```bash
git clone https://github.com/gbxcaillin/TMS /opt/brightday && cd /opt/brightday
sudo bash crm/deploy/harden.sh          # once: security updates, firewall (22/80/443), fail2ban, key-only SSH
```

## 2. Secrets

```bash
cd /opt/brightday/deploy
docker run --rm -v "$PWD/../crm:/app" -w /app node:22-alpine node server/tools/keygen.js   # prints DATA_KEYS=v1:…
cp ../crm/.env.production.example crm.env
cp tools.env.example tools.env
chmod 600 crm.env tools.env
```

- In **crm.env**: `APP_URL=https://portal.brightday.com.au`, `DATA_KEYS=` the key you just generated, and the
  optional features you want (Microsoft 365 sign-in, mailbox and calendar sync, email; see `crm/deploy/SSO.md`
  and the comments in the file).
- In **tools.env**: the **same** `DATA_KEYS`, and `ANTHROPIC_API_KEY` from console.anthropic.com. Runs are billed
  to that key; `AGENT_MAX_BUDGET_USD` caps each run.
- Keep a copy of `DATA_KEYS` in the practice password manager. Without it the databases, backups and every
  stored run are unreadable.

## 3. Cloudflare

1. **DNS**: an `A` record `portal` pointing at the VPS, **Proxied** (orange cloud).
2. **SSL/TLS → Origin Server → Create Certificate** for `portal.brightday.com.au`. Save the certificate as
   `deploy/certs/origin.pem` and the key as `deploy/certs/origin.key` (`chmod 600` the key).
3. **SSL/TLS → Overview**: mode **Full (strict)**.
4. **Only Cloudflare reaches the origin.** Restrict ports 80/443 on the VPS firewall to Cloudflare's ranges
   (https://www.cloudflare.com/ips), so nobody can bypass the WAF by going to the server's IP. The Caddyfile
   already trusts those ranges for the visitor's real IP address.
5. Optional **Zero Trust login** in front of the whole portal: follow `crm/deploy/cloudflare-access.md`. The
   advice tools add no machine endpoints, so the bypass list there is unchanged.

## 4. Start

```bash
cd /opt/brightday/deploy
mkdir -p crm-data tools-data && chown -R 1000:1000 crm-data tools-data && chmod 700 crm-data tools-data   # both containers run as uid 1000
docker compose up -d --build
docker compose logs -f crm tools
# crm:   [boot] Brightly on :3000 · db /app/data/crm.db · dist ok
# tools: [boot] Brightly advice tools on :3100/tools/ · … · skills: annual-review, fee-comparison, …
```

Open https://portal.brightday.com.au. The empty database shows **Create the first admin**; as an admin you set
up two-factor authentication next, then invite the team under **Settings → Team**.

Advice tools are on for the Manager, Paraplanner and Client manager levels, and off for Basic. Change that under
**Settings → Access levels**. Advice documents (SOA/ROA, annual review, OFA) can be approved by the roles in
`APPROVER_ROLES` (Admin, Manager and Client manager by default); paraplanners prepare them but cannot sign off.

## Skills

Your skills go in `tools/agent/skills/<name>/SKILL.md` (see `tools/agent/skills/README.md`). The folder is
mounted read-only into the tools container, so after adding or editing a skill:

```bash
git pull && docker compose restart tools
```

## Updating

```bash
cd /opt/brightday && git pull
cd deploy && docker compose up -d --build
```

Caddyfile changes need `docker compose up -d --force-recreate caddy` (the file is a single-file bind mount; see
`crm/deploy/DEPLOY.md`).

## Data and backups

| Folder | Holds |
| --- | --- |
| `deploy/crm-data/` | the portal database, push keys and 14 nightly backups (also copied to SharePoint when Graph is set up) |
| `deploy/tools-data/` | the tools database and every run's folder: uploads, the client context given to the agent, and the documents produced |

Both are encrypted with `DATA_KEYS`. Back them up off the server together. Advice records must be kept for at
least seven years, so do not prune `tools-data/runs`.

## Checks

```bash
curl -s https://portal.brightday.com.au/api/v1/health        # {"ok":true,…}
curl -s https://portal.brightday.com.au/tools/api/health     # {"ok":true,"model":"claude-opus-5-5",…,"encryption":true}
```

`skills` in the tools health answer lists the skill folders it found. A tool whose skill is missing shows
"Skill not installed yet" and cannot be started.
