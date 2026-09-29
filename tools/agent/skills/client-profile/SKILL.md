---
name: client-profile
description: >
  Builds or updates a client's structured profile (client-profile.json) from whatever documents the adviser
  uploads, in any format: Fact Finder, KYC File Note, super and platform statements, holdings, CGT and transaction
  reports, insurance schedules and quotes, inscalc output, screenshots, emails, PDSs. Every figure cites the
  document and place it came from; conflicts become flags and missing data becomes gaps. Use for the Client
  profile tool, or whenever a client's current position has to be read from documents.
---

# Client profile

The profile is the one structured record of a client's current position: who they are, their goals, risk profile
and scope, every account with its balance and holdings, insurance, assets and liabilities, and tax position. The
other advice tools (fee and product comparison, investment and platform switches, tax-loss harvesting, annual
review, SOA/ROA) read it from `context/client-profile.json` instead of re-reading the documents, so accuracy here
matters more than anywhere else. A wrong balance or a missed fund flows into every document built on it.

## Rules that are never relaxed

1. **Only record what a document states.** Never fill a value from general knowledge or a "typical" figure. If it
   is not in the documents, leave it out and list it under `gaps`.
2. **Every figure has provenance.** `provenance["/accounts/0/balance"] = {"doc": "d3", "where": "p.1 'Your account
   balance at 30 June 2026'", "quote": "$275,812.34"}`. `where` must let a person find it in seconds: a sheet and
   cell (`Fact Finder!B94`), a page and label, or a table row. If you calculated a value, say how in `derived`.
3. **Conflicts are flags, not guesses.** When two documents disagree, apply the precedence rules in
   `references/field-guide.md`. If the rules settle it, use that value and add a `warn` flag naming both values
   and their sources. If they don't, add a `block` flag with `chosen_value: null` and leave the field out.
4. ***_pct fields are decimals.** 0.0058 means 0.58%. This matches the fee engine; the validator rejects 0.58 for
   an ICR.
5. **An insurer is never a super fund.** Group cover goes on the fund's `insurance` list; a standalone policy (TAL,
   Zurich, NEOS, AIA, MLC Life, OnePath, MetLife, ClearView, Resolution Life…) goes under `policies`, even when a
   Fact Finder records it in a fund column.
6. **Mask account numbers** to the last 4 characters (`****1234`). Never copy TFNs, full account numbers,
   passwords or Medicare numbers into the profile.

## Workflow

### 1. Extract

```bash
python3 <this skill>/scripts/extract.py
```

This converts every file in `./inputs` and `./context` to text in `work/extracted/` with cell, page and table
locators, and prints an inventory. For anything marked `needs_visual` (a scanned PDF, screenshot or photo), open
the original with the Read tool, which shows you the pages and images. Password-protected or unsupported files
are noted; list each as a document with `used: false` and a note saying what is needed.

### 2. Classify each document

Give each source an id (`d1`, `d2`, …) and a `type` (see the schema's enum), with `issuer`, `as_at` (the date the
figures are at, not the print date) and `about` (the person) where known. The CRM files in `./context` count as
documents too (`crm_record`), as does `context/client-profile.json` from an earlier confirmed profile
(`previous_profile`).

### 3. Map into the profile

Follow `references/field-guide.md` for where each fact lives in each document type and which source wins.
Write `outputs/client-profile.json` to the schema in `references/client-profile.schema.json`. Work account by
account: a super statement or platform report usually gives the balance, option or holdings, fees charged,
insurance and nomination; the Fact Finder gives the people, income, assets, liabilities and the fund list; the
KYC note gives goals, risk profile, scope and corrections.

Link people with ids (`p1` is the client, `p2` the partner) and use them for every `owner`, `insured` and `about`.

### 4. Updating an earlier profile

When `context/client-profile.json` exists, start from it. Keep what no new document contradicts; replace what a
newer document updates; and add a `changes` entry for every value that moves (field, from, to, doc). Keep every
entry in `overrides` and apply them last: an override is a person's correction and beats any document, unless a
newer document plainly supersedes it, in which case keep the document value and flag the override for review.

When the form's **corrections** field has instructions (for example "Salary is $105,000 from 1 July, confirmed by
phone"), record each as an override: `{"field": "/people/0/income/gross_pa", "value": 105000, "who": "<the person
who started the run, from run.json>", "date": "<today>", "reason": "<their words>"}`.

### 5. Validate until clean

```bash
python3 <this skill>/scripts/validate_profile.py outputs/client-profile.json
```

Fix every error. For each warning, either fix it or record it as a flag so the adviser sees it. Run it again until
`"ok": true`. Never finish with a profile that fails validation.

### 6. Summarise

```bash
python3 <this skill>/scripts/summarise.py outputs/client-profile.json "outputs/Client profile - <Client name>.md"
```

Then reply with a short summary for the adviser: the number of documents read (and any not used, with why),
people, total balance across accounts, each `block` flag, the most important `warn` flags, and the gaps that stop
other tools (for example "no holdings breakdown for the HUB24 account, so tax-loss harvesting can't run").

## Files

- `references/client-profile.schema.json`: the profile format (JSON Schema 2020-12).
- `references/field-guide.md`: document types, where each field is found, precedence when sources disagree, and how
  the profile maps onto the fee engine, newsoatool and inscalc inputs.
- `references/example-profile.json`: a complete made-up example that passes validation.
- `scripts/extract.py`, `scripts/validate_profile.py`, `scripts/summarise.py`: as above.
