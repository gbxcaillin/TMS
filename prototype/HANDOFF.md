# Brightly: handover

Read this first. It explains what exists, the decisions behind it, where the data came from, and what is still open.
Repository `gbxcaillin/TMS`, branch `claude/stoic-shannon-ivg7q7`.

## The business

- **Brightday Australia Pty Ltd** (CAR 1313063), an Australian financial advice practice, licensed under **Banyan
  Securities Pty Ltd** (AFSL 484139). Adviser for the demo: **Scott Brouwer**, AR 283906.
- The portal is called **Brightly**, and so is its AI assistant. Never show the word "Claude" to users; Brightday's
  team already knows an assistant called Brightly. Brightday stays the name of the practice.
- Branding: Space Cadet `#123559` behind every button and behind the logo (the seven-petal flower with an open
  centre circle); Vivid Raspberry `#F50D74` for accents only; Rose Garnet `#990A4E`; Ubuntu for headings.
- Clients mostly come from **Fiducian** (super and IDPS) and **BT Panorama**, and move to **DASH Super Simplifier** or
  **DASH Wealth Simplifier** with a **Pearl** portfolio (Pearl Investment House, a related body of Banyan).

## What is in the repo

| Path | What it is |
| --- | --- |
| `prototype/brightly-live.html` | **The live demo** (single file, ~660 KB). Real client documents are loaded in the browser; Brightly builds profiles; advice tools produce `.docx`. Published privately as an Artifact. |
| `prototype/brightday-portal.html` | The earlier click-through prototype with five made-up clients (pitch demo). |
| `prototype/product-data/` | The product data built into the live demo, as separate files (see "Data sources"). |
| `prototype/tests/` | Browser tests (Playwright + Chromium), made-up test documents, and recorded Brightly answers for offline replay. |
| `crm/` | The real portal: the CRM starter, rebranded (product name "Brightly" via `crm/brand.json` + `crm/tools/rebrand.js`). Its own rules are in `crm/CLAUDE.md`. |
| `tools/` | The real advice-tools service (Node + Claude Agent SDK), with the `client-profile` skill. Not yet updated with the demo's simplified tools. |
| `deploy/` | VPS + Caddy + Cloudflare deployment. |

## How the live demo works

- **No client data in the file.** Documents are read in the browser tab (pdf.js, mammoth, SheetJS, JSZip from cdnjs).
  A session is kept only as an **encrypted client pack** (AES-GCM, PBKDF2-SHA256 250k) the adviser saves to their own
  computer. Nothing uses localStorage.
- **Brightly** is the Artifact `sample` capability (`claude.use('sample')`, `.json()` calls). Prompts are constants in
  the file: `SORT_PROMPT`, `PROFILE_PROMPT`, `SOA_PROMPT`, `ROA_PROMPT`, `REVIEW_PROMPT`, `BRIGHTLY` (Ask Brightly).
  Brightly writes words only; the page does every figure (fees, tables, totals) and checks Brightly's JSON before use.
- **Downloads** use the `downloads` capability (`.docx`, `.json`); `.doc` is not allowed.
- **Flow:** Add clients → drop statements, platform CSVs, paraplanning request, file notes, transcripts → Brightly
  sorts them by client (splits a multi-client CSV by its client column) → Brightly builds each profile with a source
  and quote for every balance → adviser checks and confirms → tools.
- **Smart search** (top bar) is rule-based: providers, amounts (200k, over/under), fee type, risk, client/account
  type, holdings, research ratings, review/OFA windows. It never calls Brightly. When it fails (nothing recognised, a
  negative like "haven't", unused words, or no matches) it hands over to **Ask Brightly**, which is a separate button
  and page.

## Advice rules agreed with the user

- **SOA** (just "SOA"): a straight platform or investment switch into one Pearl model. Current investments are
  sold, moved in cash, and invested in the model. No in specie transfer yet: a transition engine (in specie, hybrid
  Pearl and direct shares) will come later.
- **No fee for the advice or the switch.** The existing ongoing fee continues unchanged. Each SOA run also drafts an
  **Ongoing Fee Consent for the new account**.
- **Insurance is out of scope,** but any cover inside a super account being rolled over is flagged in the SOA and the
  checks (it ends if the account closes).
- **No Fact Finder and usually no KYC note:** client data comes from CSVs and PDFs, a paraplanning request, file
  notes, call recordings' transcripts.
- **ROA:** "no change" or "adjust the underlying investments" only.
- **Pearl Lite is the default range** (practice setting; adviser can pick any portfolio). **Pearl Lite is a model
  portfolio, not an MDA:** 0.30% a year management, plus 0.11% of the amount traded per rebalance. **No rebalances
  are assumed** in the yearly figures, but the cost is listed. **Pearl Lite ESG is 0.55%.** Pearl X and Pearl Plus are
  under the DASH MDA (operator fee $120 a year + 0.03%).
- Features of the platforms are treated as the same or similar enough.
- SOA structure follows Brightday's `Master_SOA_Template.docx` (in the user's newsoatool building block), simplified.
  The OFA follows `Ongoing Fee Agreement and Consent Form BDA.docx`. Compliance review by the licensee is parked.

## Data sources (all product data, no client data)

