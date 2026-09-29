# CRM (started from the CRM starter)

Single-file vanilla-JS PWA (`wireframe.html` → `sh build.sh` → `index.html` + `dist/`) with a Node 22 server in
`server/` (SQLite via `node:sqlite`, Resend for email, Microsoft Graph for mail and SharePoint). See `START-HERE.md`
for setup, branding (`brand.json` + `node tools/rebrand.js`) and deployment.

## Working rules

- Build every change on a feature branch and open a pull request; keep PRs small and single-purpose.
- The PR description is written for the owner: what changes for users in plain language, screenshots from a
  headless run when a screen changed, and any step the owner must take after it lands (an env variable, a setting).
- Run `sh build.sh` before committing; `index.html` is committed, `dist/` is not.
- Never commit secrets. `.env.production.example` documents every variable.
- Branding goes through `brand.json` and `tools/rebrand.js`, never by hand-editing names or colours across files.

## Documentation is part of every change

`docs/` holds Help & training (shown inside the app) and the capabilities statement. A change a user can see or do
updates `docs/` in the same PR: the affected module(s), a `changelog` entry in `docs/tutorial.json`, re-rendered
screenshots (`node server/tools/screenshots.js`) when a screen changed, and `docs/capabilities.html` when a
capability or integration changed. See `docs/README.md`.

## Checks before a PR

- `node --check` on changed server files and a boot check: `DATA_DIR=/tmp/x PORT=3111 ALLOW_UNENCRYPTED=1 node server/index.js`.
- Headless render of the changed views (Chromium via playwright-core) for client changes.
- The test suite: `sh build.sh`, then `node tests/run.js` (every `tests/*.test.js`; add `--live` for the
  network-backed `*.live.js`, or name words to run a subset). Browser tests need Chromium: set `CHROME_BIN`, or
  `npx playwright-core install chromium` in `tests/`. GitHub Actions runs the same on every PR
  (`.github/workflows/ci.yml`).
- A change that fixes a bug or adds a feature adds or extends a test in `tests/`. Fixtures use made-up data only:
  never commit client records or licensed data.
