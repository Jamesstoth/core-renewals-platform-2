#!/usr/bin/env python3
"""
Upload pipeline_dashboard.html to Supabase pipeline_html table.

Requires environment variables:
  SUPABASE_URL         e.g. https://xxxx.supabase.co
  SUPABASE_SERVICE_KEY service_role key (bypasses RLS)

Usage:
  python3 lib/upload_pipeline.py data/pipeline_dashboard.html
"""

import os, sys, json, urllib.request, urllib.error
from datetime import datetime, timezone

HTML_FILE = sys.argv[1] if len(sys.argv) > 1 else 'data/pipeline_dashboard.html'

SUPABASE_URL = os.environ['SUPABASE_URL'].rstrip('/')
SERVICE_KEY  = os.environ['SUPABASE_SERVICE_KEY']

HEADERS = {
    'apikey':        SERVICE_KEY,
    'Authorization': f'Bearer {SERVICE_KEY}',
    'Content-Type':  'application/json',
    'Prefer':        'resolution=merge-duplicates,return=minimal',
}

with open(HTML_FILE, encoding='utf-8') as f:
    html = f.read()

row = {
    'id':         1,
    'html':       html,
    'updated_at': datetime.now(timezone.utc).isoformat(),
}

url  = f"{SUPABASE_URL}/rest/v1/pipeline_html?on_conflict=id"
data = json.dumps(row).encode()
req  = urllib.request.Request(url, data=data, headers=HEADERS, method='POST')

try:
    with urllib.request.urlopen(req, timeout=60) as resp:
        print(f"  → Uploaded {len(html):,} chars to pipeline_html (HTTP {resp.status})", file=sys.stderr)
except urllib.error.HTTPError as e:
    body = e.read().decode()
    print(f"ERROR: Supabase upload failed ({e.code}): {body[:300]}", file=sys.stderr)
    sys.exit(1)