| Data | Source | In the file as |
| --- | --- | --- |
| DASH Super Simplifier: 0.352% to $500k, nil above; expense recovery 0.03% | Super Simplifier PDS, 18 Dec 2024, s.6 (fee-comparison skill, `platform_fees.json`) | `DASHP.super` |
| DASH Wealth Simplifier: 0.165% to $2m, capped $3,000; Brightday concessions | Wealth Simplifier PDS, 1 Jul 2025, s.11 | `DASHP.wealth` |
| DASH MDA operator: $120 a year + 0.03% | DASH Managed Account Service, Schedule 2 | `DASHP.mda` |
| Pearl portfolios: management fee, ICR, establishment brokerage and buy/sell | `dash_pearl_portfolios.json` (Pearl fact sheets, 31 May 2026) | `PEARLP` |
| Pearl model holdings and asset allocation | newsoatool `Portfolio Holdings.xlsx`, `Asset Allocation Tables Risk Profile vs Recommended.xlsx` | `PEARL_DATA` → `product-data/pearl-models.json` |
| Current-product fee schedules (30 platforms and funds) | fee-comparison skill `platform_fees.json` | `PLATFORM_FEES` → `product-data/platform-fees.json` |
| Fiducian Superannuation Service | fiducian.com.au PDS, 13 Jul 2026, s.6 | `PLATFORM_FEES.fiducian_super` |
| Fiducian Investment Service (IDPS) | Investor Guide, 30 Jun 2026 | `PLATFORM_FEES.fiducian_ids` |
| BT Panorama Super (Full menu) | BT Panorama Super PDS p.34 (via fee-comparison skill) | `PLATFORM_FEES.bt_panorama_full` |
| BT Panorama Investments (Full menu) | bt.com.au Investor Guide, fees summary (fetched 29 Sep 2026) | `PLATFORM_FEES.bt_panorama_invest` |
| Underlying fund costs (6,098 funds and ETFs by APIR or ASX code) | Morningstar export supplied by the user, 17 Sep 2026 | `MS_ICR` → `product-data/morningstar-icr.json` |
| Practice details, fee defaults | Brightday SOA template and the user | `PRACTICE` → `product-data/dash-pearl-practice.js` |

Fiducian details: admin 0.33% to $51,250, 0.43% to $300k, 0.33% to $750k, 0.25% to $1.25m, nil above; custody 0.05%
(super) or 0.07% (IDPS); super regulatory recovery 0.08% above $51,250, capped $110; IDPS account fee $27 a month;
holding fee $3.50 a month per Fiducian fund or SMA, $5.15 other funds, nil shares, only above $51,250. ORR
contribution (nil after three years) and the 0.85% cash-account cost are noted, not charged. Managed Portfolios
(SMA) cost 0.40%–1.92% by portfolio: per-portfolio figures are in Fiducian's Investment Booklet, not yet supplied.

**Current fees** for each account come from the statement first, then the product schedule, then the Morningstar
cost of the client's own holdings (listed shares count as nil). The source is shown on every account and printed
in the SOA appendix. A missing admin fee is flagged.

**Findings to remember:** Fiducian clients save clearly with Pearl Lite (e.g. $400k super 1.38% → 0.97%). BT
Panorama depends on holdings: clients in low-cost ETFs cost more on DASH, clients in managed funds save.
Low-cost industry funds (AustralianSuper, Hostplus) usually cost less than DASH.

## Where the user's building blocks live

Not in the repo (the user said not to add them to the skills folder): `client-fee-comparison`, `newsoatool` and
`shared/` from the user's `C:\dev\brightly-skills`. They hold the fee engine, PDS index, features bank, Pearl data,
the Master SOA template, OFA template and scenario library. The inscalc and kycnote skills were never provided.
Never commit real client data (e.g. the "Rodney Steven Collard" fee comparison the user once shared).

## Tests

Needs Node 22, Playwright and Chromium (`executablePath:'/opt/pw-browsers/chromium'` in the scripts; change it for
your machine; pdf.js and the other readers load from cdnjs, so the browser needs network access, via a proxy if there is one).

```bash
cd prototype/tests
node flow.test.js      # full flow on recorded Brightly answers: import, profiles, every tool, .docx, client pack
node fees.test.js      # current-fee auto-fill (BT Panorama, Fiducian, AustralianSuper)
node fid.test.js       # Fiducian schedules against the PDS worked examples
node cmp.test.js; node cmp2.test.js   # Fiducian / Panorama vs DASH + Pearl comparisons
node e2e.test.js       # the same flow with real Brightly answers via the `claude -p` CLI (slow, costs usage)
python3 checkdocx.py ../tests/*.docx  # every generated Word file is well-formed
```

`testdocs/` are made-up: a PDF super statement, a Word paraplanning request, a two-client HUB24 CSV, a file note and
a call transcript. `recorded/` holds real Brightly answers to those documents, generated before the Pearl Lite
default (so the SOA text in them mentions the MDA; a fresh run does not).

## Open items

1. **Dry run on the five real clients** before the demo (the user will do this soon).
2. **Fiducian Managed Portfolios** per-portfolio fees (Investment Booklet) if clients hold them.
3. **Pearl models without holdings data:** Pearl Lite Conservative, Pearl Lite Moderate and the ESG models show a
   placeholder in the SOA.
4. **Transition engine** (in specie, hybrid) replaces the "straight switch" assumption.
5. **Carry the demo into the real portal:** move the tools, prompts, fee logic and templates into `tools/`
   (as skills and registry entries) and `crm/`; make CRM primary buttons Space Cadet via a `brand.json` colour; rename
   the CRM's "Claude" AI-assist card to Brightly.
6. Licensee compliance review of a sample SOA, ROA and OFA (parked by the user).

## Links (private to the user's claude.ai account)

- Live demo: https://claude.ai/artifact/6EhgwDHFBihrQEBbmBBWEN
- Prototype with made-up clients: https://claude.ai/artifact/UjYQB8vHW8XHQW8qwgJJyp
