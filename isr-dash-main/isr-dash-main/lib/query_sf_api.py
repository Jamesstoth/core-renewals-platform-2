#!/usr/bin/env python3
"""
DEPRECATED — replaced by query_sf_mcp.py.
The mcp-client-2025-04-04 Anthropic beta this relied on no longer exists.
"""
import sys, os
print(f"ERROR: query_sf_api.py is deprecated. Called from: {os.getcwd()}", file=sys.stderr)
print(f"  args: {sys.argv}", file=sys.stderr)
print(f"  Use query_sf_mcp.py instead.", file=sys.stderr)
sys.exit(1)

"""ORIGINAL DOCSTRING (kept for reference):
Queries Salesforce via the Anthropic API with remote MCP (no Claude CLI, no local SSE).
Anthropic's servers handle the MCP protocol; we get a normal API response.

Required environment variables:
  ANTHROPIC_API_KEY   Anthropic API key
  SF_MCP_TOKEN        JWT token for the Salesforce MCP server

Usage:
  python3 lib/query_sf_api.py data/sf_latest.json
  python3 lib/query_sf_api.py data/sf_activities_latest.json --soql-key activities_soql
"""

import os, sys, json, re, calendar, time
from datetime import date

try:
    import anthropic
except ImportError:
    print("pip install anthropic", file=sys.stderr)
    sys.exit(1)

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

# ── date window ────────────────────────────────────────────────────────────────
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

# ── Anthropic client with remote MCP ──────────────────────────────────────────
TOKEN   = os.environ['SF_MCP_TOKEN']
MCP_URL = f"https://mcp.csaiautomations.com/salesforce/mcp/?token={TOKEN}"

client = anthropic.Anthropic(timeout=120.0)

MCP_TOOL = {
    "type": "mcp",
    "server_label": "salesforce",
    "server_url": MCP_URL,
    "tool_names": ["sf_query"],
}

def extract_records(text):
    """Parse SF records from Claude's text response."""
    text = text.strip()
    for pat in [r'(\[[\s\S]*\])', r'(\{[\s\S]*\})']:
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
    return None  # None = parse failed, distinct from empty list

def query_page(soql_paged, retries=3):
    last_err = None
    for attempt in range(1, retries + 1):
        try:
            response = client.beta.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=8096,
                tools=[MCP_TOOL],
                messages=[{
                    "role": "user",
                    "content": (
                        "Use the sf_query tool with tenantId 'trilogy' to run this SOQL. "
                        "Return ONLY a raw JSON array of records, no explanation.\n"
                        f"SOQL: {soql_paged}"
                    ),
                }],
                betas=["mcp-client-2025-04-04"],
            )
            for block in response.content:
                if hasattr(block, 'text'):
                    recs = extract_records(block.text)
                    if recs is not None:
                        return recs
                    # parse failed — log and retry
                    print(f"  → Attempt {attempt}: could not parse records from response (len={len(block.text)})", file=sys.stderr)
                    last_err = f"parse failure on attempt {attempt}"
                    break
            else:
                last_err = f"no text block in response on attempt {attempt}"
                print(f"  → Attempt {attempt}: {last_err}", file=sys.stderr)
        except Exception as e:
            last_err = str(e)
            print(f"  → Attempt {attempt} error: {last_err}", file=sys.stderr)

        if attempt < retries:
            time.sleep(2 ** attempt)  # 2s, 4s backoff

    raise RuntimeError(f"query_page failed after {retries} attempts: {last_err}")

# ── paginated query ────────────────────────────────────────────────────────────
PAGE        = 200
all_records = []
offset      = 0

while True:
    paged = f"{soql} LIMIT {PAGE} OFFSET {offset}"
    recs  = query_page(paged)

    for rec in recs:
        rec.pop('attributes', None)
        for v in rec.values():
            if isinstance(v, dict):
                v.pop('attributes', None)

    all_records.extend(recs)
    print(f"  → Page {offset // PAGE + 1}: {len(recs)} records  (total: {len(all_records)})", file=sys.stderr)

    if len(recs) < PAGE:
        break
    offset += PAGE

# ── guard against empty result ─────────────────────────────────────────────────
if not all_records:
    print(f"ERROR: 0 records returned for soql_key='{soql_key}' — refusing to overwrite existing data", file=sys.stderr)
    sys.exit(1)

# ── write output ───────────────────────────────────────────────────────────────
os.makedirs(os.path.dirname(os.path.abspath(OUT_FILE)), exist_ok=True)
with open(OUT_FILE, 'w') as f:
    json.dump(all_records, f)
print(f"  → Saved {len(all_records)} records to {OUT_FILE}", file=sys.stderr)
