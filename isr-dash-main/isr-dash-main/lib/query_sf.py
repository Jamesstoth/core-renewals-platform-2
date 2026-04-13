#!/usr/bin/env python3
"""
Queries Salesforce via the REST API and writes results to a JSON file.
Used by GitHub Actions to refresh dashboard data without the Claude MCP.

Required environment variables:
  SF_LOGIN_URL          e.g. https://login.salesforce.com
  SF_CLIENT_ID          Connected App consumer key
  SF_CLIENT_SECRET      Connected App consumer secret
  SF_USERNAME           Salesforce username
  SF_PASSWORD_AND_TOKEN Password + security token concatenated

Usage:
  python3 lib/query_sf.py data/sf_latest.json
"""

import os, sys, json, calendar, urllib.request, urllib.parse
from datetime import date

# ── args ───────────────────────────────────────────────────────────────────────
# Usage: python3 lib/query_sf.py <out_file> [--soql-key <key>]
# Default soql-key is 'soql' (opportunities); use 'activities_soql' for activities.
OUT_FILE  = sys.argv[1] if len(sys.argv) > 1 else 'data/sf_latest.json'
soql_key  = 'soql'
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

# ── credentials ────────────────────────────────────────────────────────────────
LOGIN_URL  = os.environ['SF_LOGIN_URL'].rstrip('/')
CLIENT_ID  = os.environ['SF_CLIENT_ID']
CLIENT_SECRET = os.environ['SF_CLIENT_SECRET']
USERNAME   = os.environ['SF_USERNAME']
PASSWORD   = os.environ['SF_PASSWORD_AND_TOKEN']

# ── authenticate ───────────────────────────────────────────────────────────────
body = urllib.parse.urlencode({
    'grant_type':    'password',
    'client_id':     CLIENT_ID,
    'client_secret': CLIENT_SECRET,
    'username':      USERNAME,
    'password':      PASSWORD,
}).encode()
req = urllib.request.Request(
    f'{LOGIN_URL}/services/oauth2/token', body,
    {'Content-Type': 'application/x-www-form-urlencoded'}
)
with urllib.request.urlopen(req) as r:
    auth = json.loads(r.read())

access_token = auth['access_token']
instance_url = auth['instance_url']
print(f"  → Authenticated as {USERNAME}", file=sys.stderr)

# ── paginated query ────────────────────────────────────────────────────────────
PAGE        = 200
all_records = []
offset      = 0

while True:
    paged = f"{soql} LIMIT {PAGE} OFFSET {offset}"
    url   = f"{instance_url}/services/data/v59.0/query?q={urllib.parse.quote(paged)}"
    req   = urllib.request.Request(url, headers={'Authorization': f'Bearer {access_token}'})
    with urllib.request.urlopen(req) as r:
        result = json.loads(r.read())

    page_recs = result.get('records', [])
    for rec in page_recs:
        rec.pop('attributes', None)
        for v in rec.values():
            if isinstance(v, dict):
                v.pop('attributes', None)

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
