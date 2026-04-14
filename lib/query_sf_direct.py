#!/usr/bin/env python3
"""
Queries Salesforce directly via REST API using Username-Password OAuth flow.
Replaces query_sf_mcp.py — eliminates MCP proxy dependency.

Required environment variables:
  SF_USERNAME         Salesforce username (email)
  SF_PASSWORD         Salesforce password
  SF_SECURITY_TOKEN   Salesforce security token (appended to password)

Optional environment variables:
  SF_CLIENT_ID        Connected App consumer key (uses default if not set)
  SF_CLIENT_SECRET    Connected App consumer secret (uses default if not set)
  SF_LOGIN_URL        Login URL (default: https://login.salesforce.com)

Usage:
  python3 lib/query_sf_direct.py data/sf_latest.json
  python3 lib/query_sf_direct.py data/sf_gate1.json --soql-key gate1_soql
  python3 lib/query_sf_direct.py data/sf_activities.json --soql-key activities_soql --allow-empty
"""

import os
import sys
import json
import time
import calendar
import urllib.request
import urllib.parse
import urllib.error
from datetime import date, timedelta

# ══════════════════════════════════════════════════════════════════════════════
# ARGUMENT PARSING
# ══════════════════════════════════════════════════════════════════════════════

OUT_FILE = sys.argv[1] if len(sys.argv) > 1 else "data/sf_latest.json"
soql_key = "soql"
allow_empty = False

for i, arg in enumerate(sys.argv):
    if arg == "--soql-key" and i + 1 < len(sys.argv):
        soql_key = sys.argv[i + 1]
    if arg == "--allow-empty":
        allow_empty = True

# ══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION
# ══════════════════════════════════════════════════════════════════════════════

with open("config.json") as f:
    config = json.load(f)

soql_template = config[soql_key]
back_months = int(config.get("date_window_back_months", 1))
fwd_months = int(config.get("date_window_forward_months", 6))

# ══════════════════════════════════════════════════════════════════════════════
# DATE WINDOW CALCULATION
# ══════════════════════════════════════════════════════════════════════════════

today = date.today()

m, y = today.month - back_months, today.year
while m <= 0:
    m += 12
    y -= 1
date_from = date(y, m, min(today.day, calendar.monthrange(y, m)[1])).isoformat()

m, y = today.month + fwd_months, today.year
while m > 12:
    m -= 12
    y += 1
date_to = date(y, m, min(today.day, calendar.monthrange(y, m)[1])).isoformat()

date_7_days_ago = (date.today() - timedelta(days=7)).isoformat()

soql = (
    soql_template.replace("{date_from}", date_from)
    .replace("{date_to}", date_to)
    .replace("{date_7_days_ago}", date_7_days_ago)
)

if soql_key == "soql":
    print(f"  → Date range: {date_from} → {date_to}", file=sys.stderr)
print(f"  → SOQL key: {soql_key}", file=sys.stderr)

# ══════════════════════════════════════════════════════════════════════════════
# SALESFORCE AUTHENTICATION (Username-Password Flow)
# ══════════════════════════════════════════════════════════════════════════════

SF_USERNAME = os.environ["SF_USERNAME"]
SF_PASSWORD = os.environ["SF_PASSWORD"]
SF_SECURITY_TOKEN = os.environ["SF_SECURITY_TOKEN"]

# Optional: Connected App credentials (not required for basic username-password flow)
SF_CLIENT_ID = os.environ.get("SF_CLIENT_ID", "")
SF_CLIENT_SECRET = os.environ.get("SF_CLIENT_SECRET", "")

# Login URL - use test.salesforce.com for sandboxes
SF_LOGIN_URL = os.environ.get("SF_LOGIN_URL", "https://login.salesforce.com")

# API version
SF_API_VERSION = "v60.0"


