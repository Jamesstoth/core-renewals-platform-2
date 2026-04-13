#!/usr/bin/env python3
"""
Queries Salesforce via Claude CLI + MCP (sf_query tool).
Used by GitHub Actions to refresh dashboard data without a Connected App.

Required environment variables:
  ANTHROPIC_API_KEY   Anthropic API key (for claude -p)

Required setup:
  ~/.config/claude/mcp.json must have the 'salesforce' MCP server configured.

Usage:
  python3 lib/query_sf_claude.py data/sf_latest.json
  python3 lib/query_sf_claude.py data/sf_activities_latest.json --soql-key activities_soql
"""

import os, sys, json, re, subprocess, calendar
from datetime import date

# ── args ───────────────────────────────────────────────────────────────────────
OUT_FILE = sys.argv[1] if len(sys.argv) > 1 else 'data/sf_latest.json'
soql_key = 'soql'
for i, arg in enumerate(sys.argv):
    if arg == '--soql-key' and i + 1 < len(sys.argv):
        soql_key = sys.argv[i + 1]

# ── load config ────────────────────────────────────────────────────────────────
with open('config.json') as f:
    config = json.load(f)

soql_template = config[soql_key]
back_months   = int(config.get('date_window_back_months', 1))
fwd_months    = int(config.get('date_window_forward_months', 6))

# ── date window (only used for opportunities SOQL) ────────────────────────────
today = date.today()

m, y = today.month - back_months, today.year
while m <= 0: m += 12; y -= 1
date_from = date(y, m, min(today.day, calendar.monthrange(y, m)[1])).isoformat()

m, y = today.month + fwd_months, today.year
while m > 12: m -= 12; y += 1
date_to = date(y, m, min(today.day, calendar.monthrange(y, m)[1])).isoformat()

soql = soql_template.replace('{date_from}', date_from).replace('{date_to}', date_to)
if soql_key == 'soql':
    print(f"  → Date range: {date_from} → {date_to}", file=sys.stderr)
print(f"  → SOQL key: {soql_key}", file=sys.stderr)

# ── parse JSON from claude output ─────────────────────────────────────────────
def extract(text):
    text = text.strip()
    try:
        p = json.loads(text)
        if isinstance(p, list): return p
        if isinstance(p, dict):
            for k in ('records', 'data', 'result'):
                if k in p and isinstance(p[k], list): return p[k]
    except Exception:
        pass
    for pat in [r'```(?:json)?\s*(\[[\s\S]*?\])\s*```',
                r'(\[[\s\S]*\])', r'(\{[\s\S]*\})']:
        m = re.search(pat, text)
        if m:
            try:
                p = json.loads(m.group(1))
                if isinstance(p, list): return p
                if isinstance(p, dict):
                    for k in ('records', 'data', 'result'):
                        if k in p and isinstance(p[k], list): return p[k]
            except Exception:
                pass
    return []

# ── paginated query via claude -p ─────────────────────────────────────────────
PAGE        = 200
all_records = []
offset      = 0

while True:
    paged = f"{soql} LIMIT {PAGE} OFFSET {offset}"
    prompt = (
        "Use the mcp__salesforce__sf_query tool with tenantId 'trilogy' "
        "to run this SOQL and return ONLY a raw JSON array, no markdown, no explanation. "
        f"SOQL: {paged}"
    )
    result = subprocess.run(
        ["claude", "-p", prompt, "--allowedTools", "mcp__salesforce__sf_query"],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        print(f"  → claude error (offset {offset}): {result.stderr[:300]}", file=sys.stderr)
        break

    page_recs = extract(result.stdout)
    if not page_recs:
        print(f"  → No records returned at offset {offset}, stopping.", file=sys.stderr)
        break

    all_records.extend(page_recs)
    print(f"  → Page {offset // PAGE + 1}: {len(page_recs)} records  (total: {len(all_records)})", file=sys.stderr)

    if len(page_recs) < PAGE:
        break
    offset += PAGE

# ── write output ───────────────────────────────────────────────────────────────
os.makedirs(os.path.dirname(os.path.abspath(OUT_FILE)), exist_ok=True)
with open(OUT_FILE, 'w') as f:
    json.dump(all_records, f)
print(f"  → Saved {len(all_records)} records to {OUT_FILE}", file=sys.stderr)
