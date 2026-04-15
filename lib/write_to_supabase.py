#!/usr/bin/env python3
"""
Reads all per-tab SF JSON files, merges them by opportunity ID,
and upserts to Supabase (opportunities + activities + last_refresh).

Uses only stdlib — no pip deps required in CI.

Required environment variables:
  SUPABASE_URL          e.g. https://xxxx.supabase.co
  SUPABASE_SERVICE_KEY  service_role key (bypasses RLS)
"""

import os, sys, json, urllib.request, urllib.error
from datetime import date, datetime, timezone

SUPABASE_URL = os.environ['SUPABASE_URL'].rstrip('/')
SERVICE_KEY  = os.environ['SUPABASE_SERVICE_KEY']

HEADERS = {
    'apikey':        SERVICE_KEY,
    'Authorization': f'Bearer {SERVICE_KEY}',
    'Content-Type':  'application/json',
    'Prefer':        'resolution=merge-duplicates,return=minimal',
}


def supabase_request(method, path, body=None):
    url  = f"{SUPABASE_URL}/rest/v1/{path}"
    data = json.dumps(body).encode() if body is not None else None
    req  = urllib.request.Request(url, data=data, headers=HEADERS, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            text = resp.read().decode()
            return json.loads(text) if text.strip() else None
    except urllib.error.HTTPError as e:
        body_text = e.read().decode()
        raise RuntimeError(f"Supabase {method} {path} → {e.code}: {body_text[:300]}")


def upsert(table, rows, chunk=500):
    """Upsert rows in chunks (Supabase REST limit ~1 MB per request)."""
    for i in range(0, len(rows), chunk):
        supabase_request('POST', f"{table}?on_conflict=id", rows[i:i+chunk])
    print(f"  → Upserted {len(rows)} rows to {table}", file=sys.stderr)


def _date(val):
    if not val:
        return None
    return val[:10]  # ISO date string, trim time component if present


def _bool(val):
    if isinstance(val, bool):
        return val
    if isinstance(val, str):
        return val.lower() in ('true', '1', 'yes')
    return bool(val) if val is not None else None


def _num(val):
    if val is None or val == '':
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def norm_opp(rec, gate_flags):
    """Normalise a raw SF opportunity record into a Supabase row."""
    owner = rec.get('Owner') or {}
    acct  = rec.get('Account') or {}
    return {
        'id':                    rec.get('Id'),
        'name':                  rec.get('Name'),
        'owner_name':            owner.get('Name') or rec.get('Owner__Name'),
        'owner_email':           owner.get('Email') or rec.get('Owner__Email'),
        'account':               acct.get('Name')  or rec.get('Account__Name'),
        'stage':                 rec.get('StageName'),
        'opp_status':            rec.get('Opportunity_Status__c'),
        'probable_outcome':      rec.get('Probable_Outcome__c'),
        'arr':                   _num(rec.get('ARR__c')),
        'current_arr':           _num(rec.get('Current_ARR__c')),
        'arr_increase':          _num(rec.get('ARR_Increase__c')),
        'offer_arr':             _num(rec.get('Offer_ARR__c')),
        'renewal_date':          _date(rec.get('Renewal_Date__c')),
        'close_date':            _date(rec.get('CloseDate')),
        'created_date':          _date(rec.get('CreatedDate')),
        'last_activity_date':    _date(rec.get('LastActivityDate')),
        'last_modified_date':    _date(rec.get('LastModifiedDate')),
        'next_follow_up_date':   _date(rec.get('Next_Follow_Up_Date__c')),
        'churn_risk':            rec.get('AI_Churn_Risk_Category__c'),
        'health_score':          _num(rec.get('Health_Score__c')),
        'priority_score':        _num(rec.get('Priority_Score__c')),
        'success_level':         rec.get('Success_Level__c'),
        'current_success_level': rec.get('Current_Success_Level__c'),
        'auto_renewal_clause':   _bool(rec.get('CurrentContractHasAutoRenewalClause__c')),
        'auto_renewed_last_term':_bool(rec.get('Auto_Renewed_Last_Term__c')),
        'product':               rec.get('Product__c'),
        'churn_risks':           rec.get('Churn_Risks__c'),
        'high_value':            _bool(rec.get('High_Value_Opp__c')),
        'handled_by_bu':         _bool(rec.get('Handled_by_BU__c')),
        'is_closed':             _bool(rec.get('IsClosed')),
        'win_type':              rec.get('Win_Type__c'),
        'opp_type':              rec.get('Type'),
        'next_step':             rec.get('NextStep'),
        'description':           rec.get('Description'),
        'account_report':        acct.get('Account_Report__c'),
        'opportunity_report':    rec.get('Opportunity_Report__c'),
        'support_tickets_summary': rec.get('Support_Tickets_Summary__c'),
        'gate3_violation_date':  _date(rec.get('Gate_3_Violation_Date__c')),
        'in_gate1':              gate_flags.get('in_gate1', False),
        'in_gate2':              gate_flags.get('in_gate2', False),
        'in_gate3':              gate_flags.get('in_gate3', False),
        'in_gate4':              gate_flags.get('in_gate4', False),
        'in_not_touched':        gate_flags.get('in_not_touched', False),
        'in_past_due':           gate_flags.get('in_past_due', False),
        'updated_at':            datetime.now(timezone.utc).isoformat(),
    }


def norm_activity(rec):
    owner = rec.get('Owner') or {}
    who   = rec.get('Who')   or {}
    what  = rec.get('What')  or {}
    return {
        'id':               rec.get('Id'),
        'subject':          rec.get('Subject'),
        'status':           rec.get('Status'),
        'call_disposition': rec.get('CallDisposition'),
        'activity_date':    _date(rec.get('ActivityDate')),
        'who_name':         who.get('Name')   or rec.get('Who__Name'),
        'what_name':        what.get('Name')  or rec.get('What__Name'),
        'owner_name':       owner.get('Name') or rec.get('Owner__Name'),
        'owner_email':      owner.get('Email') or rec.get('Owner__Email'),
        'description':      rec.get('Description'),
        'updated_at':       datetime.now(timezone.utc).isoformat(),
    }


def load_json(path):
    if not os.path.exists(path):
        print(f"  → {path} not found, skipping", file=sys.stderr)
        return []
    with open(path) as f:
        raw = json.load(f)
    if isinstance(raw, dict):
        raw = raw.get('records', [])
    return [r for r in raw if isinstance(r, dict)]


# ── Load all per-tab files ────────────────────────────────────────────────────
TAB_FILES = {
    'in_gate1':       'data/sf_gate1.json',
    'in_gate2':       'data/sf_gate2.json',
    'in_gate3':       'data/sf_gate3.json',
    'in_gate4':       'data/sf_gate4.json',
    'in_not_touched': 'data/sf_not_touched.json',
    'in_past_due':    'data/sf_past_due.json',
}

# Build a merged dict of {opp_id: {rec, flags}}
opp_map = {}  # id → {rec, flags dict}

for flag_key, path in TAB_FILES.items():
    records = load_json(path)
    for rec in records:
        oid = rec.get('Id')
        if not oid:
            continue
        if oid not in opp_map:
            opp_map[oid] = {'rec': rec, 'flags': {k: False for k in TAB_FILES}}
        opp_map[oid]['flags'][flag_key] = True

print(f"  → Merged {len(opp_map)} unique opportunities across all tabs", file=sys.stderr)

# First: reset all gate flags to FALSE for existing rows (handles opps that
# dropped out of a gate since last refresh). We do a bulk PATCH via a filter
# that matches all rows (id IS NOT NULL).
print("  → Resetting gate flags on existing rows...", file=sys.stderr)
reset_payload = {k: False for k in TAB_FILES}
try:
    supabase_request('PATCH', "opportunities?id=not.is.null", reset_payload)
except Exception as e:
    print(f"  → Reset warning (non-fatal): {e}", file=sys.stderr)

# Upsert all opportunities
opp_rows = [norm_opp(v['rec'], v['flags']) for v in opp_map.values()]
opp_rows = [r for r in opp_rows if r['id']]  # drop any with no Id
upsert('opportunities', opp_rows)

# ── Activities ────────────────────────────────────────────────────────────────
act_records = load_json('data/sf_activities_latest.json')
act_rows    = [norm_activity(r) for r in act_records if r.get('Id')]
if act_rows:
    upsert('activities', act_rows)

# ── Update last_refresh ───────────────────────────────────────────────────────
supabase_request('PATCH', "last_refresh?id=eq.1", {
    'refreshed_at':   datetime.now(timezone.utc).isoformat(),
    'opp_count':      len(opp_rows),
    'activity_count': len(act_rows),
})
print(f"  → last_refresh updated: {len(opp_rows)} opps, {len(act_rows)} activities", file=sys.stderr)