def get_access_token():
    """
    Authenticate using Username-Password OAuth flow.
    Returns (access_token, instance_url).
    """
    token_url = f"{SF_LOGIN_URL}/services/oauth2/token"
    
    # Password + Security Token concatenated (Salesforce requirement)
    password_with_token = SF_PASSWORD + SF_SECURITY_TOKEN
    
    params = {
        "grant_type": "password",
        "username": SF_USERNAME,
        "password": password_with_token,
    }
    
    # Add client credentials if provided
    if SF_CLIENT_ID and SF_CLIENT_SECRET:
        params["client_id"] = SF_CLIENT_ID
        params["client_secret"] = SF_CLIENT_SECRET
    
    try:
        data = urllib.parse.urlencode(params).encode()
        req = urllib.request.Request(token_url, data=data, method="POST")
        req.add_header("Content-Type", "application/x-www-form-urlencoded")
        
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode())
            return result["access_token"], result["instance_url"]
            
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"ERROR: OAuth authentication failed: {e.code}", file=sys.stderr)
        print(f"  Response: {body[:500]}", file=sys.stderr)
        
        if "INVALID_LOGIN" in body or "invalid_grant" in body:
            print(f"  → Check SF_USERNAME, SF_PASSWORD, and SF_SECURITY_TOKEN", file=sys.stderr)
            print(f"  → For sandboxes, set SF_LOGIN_URL=https://test.salesforce.com", file=sys.stderr)
        
        sys.exit(1)


# ══════════════════════════════════════════════════════════════════════════════
# SALESFORCE QUERY EXECUTION
# ══════════════════════════════════════════════════════════════════════════════


def sf_query(soql, access_token, instance_url, retries=3):
    """
    Execute SOQL query with automatic pagination and retry logic.
    Returns list of records with 'attributes' keys stripped.
    """
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }

    all_records = []
    url = f"{instance_url}/services/data/{SF_API_VERSION}/query?q={urllib.parse.quote(soql)}"

    page_num = 1
    
    while url:
        last_err = None

        for attempt in range(1, retries + 1):
            try:
                req = urllib.request.Request(url, headers=headers, method="GET")

                with urllib.request.urlopen(req, timeout=120) as resp:
                    data = json.loads(resp.read().decode())

                records = data.get("records", [])

                # Strip 'attributes' from records and nested objects
                for rec in records:
                    rec.pop("attributes", None)
                    for v in rec.values():
                        if isinstance(v, dict):
                            v.pop("attributes", None)

                all_records.extend(records)
                print(f"  → Page {page_num}: {len(records)} records (total: {len(all_records)})", file=sys.stderr)

                # Check for next page
                next_url = data.get("nextRecordsUrl")
                if next_url:
                    url = f"{instance_url}{next_url}"
                    page_num += 1
                else:
                    url = None

                break  # Success, exit retry loop

            except urllib.error.HTTPError as e:
                last_err = f"HTTP {e.code}: {e.read().decode()[:200]}"
                print(f"  → Attempt {attempt} error: {last_err}", file=sys.stderr)
            except urllib.error.URLError as e:
                last_err = f"URL error: {e.reason}"
                print(f"  → Attempt {attempt} error: {last_err}", file=sys.stderr)
            except Exception as e:
                last_err = str(e)
                print(f"  → Attempt {attempt} error: {last_err}", file=sys.stderr)

            if attempt < retries:
                time.sleep(2**attempt)  # Exponential backoff: 2s, 4s

        else:
            # All retries exhausted
            raise RuntimeError(f"sf_query failed after {retries} attempts: {last_err}")

    return all_records


# ══════════════════════════════════════════════════════════════════════════════
# MAIN EXECUTION
# ══════════════════════════════════════════════════════════════════════════════

print("  → Authenticating with Salesforce...", file=sys.stderr)
access_token, instance_url = get_access_token()
print(f"  → Authentication successful ({instance_url})", file=sys.stderr)

print("  → Executing SOQL query...", file=sys.stderr)
all_records = sf_query(soql, access_token, instance_url)
print(f"  → Retrieved {len(all_records)} total records", file=sys.stderr)

# ── Guard against empty result ────────────────────────────────────────────────
if not all_records and not allow_empty:
    print(
        f"ERROR: 0 records returned for soql_key='{soql_key}' — refusing to overwrite",
        file=sys.stderr,
    )
    sys.exit(1)

# ── Write output ──────────────────────────────────────────────────────────────
os.makedirs(os.path.dirname(os.path.abspath(OUT_FILE)), exist_ok=True)
with open(OUT_FILE, "w") as f:
    json.dump(all_records, f)
print(f"  → Saved {len(all_records)} records to {OUT_FILE}", file=sys.stderr)
