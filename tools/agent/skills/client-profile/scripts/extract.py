#!/usr/bin/env python3
"""
extract.py - turn every file under ./inputs (and ./context) into plain text the agent can read and cite.

    python3 <skill>/scripts/extract.py [--inputs inputs] [--context context] [--out work/extracted]

Writes one .md per source file into work/extracted/ and prints an inventory (JSON) to stdout:
    [{"file": "inputs/documents/statement.pdf", "text": "work/extracted/...md", "kind": "pdf", "pages": 4,
      "chars": 5120, "needs_visual": false, "note": ""}]

Every value in the extracted text carries a locator, so the profile can cite it:
  spreadsheets   one line per non-empty cell, "Sheet!B94 = 275812", plus a row view pairing labels with values
  Word           paragraphs, then tables as "Table 2, row 3: cell | cell | cell"
  PDF            text per page under "## Page N" (pdftotext -layout, else pypdf)
  email (.eml)   headers and the text body; attachments are saved and extracted too

`needs_visual: true` means there is little or no text to extract (a scanned PDF, a photo, a screenshot): read
that file directly with the Read tool, which shows PDF pages and images to you.
Standard library plus whatever of openpyxl / python-docx / pypdf / xlrd is installed; nothing here uses the network.
"""
import argparse
import datetime as dt
import email
import email.policy
import json
import os
import re
import shutil
import subprocess
import sys

IMAGE = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".heic", ".bmp", ".tif", ".tiff"}


def cell_str(v):
    if v is None:
        return ""
    if isinstance(v, dt.datetime):
        return v.date().isoformat() if v.time() == dt.time(0) else v.isoformat(sep=" ")
    if isinstance(v, dt.date):
        return v.isoformat()
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v).strip()


def col_letter(n):
    s = ""
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def sheet_lines(name, rows):
    """rows: list of lists (0-indexed). Emits a row view and a cell index."""
    out = [f"## Sheet: {name}", ""]
    for r_i, row in enumerate(rows, start=1):
        cells = [(c_i, cell_str(v)) for c_i, v in enumerate(row, start=1)]
        cells = [(c, v) for c, v in cells if v not in ("", "None")]
        if not cells:
            continue
        out.append(f"Row {r_i}: " + " | ".join(f"{col_letter(c)}{r_i}={v}" for c, v in cells))
    return out


def from_xlsx(path):
    import openpyxl
    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    lines, n = [], 0
    for ws in wb.worksheets:
        rows = [list(r) for r in ws.iter_rows(values_only=True)]
        if ws.sheet_state != "visible":
            lines.append(f"(sheet '{ws.title}' is hidden)")
        lines += sheet_lines(ws.title, rows) + [""]
        n += 1
    return lines, {"sheets": n}


def from_xls(path):
    try:
        import xlrd
    except ImportError:
        return ["(.xls needs xlrd, which is not installed: ask for the file saved as .xlsx)"], {"note": "xls unsupported"}
    wb = xlrd.open_workbook(path)
    lines = []
    for sh in wb.sheets():
        rows = []
        for r in range(sh.nrows):
            row = []
            for c in range(sh.ncols):
                cell = sh.cell(r, c)
                if cell.ctype == xlrd.XL_CELL_DATE:
                    row.append(xlrd.xldate.xldate_as_datetime(cell.value, wb.datemode))
                else:
                    row.append(cell.value)
            rows.append(row)
        lines += sheet_lines(sh.name, rows) + [""]
    return lines, {"sheets": wb.nsheets}


def from_csv(path):
    import csv
    with open(path, newline="", encoding="utf-8-sig", errors="replace") as f:
        rows = list(csv.reader(f))
    return sheet_lines(os.path.basename(path), rows), {"rows": len(rows)}


def from_docx(path):
    import docx
    d = docx.Document(path)
    lines = [p.text for p in d.paragraphs if p.text.strip()]
    for t_i, table in enumerate(d.tables, start=1):
        lines.append("")
        lines.append(f"## Table {t_i}")
        for r_i, row in enumerate(table.rows, start=1):
            seen, cells = set(), []
            for c in row.cells:  # merged cells repeat; keep the first
                if id(c._tc) in seen:
                    continue
                seen.add(id(c._tc))
                cells.append(c.text.strip().replace("\n", " / "))
            lines.append(f"Table {t_i}, row {r_i}: " + " | ".join(cells))
    return lines, {"paragraphs": len(d.paragraphs), "tables": len(d.tables)}


def from_doc(path):
    if shutil.which("antiword"):
        r = subprocess.run(["antiword", path], capture_output=True, text=True)
        if r.returncode == 0:
            return r.stdout.splitlines(), {}
    return ["(legacy .doc could not be read: ask for it saved as .docx or PDF)"], {"note": "doc unsupported"}


