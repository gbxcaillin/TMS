# Advice skills

Each advice tool runs one skill. Put your skill folders here, one per tool:

| Advice tool                          | Folder                        |
| ------------------------------------ | ----------------------------- |
| Fee comparison                       | `skills/fee-comparison/`      |
| Product feature comparison           | `skills/product-comparison/`  |
| Tax minimisation and loss harvesting | `skills/tax-optimisation/`    |
| Annual review (with the OFA)         | `skills/annual-review/`       |
| SOA / ROA                            | `skills/soa-roa/`             |

Each folder needs a `SKILL.md` whose frontmatter `name` matches the folder name. The mapping lives in
`tools/server/lib/registry.js` (`skill`). Templates, scripts and reference files sit alongside it. This folder
is loaded as the Claude Code plugin `brightday`, so the agent sees each skill as `brightday:<name>`.

The tools page shows "Skill not installed yet" on any tool whose folder is missing, and will not start it.

## What the skill receives

The agent's working directory is the run folder:

```
run.json               the form inputs (client, dates, fee, notes…)
inputs/<field>/…       files the adviser uploaded, grouped by form field
context/client.json    the client's CRM record (contact, owner, notes, deals)
context/emails.md      emails with the client in the review period, from the CRM's mailbox sync
context/meetings.json  meetings with the client in the period (CRM calendar, synced with Outlook)
context/file-notes.md  profile notes and timeline activity
context/tasks.json     the client's tasks
outputs/               ← write deliverables here; each file becomes a document on the run
```

Only the context the tool declares (`context` in `registry.js`) is written. Records come from the CRM as the
person who started the run can see them.

## Writing skills for this environment

- Use paths relative to the working directory (`./inputs`, `./context`, `./outputs`).
- The container has Python 3 with `python-docx`, `openpyxl`, `pypdf` and `pdfminer`, plus `pdftotext` (see
  `tools/Dockerfile`).
  Add what your skill needs there.
- Keep templates (your SOA or OFA .docx, for example) in the skill folder and refer to them relative to the skill's
  base directory, which the agent is told when the skill loads.
- Mark anything that needs the adviser's confirmation as `[[CONFIRM: …]]`. The run page highlights these in the
  summary.
- The agent has no network access to other systems and no database access. Web search is off unless
  `AGENT_ALLOW_WEB=1`.
