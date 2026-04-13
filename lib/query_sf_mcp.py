#!/usr/bin/env python3
"""
Queries Salesforce via the MCP HTTP server.
Streams SSE line-by-line so we exit as soon as the result arrives
(no waiting for the server to close the stream).

Required environment variables:
  SF_MCP_TOKEN   JWT token for the Salesforce MCP server

Usage:
  python3 lib/query_sf_mcp.py data/sf_latest.json
  python3 lib/query_sf_mcp.py data/sf_activities_latest.json --soql-key activities_soql
"""

import os, sys, json, calendar, subprocess, tempfile, time
from datetime import date, timedelta

# ── args ───────────────────────────────────────────────────────────────────────
OUT_FILE    = sys.argv[1] if len(sys.argv) > 1 else 'data/sf_latest.json'
soql_key    = 'soql'
allow_empty = False
for i, arg in enumerate(sys.argv):
    if arg == '--soql-key' and i + 1 < len(sys.argv):
        soql_key = sys.argv[i + 1]
    if arg == '--allow-empty':
        allow_empty = True

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

date_7_days_ago = (date.today() - timedelta(days=7)).isoformat()

soql = (soql_template
        .replace('{date_from}', date_from)
        .replace('{date_to}', date_to)
        .replace('{date_7_days_ago}', date_7_days_ago))
if soql_key == 'soql':
    print(f"  → Date range: {date_from} → {date_to}", file=sys.stderr)
print(f"  → SOQL key: {soql_key}", file=sys.stderr)

# ── MCP client ─────────────────────────────────────────────────────────────────
TOKEN   = os.environ['SF_MCP_TOKEN']
MCP_URL = f"https://mcp.csaiautomations.com/salesforce/mcp/?token={TOKEN}"

def mcp_post(body_dict, session_id=None, timeout=90):
    """POST to MCP server; wait for full response then parse SSE data lines."""
    with tempfile.NamedTemporaryFile(delete=False, suffix='.hdr', mode='w') as hf:
        header_file = hf.name
    try:
        cmd = [
            'curl', '-s', '-m', str(timeout),
            '-X', 'POST', MCP_URL,
            '-H', 'Content-Type: application/json',
            '-H', 'Accept: application/json, text/event-stream',
            '-D', header_file,
            '-d', json.dumps(body_dict),
        ]
        if session_id:
            cmd += ['-H', f'mcp-session-id: {session_id}']

        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout + 10)
        if result.returncode != 0:
            raise RuntimeError(f"curl failed (rc={result.returncode}): {result.stderr[:200]}")

        # Extract session ID from response headers
        sid = None
        try:
            with open(header_file) as hf:
                for line in hf:
                    if line.lower().startswith('mcp-session-id:'):
                        sid = line.split(':', 1)[1].strip()
        except Exception:
            pass

        # Parse first SSE data line containing a result
        for line in result.stdout.splitlines():
            if line.startswith('data: '):
                try:
                    msg = json.loads(line[6:])
                except json.JSONDecodeError:
                    continue
                if 'result' in msg:
                    return msg['result'], sid
                if 'error' in msg:
                    raise RuntimeError(f"MCP error: {msg['error']}")

        raise RuntimeError(f"No result in MCP response (len={len(result.stdout)}): {result.stdout[:300]}")
    finally:
        try:
            os.unlink(header_file)
        except Exception:
            pass

def mcp_init():
    result, session_id = mcp_post({
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "trilogy-dashboard", "version": "1.0"}
        }
    })
    return session_id

def sf_query(soql, session_id, req_id=2, retries=3):
    last_err = None
    for attempt in range(1, retries + 1):
        try:
            result, _ = mcp_post({
                "jsonrpc": "2.0", "id": req_id, "method": "tools/call",
                "params": {
                    "name": "sf_query",
                    "arguments": {"soql": soql, "tenantId": "trilogy"}
                }
            }, session_id)
            raw_text = result.get("content", [{}])[0].get("text", "{}")
            try:
                outer = json.loads(raw_text)
                inner_text = outer.get("content", [{}])[0].get("text", "{}")
                data = json.loads(inner_text)
            except Exception:
                data = json.loads(raw_text)
            return data
        except Exception as e:
            last_err = str(e)
            print(f"  → Attempt {attempt} error: {last_err}", file=sys.stderr)
            if attempt < retries:
                time.sleep(2 ** attempt)
    raise RuntimeError(f"sf_query failed after {retries} attempts: {last_err}")

# ── paginated query ────────────────────────────────────────────────────────────
session_id  = mcp_init()
PAGE        = 2000   # SF maximum — minimises round trips
all_records = []
offset      = 0

while True:
    paged  = f"{soql} LIMIT {PAGE} OFFSET {offset}"
    data   = sf_query(paged, session_id, req_id=offset // PAGE + 2)
    recs   = data.get('records', [])

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
if not all_records and not allow_empty:
    print(f"ERROR: 0 records returned for soql_key='{soql_key}' — refusing to overwrite", file=sys.stderr)
    sys.exit(1)

# ── write output ───────────────────────────────────────────────────────────────
os.makedirs(os.path.dirname(os.path.abspath(OUT_FILE)), exist_ok=True)
with open(OUT_FILE, 'w') as f:
    json.dump(all_records, f)
print(f"  → Saved {len(all_records)} records to {OUT_FILE}", file=sys.stderr)
