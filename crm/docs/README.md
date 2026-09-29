# Help & training and the capabilities statement

Everything in this folder ships inside the app (`build.sh` copies it to `dist/docs/`) and is shown
under **Help & training** in the CRM.

| File | What it is | Update when |
| --- | --- | --- |
| `tutorial.json` | The training modules (one per section: summary, steps, tips, which screenshots and diagram) and the **changelog** shown under What's new | Any change a user can see |
| `img/*.jpg` | Screenshots rendered from the sample data by `server/tools/screenshots.js` | Any screen changes |
| `diagrams/*.svg` | Flow diagrams (lead flow, newsletter send, tasks, overview) | The flow they describe changes |
| `capabilities-future.html` | The future capabilities statement: parked designs, built-but-waiting items, scale-model plans, and options set aside with reasons. Same format as the current one | An item is parked, shipped (move it to the current statement), or set aside |
| `capabilities.html` + `capabilities-img/` | The capabilities statement (functions, website interaction, integrations, cost, scale model). A full HTML document; Help & training fetches it and renders its body in a shadow root (the site is served with X-Frame-Options DENY, so no iframe). Keep the `#crm-back` bar and the `@media print` rules at the top when editing | A capability, integration, cost or the scale plan changes |

## The rule

**Every pull request that changes something a user can see or do must update this folder in the same PR:**

1. Edit the module(s) in `tutorial.json` so the steps match the new behaviour.
2. Add an entry at the top of `changelog` (date, title, one or two sentences, the module ids it touches).
3. Re-render screenshots if a screen changed:
   ```sh
   CHROME_BIN=/path/to/chrome NODE_PATH=/path/to/node_modules/with/playwright-core node server/tools/screenshots.js
   ```
   Add a line to `SHOTS` in that script when you add a screen.
4. Update `capabilities.html` when a capability, integration, cost or the scale plan changes, and `capabilities-future.html` when something is parked, shipped or set aside (the
   "What has to change before you get there" cards mark items done as they ship).
5. Bump `version` in `tutorial.json` to the date of the change.

Screenshots always come from the sample data in `wireframe.html`, never from a live database.
