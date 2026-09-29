#!/usr/bin/env python3
"""
summarise.py - write the adviser-readable summary of a client profile, straight from the JSON.

    python3 <skill>/scripts/summarise.py outputs/client-profile.json "outputs/Client profile - <Name>.md"

Generated, never hand-written, so the summary cannot say anything the JSON does not.
"""
import json
import sys


def money(v):
    return "—" if v is None else f"${v:,.2f}" if abs(v) < 1000 else f"${v:,.0f}"


def pct(v):
    return "—" if v is None else f"{v * 100:.2f}%"


def src(profile, ptr):
    p = profile.get("provenance", {}).get(ptr)
    if not p:
        o = [x for x in profile.get("overrides", []) if x["field"] == ptr]
        return f"override by {o[-1]['who']} ({o[-1]['date']})" if o else "no source"
    docs = {d["id"]: d for d in profile.get("documents", [])}
    d = docs.get(p["doc"], {})
    name = d.get("file", p["doc"]).split("/")[-1]
    return f"{name}, {p['where']}"


def main():
    profile_path, out_path = sys.argv[1], sys.argv[2]
    with open(profile_path, encoding="utf-8") as f:
        p = json.load(f)
    people = {x["id"]: x for x in p["people"]}
    who = lambda i: "Joint" if i == "joint" else f"{people[i]['first_name']} {people[i]['last_name']}" if i in people else i
    L = [f"# Client profile: {p['client']['name']}", "", f"Position as at **{p['as_at']}**, from {sum(1 for d in p['documents'] if d['used'])} document(s). Draft until confirmed in the portal.", ""]

    blocks = [f for f in p["flags"] if f["severity"] == "block"]
    if blocks or p["flags"]:
        L += ["## Needs attention", ""]
        for f in sorted(p["flags"], key=lambda f: ["block", "warn", "info"].index(f["severity"])):
            L.append(f"- **{f['severity'].upper()}** {f['message']}")
            for k, v in (f.get("source_values") or {}).items():
                L.append(f"  - {k}: {v}")
        L.append("")
    if p["gaps"]:
        L += ["## Missing", ""] + [f"- {g['message']}" + (f" (needed for {', '.join(g['needed_for'])})" if g.get("needed_for") else "") for g in p["gaps"]] + [""]

    L += ["## People", "", "| | Name | Date of birth | Occupation | Gross income |", "|---|---|---|---|---|"]
    for i, x in enumerate(p["people"]):
        L.append(f"| {x['role']} | {x['first_name']} {x['last_name']} | {x.get('dob', '—')} | {(x.get('employment') or {}).get('occupation', '—')} | {money((x.get('income') or {}).get('gross_pa'))} |")
    if p.get("dependants"):
        L += ["", "Dependants: " + ", ".join(f"{d['name']}" + (f" ({d['dob']})" if d.get("dob") else "") for d in p["dependants"])]
    rp = p.get("risk_profile")
    L += ["", f"Risk profile: **{rp['profile']}** ({src(p, '/risk_profile/profile')})" if rp else "Risk profile: not stated", ""]
    if p.get("scope"):
        L += ["Scope: " + ", ".join(f"{k.replace('_', ' ')} {v}" for k, v in p["scope"].items()), ""]
    obj = p.get("objectives") or {}
    if obj.get("summary"):
        L += ["## Goals", ""] + [f"- {g}" for g in obj["summary"]] + [""]

    L += ["## Accounts", ""]
    total = 0
    for i, a in enumerate(p["accounts"]):
        total += a["balance"]
        L += [f"### {a['provider']} · {a['product']} ({who(a['owner'])})", "",
              f"- {a['kind'].replace('_', ' ')}{' · ' + a['account_type'] if a.get('account_type') else ''}{' · ' + a['investment_option'] if a.get('investment_option') else ''}",
              f"- Balance **{money(a['balance'])}** as at {a['as_at']} ({src(p, f'/accounts/{i}/balance')})"]
        if a.get("holdings"):
            L += ["", "| Holding | Code | Value | Weight |", "|---|---|---|---|"]
            for h in a["holdings"]:
                L.append(f"| {h['name']} | {h.get('ticker') or h.get('apir') or ''} | {money(h.get('value'))} | {pct(h.get('weight'))} |")
        for c in a.get("insurance") or []:
            amt = money(c.get("sum_insured")) if c.get("sum_insured") is not None else f"{money(c.get('monthly_benefit'))}/month"
            L.append(f"- Cover: {c['cover_type'].upper()} {amt}, premium {money(c.get('premium_pa'))} p.a. ({c.get('structure', 'unknown')})")
        bn = a.get("beneficiary_nomination")
        if bn:
            L.append(f"- Nomination: {bn.get('type', 'unknown').replace('_', ' ')}" + (f", expires {bn['expires']}" if bn.get("expires") else ""))
        L.append("")
    L += [f"**Total across accounts: {money(total)}**", ""]

    if p.get("policies"):
        L += ["## Insurance outside super", ""]
        for x in p["policies"]:
            for c in x["cover"]:
                L.append(f"- {x['insurer']} ({who(x['insured'])}): {c['cover_type'].upper()} {money(c.get('sum_insured') or c.get('monthly_benefit'))}, premium {money(c.get('premium_pa'))} p.a.")
        L.append("")
    if p.get("assets") or p.get("liabilities"):
        L += ["## Assets and liabilities", "", "| | Description | Owner | Amount |", "|---|---|---|---|"]
        for x in p.get("assets", []):
            L.append(f"| Asset | {x.get('description') or x['kind']} | {who(x.get('owner', ''))} | {money(x['value'])} |")
        for x in p.get("liabilities", []):
            L.append(f"| Debt | {x.get('description') or x['kind']} | {who(x.get('owner', ''))} | {money(x['balance'])} |")
        L.append("")
    if p.get("changes"):
        L += ["## Changed since the last confirmed profile", ""] + [f"- {c['field']}: {c.get('from', '—')} → {c['to']}" for c in p["changes"]] + [""]
    L += ["## Documents", ""] + [f"- {d['id']} · {d['file'].split('/')[-1]} · {d['type'].replace('_', ' ')}{' · ' + d['as_at'] if d.get('as_at') else ''}{'' if d['used'] else ' · not used'}{' · ' + d['notes'] if d.get('notes') else ''}" for d in p["documents"]]
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\n".join(L) + "\n")
    print("Saved " + out_path)


if __name__ == "__main__":
    main()
