# Advice skills

Each portal tool runs one skill. Drop your skill folders in here:

| Portal tool                        | Folder                          |
| ---------------------------------- | ------------------------------- |
| Fee Comparison                     | `skills/fee-comparison/`        |
| Product Feature Comparison         | `skills/product-comparison/`    |
| Tax Minimisation & Loss Harvesting | `skills/tax-optimisation/`      |
| Annual Review (+ OFA)              | `skills/annual-review/`         |
| SOA / ROA Generator                | `skills/soa-roa/`               |

Each folder needs a `SKILL.md` whose frontmatter `name` matches the folder name
(the mapping lives in `packages/shared/src/tools.ts` → `skill`). Templates,
scripts and reference files can sit alongside it.

## What the skill receives

The worker runs the agent with its working directory set to the run folder:

```
run.json            form inputs from the portal (clientId, dates, fee, notes…)
inputs/<field>/…    files the adviser uploaded, grouped by form field
context/client.json client profile (platform, FUM, current fee, review dates)
context/emails.md   the period's client correspondence (annual review)
context/meetings.json
context/file-notes.md
context/tasks.json
outputs/            ← write deliverables here; each file becomes a portal document
```

Only the context the tool declares (`context` in `tools.ts`) is written.

## Tips for skills in this environment

- Refer to paths relative to the working directory (`./inputs`, `./outputs`).
- Document generation runs in the worker container, which has Python 3 with
  `python-docx`, `openpyxl`, `pdfplumber` and LibreOffice (see `deploy/Dockerfile.worker`).
  Add packages there if your skill needs more.
- Put templates (e.g. your SOA .docx template) inside the skill folder and refer to
  them relative to the skill's base directory, which the agent is told when the skill
  loads (e.g. "use `templates/soa.docx` from this skill's directory").
- The agent has no network access to other systems and no database access; everything
  it needs is in the run folder.
