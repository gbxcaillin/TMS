# Field guide: where each fact comes from

## Documents and what to take from them

| Type | Usually from | Take |
| --- | --- | --- |
| `fact_finder` | Brightday Fact Finder (.xlsx) | People, contact, employment, income and contributions, retirement ages, spouse, dependants, assets, liabilities, super fund list (name, option, balance, 5-year return, contributions, insurance, nomination), `account_type` from the "Fund Type (Accumulation/Defined Benefit)" row. Newer templates keep the answers on the **Type Here** sheet (column C) and leave the **Fact Finder** sheet as labels; read whichever has values. Funds 2–4 sit in further columns. |
| `kyc_note` | KYC File Note (.docx) | Risk profile, scope (in/out per topic), **Client Goals Summary** verbatim into `objectives.summary`, per-topic goals, and **corrections** to the Fact Finder ("outdated", "should be treated as current", "not captured in the Fact Finder", "has since changed", "actually", "correction", "updated figure"). Text saying something is "not in scope" near salary sacrifice / contributions or insurance sets that scope to `out`. |
| `super_statement` | Annual/periodic member statement (PDF) | Balance and `as_at`, investment option, fees charged in the period (`fees_on_statement`), insurance cover and premiums, beneficiary nomination and expiry, contributions, 1- and 5-year returns. |
| `platform_report` / `holdings_report` | HUB24, Netwealth, BT, Macquarie, CFS, DASH portfolio valuation (PDF/CSV/XLSX) | Balance, every holding with ticker/APIR, units, price, value; weights = value ÷ (balance − cash); cash holding as `cash_pct`. |
| `cgt_report` | Unrealised/realised CGT report | Parcels per holding (acquired, units, cost base, value, unrealised gain); realised gains for the year into `tax.realised_gains`; carried-forward losses if shown. |
| `transaction_report` | Platform transaction listing | Only what it states: contributions, switches, fees debited. Use it to date changes, not for balances. |
| `insurance_policy` / `insurance_quote` | Policy schedule, OMNILife quote | Existing cover: insurer, policy number, owner and funding, cover types, sums insured, IP benefit/waiting/benefit periods, premiums. A **quote** is not held cover: record it as a document and mention it in the summary only. |
| `inscalc` | inscalc results JSON | Nothing into held cover. Needs-analysis figures stay in inscalc; note the file as a document so later tools find it. |
| `pds` | Product disclosure statement | Not a source of client facts. Record it as a document (`used: false`) for the fee skills. |
| `email` | Client or provider emails (.eml, CRM emails.md) | Facts the client states ("my new salary is…", "we sold the investment property") as dated evidence, cited by date and sender. Treat as weaker than a statement for balances. |
| `screenshot` | Member-portal screenshots, photos | Read visually. Cite as `"where": "screenshot, 'Account balance' tile"`. Capture the date shown on screen for `as_at`; if none is visible, flag it. |
| `crm_record` | `context/client.json`, `emails.md`, `meetings.json`, `file-notes.md`, `tasks.json` | Name, contact details, owner adviser; client notes and file notes as evidence (dated). |
| `previous_profile` | `context/client-profile.json` | The starting point for an update (see SKILL.md step 4). |

## When sources disagree

Apply in order; the first rule that decides it wins. Flag every disagreement anyway (`warn`), naming each value
and its source, so the adviser can see what was set aside.

1. **An override** in the previous profile or this run's corrections.
2. **The KYC note's explicit correction** of a Fact Finder value, for any field (figures, address, names, fund,
   marital status, beneficiary intent). The KYC note is the later, verified record.
3. **For balances, holdings, cover and nominations: the document with the latest `as_at`**, with product
   statements beating the Fact Finder at the same date. Keep that document's date in the account's `as_at`.
4. **For personal and household facts: the latest dated document** that states it plainly.
5. Otherwise it is not settled: `block` flag, `chosen_value: null`, field left out, and a gap.

Never average or blend two figures.

## Mapping to the tools that read the profile

| Profile | Fee engine scenario (client-fee-comparison) | newsoatool Fact Finder code / config | inscalc input |
| --- | --- | --- | --- |
| `accounts[].provider` + `product` | `accounts[].product` (resolved to a `platform_fees.json` key by the fee skill) | CurrentSuperFunds | |
| `accounts[].balance` | `accounts[].balance` | SuperBalance (per fund) | |
| `accounts[].account_type` | `accounts[].account_type` (non-Accumulation excluded) | Fund Type row | |
| `accounts[].holdings[]` ticker/apir + weight | `investments[]` `{ticker|code, weight}` | holdings table | |
| `accounts[].cash_pct` | `cash_pct` | | |
| `accounts[].adviser_fee` | `adviser_fees.ongoing_pct` / `ongoing_fixed` | OFA fee | |
| `accounts[].insurance[]` | | group cover per fund (entity_model cover item) | existing cover |
| `policies[]` | | standalone policies (entity_model make_policy) | existing cover |
| `accounts[].performance.return_5yr_pa_pct` | | `current_5yr_return` | |
| `accounts[].investment_option` | | `current_option` | |
| `people[].income.gross_pa` | | ClientIncome | `annual_gross_income` |
| `liabilities[]` (non-home) | | debts | `other_debts` |
| `assets[kind=cash]` | | liquid assets | `liquid_savings` |
| `risk_profile.profile` | Pearl model choice (with the adviser) | `risk_profile` / `model` | |
| `scope.*` | | `no_insurance`, `no_salsac` toggles | |
| `objectives.summary` | | `{{YourGoalsAndObjectives}}` | |
| `objectives.by_topic.*` | | `{{SuperGoal}}`, `{{InsuranceGoal}}`, … | |
| `overrides[]` | | `overrides.json` (shared/overrides.py shape) | |
| `holdings[].parcels`, `tax.*` | activity costs for sells | | |
