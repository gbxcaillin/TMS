# Brightday Portal

Two apps behind one address: `crm/` (the portal; its own rules are in `crm/CLAUDE.md` and apply to anything under
`crm/`) and `tools/` (the advice tools at `/tools/`). `deploy/` wires them together behind Caddy and Cloudflare.

## Working rules

- Keep the CRM a clean descendant of the starter: branding only through `crm/brand.json` + `crm/tools/rebrand.js`,
  and CRM changes small, tested and documented in `crm/docs/` as `crm/CLAUDE.md` asks.
- The tools service never keeps its own login or client data: it asks the CRM (`/api/v1/auth/me`,
  `/api/v1/bootstrap`) with the person's session. Anything it stores is sealed with the CRM's `DATA_KEYS`.
- The agent works on files only (`run.json`, `inputs/`, `context/`, `outputs/`). Do not give it network, CRM or
  database access; add context by writing more files in `tools/server/lib/context.js`.
- A tool's form, context and approval rule live in `tools/server/lib/registry.js`; its logic lives in the skill.
- The client profile (`tools/agent/skills/client-profile`) is the one structured record of a client's position.
  New skills read it from `context/client-profile.json`; change its shape only through the schema, the example,
  the validator and their tests together.

## Checks before a PR

- `cd crm && sh build.sh && node tests/run.js`, `cd tools && npm test`, and
  `cd tools/agent/skills/client-profile && python3 -m unittest discover -s tests`.
- For deploy changes: `docker run --rm -v $PWD/deploy/Caddyfile:/etc/caddy/Caddyfile:ro caddy:2-alpine caddy
  validate --config /etc/caddy/Caddyfile` (with test certs mounted at `/certs`).