def from_pdf(path):
    pages = []
    if shutil.which("pdftotext"):
        r = subprocess.run(["pdftotext", "-layout", path, "-"], capture_output=True, text=True)
        if r.returncode == 0:
            pages = r.stdout.split("\f")
        elif "Incorrect password" in r.stderr or "encrypted" in r.stderr.lower():
            return ["(PDF is password-protected: ask for an unlocked copy)"], {"note": "password-protected", "pages": 0}
    if not pages:
        try:
            import pypdf
            reader = pypdf.PdfReader(path)
            if reader.is_encrypted:
                return ["(PDF is password-protected: ask for an unlocked copy)"], {"note": "password-protected", "pages": 0}
            pages = [(p.extract_text() or "") for p in reader.pages]
        except Exception as e:  # noqa: BLE001 - report, never crash the inventory
            return [f"(PDF could not be read: {e})"], {"note": "unreadable", "pages": 0}
    pages = [p for p in pages]
    if pages and not pages[-1].strip():
        pages = pages[:-1]
    lines = []
    for i, p in enumerate(pages, start=1):
        lines += [f"## Page {i}", p.rstrip(), ""]
    text_chars = sum(len(p.strip()) for p in pages)
    return lines, {"pages": len(pages), "needs_visual": len(pages) > 0 and text_chars / max(1, len(pages)) < 80}


def from_eml(path, attach_dir, inventory, args):
    with open(path, "rb") as f:
        msg = email.message_from_binary_file(f, policy=email.policy.default)
    lines = [f"From: {msg['from']}", f"To: {msg['to']}", f"Cc: {msg['cc'] or ''}", f"Date: {msg['date']}", f"Subject: {msg['subject']}", ""]
    body = msg.get_body(preferencelist=("plain", "html"))
    if body is not None:
        text = body.get_content()
        if body.get_content_type() == "text/html":
            text = re.sub(r"<[^>]+>", " ", text)
        lines += text.splitlines()
    saved = []
    for part in msg.iter_attachments():
        name = safe(part.get_filename() or "attachment")
        os.makedirs(attach_dir, exist_ok=True)
        dest = os.path.join(attach_dir, name)
        with open(dest, "wb") as f:
            f.write(part.get_payload(decode=True) or b"")
        saved.append(dest)
    if saved:
        lines += ["", "Attachments (extracted separately): " + ", ".join(os.path.basename(s) for s in saved)]
    for s in saved:
        inventory.append(extract_one(s, args, inventory))
    return lines, {"attachments": len(saved)}


def safe(name):
    return re.sub(r"[^\w.\- ()]+", "_", os.path.basename(name)).strip() or "file"


def extract_one(path, args, inventory):
    ext = os.path.splitext(path)[1].lower()
    rel = os.path.relpath(path)
    out_name = re.sub(r"[^\w.\-]+", "_", rel) + ".md"
    out_path = os.path.join(args.out, out_name)
    entry = {"file": rel, "text": os.path.relpath(out_path), "kind": ext.lstrip(".") or "unknown", "needs_visual": False, "note": ""}
    try:
        if ext in (".xlsx", ".xlsm"):
            lines, meta = from_xlsx(path)
        elif ext == ".xls":
            lines, meta = from_xls(path)
        elif ext == ".csv":
            lines, meta = from_csv(path)
        elif ext == ".docx":
            lines, meta = from_docx(path)
        elif ext == ".doc":
            lines, meta = from_doc(path)
        elif ext == ".pdf":
            lines, meta = from_pdf(path)
        elif ext == ".eml":
            lines, meta = from_eml(path, os.path.join(args.out, "attachments", safe(path)), inventory, args)
        elif ext in IMAGE:
            lines, meta = [f"(image: read {rel} directly with the Read tool)"], {"needs_visual": True}
        elif ext == ".msg":
            lines, meta = ["(Outlook .msg is not supported: ask for the email saved as .eml or PDF)"], {"note": "msg unsupported"}
        elif ext in (".txt", ".md", ".json"):
            with open(path, encoding="utf-8", errors="replace") as f:
                lines, meta = f.read().splitlines(), {}
        else:
            lines, meta = [f"(no extractor for {ext}: read it directly if it is text or an image)"], {"note": "unsupported type"}
    except Exception as e:  # noqa: BLE001 - one bad file must not stop the rest
        lines, meta = [f"(could not extract: {type(e).__name__}: {e})"], {"note": "extraction failed"}
    entry.update({k: v for k, v in meta.items() if k in ("pages", "sheets", "tables", "attachments", "rows", "needs_visual", "note")})
    text = "\n".join([f"# {rel}", ""] + lines) + "\n"
    entry["chars"] = len(text)
    os.makedirs(args.out, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(text)
    return entry


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--inputs", default="inputs")
    ap.add_argument("--context", default="context")
    ap.add_argument("--out", default="work/extracted")
    args = ap.parse_args()
    inventory = []
    for root in (args.inputs, args.context):
        if not os.path.isdir(root):
            continue
        for dirpath, _, files in os.walk(root):
            for name in sorted(files):
                inventory.append(extract_one(os.path.join(dirpath, name), args, inventory))
    json.dump(inventory, sys.stdout, indent=2)
    print()


if __name__ == "__main__":
    main()
