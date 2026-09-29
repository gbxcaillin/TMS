#!/usr/bin/env python3
"""
validate_profile.py - check a client profile before anyone relies on it.

    python3 <skill>/scripts/validate_profile.py outputs/client-profile.json

Prints a JSON report {"ok": bool, "errors": [...], "warnings": [...]} and exits 1 when there are errors.
Errors must be fixed (or the value removed and listed under gaps). Warnings must each be either fixed or carried
into the profile's `flags` so the adviser sees them.

Checks, in order:
  1. The JSON Schema (references/client-profile.schema.json), when the jsonschema package is installed.
  2. Structural rules the schema cannot express:
     - ids are unique; every owner / insured / about / secured_against points at something that exists
     - every figure that matters has provenance, and every provenance entry cites a real document
     - *_pct fields are decimals (a value like 58 or 0.58 for an ICR is almost certainly a percent typed as a number)
     - holdings reconcile with the account: weights sum to 1 (cash excluded) and values sum to the balance, within 2%
     - an insurer is never recorded as a super fund provider (newsoatool entity_model rule)
     - dates are real and not in the future; as_at is the latest date relied on
Standard library only, apart from the optional jsonschema.
"""
import datetime as dt
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SCHEMA = os.path.join(HERE, "..", "references", "client-profile.schema.json")

# Same list and matching rule as newsoatool/entity_model.py KNOWN_INSURERS.
KNOWN_INSURERS = ("TAL", "Zurich", "NEOS", "AIA", "MLC", "OnePath", "MetLife", "ClearView", "Resolution Life")
# Funds whose trustee brand is also an insurer brand: allowed as a fund provider.
INSURER_FUND_EXCEPTIONS = ("MLC Super", "MLC MasterKey", "MLC Wrap", "MLC Navigator", "AIA Super")

# Figures that must say where they came from (JSON pointer patterns).
NEEDS_SOURCE = [
    r"^/accounts/\d+/balance$",
    r"^/accounts/\d+/holdings/\d+/(value|units|weight|cost_base)$",
    r"^/accounts/\d+/insurance/\d+/(sum_insured|monthly_benefit|premium_pa)$",
    r"^/accounts/\d+/(investment_option|account_type)$",
    r"^/people/\d+/(dob|income/gross_pa|income/salary_sacrifice_pa)$",
    r"^/policies/\d+/cover/\d+/(sum_insured|monthly_benefit|premium_pa)$",
    r"^/assets/\d+/value$",
    r"^/liabilities/\d+/balance$",
    r"^/risk_profile/profile$",
    r"^/tax/(realised_gains|carried_forward_losses)$",
    r"^/advice_arrangement/(ongoing_fee_pa|ongoing_fee_pct)$",
]
PCT_LIMITS = {  # upper bounds that are generous but catch "58" or "0.58 meaning 58 basis points"
    "icr": 0.05, "sgc_pct": 0.2, "cash_pct": 1.0, "ongoing_pct": 0.05, "ongoing_fee_pct": 0.05,
    "marginal_rate_pct": 0.5, "rate_pct": 0.3, "return_1yr_pct": 1.0, "return_5yr_pa_pct": 0.6,
}


def pointers(node, base=""):
    """Yield (pointer, value) for every leaf."""
    if isinstance(node, dict):
        for k, v in node.items():
            yield from pointers(v, f"{base}/{k}")
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from pointers(v, f"{base}/{i}")
    else:
        yield base, node


def parse_date(s):
    try:
        return dt.date.fromisoformat(s)
    except (TypeError, ValueError):
        return None


def validate(profile, today=None):
    today = today or dt.date.today()
    errors, warnings = [], []
    err, warn = errors.append, warnings.append

    # 1. Schema
    try:
        import jsonschema
        with open(SCHEMA, encoding="utf-8") as f:
            schema = json.load(f)
        v = jsonschema.Draft202012Validator(schema)
        for e in sorted(v.iter_errors(profile), key=lambda e: list(e.absolute_path)):
            path = "/" + "/".join(str(p) for p in e.absolute_path)
            err(f"schema {path}: {e.message}")
    except ImportError:
        warn("jsonschema is not installed: only the structural checks ran")
    if errors:
        return errors, warnings  # structural checks assume a schema-valid shape

    people = {p["id"] for p in profile.get("people", [])}
    docs = {d["id"] for d in profile.get("documents", [])}
    assets = {a["id"] for a in profile.get("assets", [])}

    # 2a. Unique ids and references
    for coll in ("people", "accounts", "policies", "assets", "liabilities", "documents"):
        ids = [x.get("id") for x in profile.get(coll, [])]
        dup = {i for i in ids if ids.count(i) > 1}
        if dup:
            err(f"/{coll}: duplicate ids {sorted(dup)}")
    owners_ok = people | {"joint"}
    for i, a in enumerate(profile.get("accounts", [])):
        if a["owner"] not in owners_ok:
            err(f"/accounts/{i}/owner: '{a['owner']}' is not a person id or 'joint'")
    for coll in ("assets", "liabilities"):
        for i, x in enumerate(profile.get(coll, [])):
            if x.get("owner") and x["owner"] not in owners_ok:
                err(f"/{coll}/{i}/owner: '{x['owner']}' is not a person id or 'joint'")
    for i, p in enumerate(profile.get("policies", [])):
        if p["insured"] not in people:
            err(f"/policies/{i}/insured: '{p['insured']}' is not a person id")
    for i, l in enumerate(profile.get("liabilities", [])):
        if l.get("secured_against") and l["secured_against"] not in assets:
            err(f"/liabilities/{i}/secured_against: '{l['secured_against']}' is not an asset id")
    for i, d in enumerate(profile.get("documents", [])):
        if d.get("about") and d["about"] not in people:
            err(f"/documents/{i}/about: '{d['about']}' is not a person id")

    # 2b. Provenance
    prov = profile.get("provenance", {})
    for ptr, src in prov.items():
        if src["doc"] not in docs:
            err(f"provenance {ptr}: cites '{src['doc']}', which is not in documents")
    leaves = dict(pointers({k: v for k, v in profile.items() if k not in ("provenance", "flags", "gaps", "documents", "overrides", "changes")}))
    for ptr in prov:
        if ptr not in leaves and not any(p.startswith(ptr + "/") for p in leaves):
            warn(f"provenance {ptr}: points at nothing in the profile")
    overridden = {o["field"] for o in profile.get("overrides", [])}
    for ptr, val in leaves.items():
        if val is None or val == "":
            continue
        if any(re.match(p, ptr) for p in NEEDS_SOURCE) and ptr not in prov and ptr not in overridden:
            err(f"{ptr}: no provenance (say which document and where, or record it as an override)")
    used = {s["doc"] for s in prov.values()}
    for d in profile.get("documents", []):
        if d["used"] and d["id"] not in used:
            warn(f"document {d['id']} ({d['file']}) is marked used but nothing cites it")

    # 2c. Percent fields are decimals
    for ptr, val in leaves.items():
        if not isinstance(val, (int, float)) or isinstance(val, bool):
            continue
        key = ptr.rsplit("/", 1)[-1]
        if key.endswith("_pct"):
            limit = PCT_LIMITS.get(key, 1.0)
            if abs(val) > limit:
                err(f"{ptr}: {val} looks like a percent written as a whole number; *_pct fields are decimals (0.0058 = 0.58%)")

    # 2d. Holdings reconcile with the balance
    for i, a in enumerate(profile.get("accounts", [])):
        hs = a.get("holdings") or []
        if not hs:
            continue
        cash = a.get("cash_pct") or 0
        weights = [h["weight"] for h in hs if "weight" in h]
        if weights and len(weights) == len(hs):
            s = sum(weights)
            if abs(s - 1) > 0.02 and abs(s + cash - 1) > 0.02:
                warn(f"/accounts/{i}/holdings: weights sum to {s:.4f}, not 1 (cash excluded)")
        values = [h["value"] for h in hs if "value" in h]
        if values and len(values) == len(hs) and a["balance"]:
            s = sum(values)
            gap = abs(s - a["balance"]) / a["balance"]
            if gap > 0.02:
                warn(f"/accounts/{i}/holdings: values total ${s:,.2f} against a balance of ${a['balance']:,.2f} ({gap:.1%} apart); check for a cash holding or a different as_at date")

    # 2e. An insurer is never a super fund
    for i, a in enumerate(profile.get("accounts", [])):
        if a["kind"] in ("super", "pension", "ttr_pension"):
            name = f"{a['provider']} {a['product']}"
            if any(x.lower() in name.lower() for x in INSURER_FUND_EXCEPTIONS):
                continue
            for ins in KNOWN_INSURERS:
                if re.search(rf"\b{re.escape(ins)}\b", a["provider"], re.IGNORECASE):
                    err(f"/accounts/{i}/provider: '{a['provider']}' is an insurer, not a super fund; record the cover under policies (entity_model rule)")

    # 2f. Dates
    latest = None
    for ptr, val in leaves.items():
        if isinstance(val, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", val):
            d = parse_date(val)
            if not d:
                err(f"{ptr}: {val} is not a real date")
                continue
            is_future_ok = ptr.endswith(("/expires", "ofa_renewal_date"))
            if d > today and not is_future_ok:
                err(f"{ptr}: {val} is in the future")
            if ptr.endswith("/as_at"):
                latest = max(latest or d, d)
    top = parse_date(profile.get("as_at"))
    if latest and top and top < latest:
        warn(f"/as_at: {profile['as_at']} is earlier than the newest account date {latest.isoformat()}")

    # 2g. Things the adviser should see even if not wrong
    for i, a in enumerate(profile.get("accounts", [])):
        t = (a.get("account_type") or "").strip()
        if a["kind"] in ("super", "pension", "ttr_pension") and t and t.lower() != "accumulation":
            warn(f"/accounts/{i}: account_type '{t}' is excluded from fee comparisons; make sure a flag says so")
    if not profile.get("risk_profile"):
        warn("/risk_profile: missing; list it under gaps if no document states it")
    return errors, warnings


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)
    with open(sys.argv[1], encoding="utf-8") as f:
        try:
            profile = json.load(f)
        except json.JSONDecodeError as e:
            print(json.dumps({"ok": False, "errors": [f"not valid JSON: {e}"], "warnings": []}, indent=2))
            sys.exit(1)
    errors, warnings = validate(profile)
    print(json.dumps({"ok": not errors, "errors": errors, "warnings": warnings}, indent=2))
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
