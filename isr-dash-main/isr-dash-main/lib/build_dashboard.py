#!/usr/bin/env python3
"""
Trilogy Renewals Dashboard Builder — Tabbed Report View
Reads SF opportunity JSON → produces a self-contained HTML dashboard with 6 report tabs.
"""

import json
import sys
import os
import argparse
from datetime import date, datetime
from collections import defaultdict, Counter

# ── CLI args ──────────────────────────────────────────────────────────────────
parser = argparse.ArgumentParser()
parser.add_argument("input_json")
parser.add_argument("output_html")
parser.add_argument("--owner", default="")
parser.add_argument("--activities", default="", help="Path to activities JSON file")
args = parser.parse_args()

# ── load data ─────────────────────────────────────────────────────────────────
with open(args.input_json) as f:
    raw = json.load(f)

if isinstance(raw, dict):
    for key in ("records", "data", "result"):
        if key in raw:
            val = raw[key]
            if isinstance(val, list):
                records = val; break
            if isinstance(val, dict) and "records" in val:
                records = val["records"]; break
    else:
        records = [raw]
else:
    records = raw

# ── load activities ───────────────────────────────────────────────────────────
activity_records = []
if args.activities and os.path.exists(args.activities):
    with open(args.activities) as f:
        raw_acts = json.load(f)
    if isinstance(raw_acts, list):
        activity_records = raw_acts
    elif isinstance(raw_acts, dict):
        for key in ("records", "data", "result"):
            if key in raw_acts and isinstance(raw_acts[key], list):
                activity_records = raw_acts[key]; break

# ── helpers ───────────────────────────────────────────────────────────────────
def days_until(d_str):
    if not d_str: return None
    try: return (date.fromisoformat(d_str[:10]) - date.today()).days
    except: return None

def days_since(d_str):
    if not d_str: return None
    try: return (date.today() - date.fromisoformat(d_str[:10])).days
    except: return None

def fmt_arr(v):
    if not v: return "—"
    if v >= 1_000_000: return f"${v/1_000_000:.1f}M"
    if v >= 1_000: return f"${v/1_000:.0f}K"
    return f"${v:.0f}"

def fmt_date(d):
    if not d: return "—"
    try: return date.fromisoformat(d[:10]).strftime("%b %d, %Y")
    except: return d

def churn_badge(risk):
    colors = {"High": "#f97316", "Critical": "#ef4444", "Medium": "#f59e0b", "Low": "#22c55e"}
    c = colors.get(risk, "#94a3b8")
    return f'<span class="badge" style="background:{c}">{risk}</span>'

def probable_badge(p):
    colors = {"Likely to Renew": "#22c55e", "Renewal at Risk": "#f59e0b", "Likely to Churn": "#ef4444"}
    c = colors.get(p, "#94a3b8")
    return f'<span class="badge" style="background:{c}">{p}</span>'

def opp_link(o, max_len=45):
    sf_url = f"https://trilogy-sales.lightning.force.com/lightning/r/Opportunity/{o['id']}/view"
    name = o['name'][:max_len] + ('…' if len(o['name']) > max_len else '')
    acct = f'<br><small style="color:#94a3b8">{o["account"][:35]}</small>' if o['account'] else ''
    return f'<a href="{sf_url}" target="_blank">{name}</a>{acct}'

# ── normalise records ─────────────────────────────────────────────────────────
def norm(rec):
    owner_raw = rec.get("Owner") or {}
    if isinstance(owner_raw, dict):
        owner_name  = owner_raw.get("Name", "—")
        owner_email = owner_raw.get("Email", "")
    else:
        owner_name  = str(owner_raw) if owner_raw else "—"
        owner_email = ""
    acct_raw = rec.get("Account") or {}
    acct_name = acct_raw.get("Name", "") if isinstance(acct_raw, dict) else str(acct_raw or "")
    return {
        "id":                    rec.get("Id", ""),
        "name":                  rec.get("Name", ""),
        "owner":                 owner_name,
        "owner_email":           owner_email,
        "account":               acct_name,
        "stage":                 rec.get("StageName", ""),
        "status":                rec.get("Opportunity_Status__c") or "—",
        "probable":              rec.get("Probable_Outcome__c") or "Unknown",
        "arr":                   float(rec.get("ARR__c") or 0),
        "current_arr":           float(rec.get("Current_ARR__c") or 0),
        "arr_increase":          float(rec.get("ARR_Increase__c") or 0),
        "offer_arr":             float(rec.get("Offer_ARR__c") or 0),
        "renewal_date":          rec.get("Renewal_Date__c") or "",
        "close_date":            rec.get("CloseDate") or "",
        "created_date":          (rec.get("CreatedDate") or "")[:10],
        "last_activity":         rec.get("LastActivityDate") or "",
        "last_modified":         (rec.get("LastModifiedDate") or "")[:10],
        "next_fu":               rec.get("Next_Follow_Up_Date__c") or "",
        "churn_risk":            rec.get("AI_Churn_Risk_Category__c") or "Unknown",
        "health_score":          rec.get("Health_Score__c"),
        "priority_score":        rec.get("Priority_Score__c"),
        "success_level":         rec.get("Success_Level__c") or rec.get("Current_Success_Level__c") or "—",
        "auto_renew":            rec.get("CurrentContractHasAutoRenewalClause__c") or "—",
        "product":               rec.get("Product__c") or "—",
        "product_family":        rec.get("Product__c") or "—",
        "churn_risks":           rec.get("Churn_Risks__c") or "",
        "description":           rec.get("Description") or "",
        "next_step":             rec.get("NextStep") or "—",
        "win_type":              rec.get("Win_Type__c") or "—",
        "opp_type":              rec.get("Type") or "",
        "high_value_opp":        bool(rec.get("High_Value_Opp__c", False)),
        "renewal_handled_by_bu": bool(rec.get("Handled_by_BU__c", False)),
        "gate3_violation_date":  rec.get("Gate_3_Violation_Date__c") or "",
        "is_closed":             bool(rec.get("IsClosed", False)),
    }

EXCLUDED_STAGES = {"Closed Won", "Closed Lost", "Won't Process"}
EXCLUDED_OWNERS = {"Fionn AI", "Sales Integration"}
opps = [norm(r) for r in records
        if isinstance(r, dict)
        and r.get("StageName") not in EXCLUDED_STAGES]
opps = [o for o in opps if o["owner"] not in EXCLUDED_OWNERS]
opps = [o for o in opps if o["opp_type"] != "OEM"]

# Gate 4 uses a wider pool: includes "Won't Process" (closed but not formally won/lost)
GATE4_EXCLUDED_STAGES = {"Closed Won", "Closed Lost"}
gate4_pool = [norm(r) for r in records
              if isinstance(r, dict)
              and r.get("StageName") not in GATE4_EXCLUDED_STAGES]
gate4_pool = [o for o in gate4_pool if o["owner"] not in EXCLUDED_OWNERS]
gate4_pool = [o for o in gate4_pool if o["opp_type"] != "OEM"]

if args.owner:
    opps = [o for o in opps if args.owner.lower() in o["owner"].lower()]
    gate4_pool = [o for o in gate4_pool if args.owner.lower() in o["owner"].lower()]

# ── tab filter definitions ────────────────────────────────────────────────────
# Gate 1 filters from Salesforce report screenshot:
#   Stage = Outreach, Pending | Renewal Date NEXT 140 DAYS | IsLocked = False (field absent, skipped)
#   High Value Opp = False | Product Family != Contently, Khoros (mapped to Product__c)
#   Name not contains _test_ | Renewal Handled by BU = False (field absent, skipped)
#   Owner < Sales Integration

def filter_gate1(o):
    rd = days_until(o["renewal_date"])
    return (
        o["stage"] in ("Outreach", "Pending") and
        rd is not None and 0 <= rd <= 140 and
        not o["high_value_opp"] and
        not o["renewal_handled_by_bu"] and
        o["product_family"] not in ("Contently", "Khoros") and
        "_test_" not in o["name"].lower() and
        o["owner"] < "Sales Integration"
    )

# Gate 2 filters from Salesforce report screenshot:
#   Stage = Engaged, Outreach, Pending, Proposal | Renewal Date NEXT 90 DAYS
#   IsLocked = False (field absent, skipped) | High Value Opp = False
#   Renewal Handled by BU = False (field absent, skipped)
#   Owner != Sales Integration | Product Family != Khoros, BroadVision (mapped to Product__c)
#   Name not contains _test_ | Type = Renewal

def filter_gate2(o):
    rd = days_until(o["renewal_date"])
    return (
        o["stage"] in ("Engaged", "Outreach", "Pending", "Proposal") and
        rd is not None and 0 <= rd <= 89 and   # NEXT 90 DAYS = today through day 89
        not o["high_value_opp"] and
        not o["renewal_handled_by_bu"] and
        o["product_family"] not in ("Khoros", "BroadVision") and
        "_test_" not in o["name"].lower() and
        o["owner"] != "Sales Integration"
    )

# Gate 3 filters from Salesforce report screenshot:
#   Logic: 1 AND 2 AND 3 AND 4 AND ((5 AND 6 AND 9) OR (7 AND 8 AND 10))
#   1. Name not contains _test_
#   2. Record Type = Renewal
#   3. Type = Renewal
#   4. Renewal Handled by BU = False
#   Branch A (open): 5. Stage != Finalizing  6. Renewal = NEXT 30 DAYS  9. Closed = False
#   Branch B (closed w/ violation): 7. Close Date = LAST 8 WEEKS  8. Gate 3 Violation Date != ""  10. Closed = True
#   Note: Branch B requires closed opps; our main query excludes them. Branch A is applied here;
#   run a separate query including Closed Won/Lost to surface Branch B records.

def filter_gate3(o):
    base = (
        "_test_" not in o["name"].lower() and
        o["opp_type"] == "Renewal" and
        not o["renewal_handled_by_bu"]
    )
    if not base:
        return False
    rd = days_until(o["renewal_date"])
    branch_a = (
        o["stage"] != "Finalizing" and
        rd is not None and 1 <= rd <= 30 and   # NEXT 30 DAYS starts tomorrow
        not o["is_closed"]                      # Closed = False
    )
    cd_weeks = days_since(o["close_date"])
    branch_b = (
        cd_weeks is not None and cd_weeks <= 56 and   # LAST 8 WEEKS
        bool(o["gate3_violation_date"]) and
        o["is_closed"]
    )
    return branch_a or branch_b

# Gate 4: Renewal date has passed, opp not yet closed
# Columns from screenshot: Renewal Date, Days Late, Offer ARR, Win Type, Next Step

def filter_gate4(o):
    rd = days_until(o["renewal_date"])
    name_l = o["name"].lower()
    return (
        o["renewal_date"] != "" and rd is not None and rd < 0 and
        "_test_" not in name_l and
        "_invalid" not in name_l and
        not name_l.startswith("duplicate_")
    )

# Not Touched This Week: Gate 3 pool filtered to no activity in past 7 days
# Columns from screenshot: Opp Name, Amount, Close Date, Age, Last Modified, Last Activity, Description

def filter_not_touched(o):
    if not filter_gate3(o):
        return False
    if not o["last_activity"]:
        return True
    ds = days_since(o["last_activity"])
    return ds is not None and ds > 7

# Past Due: Non-HVO with renewal date in the past (uses gate4_pool to include Won't Process)
# Columns from screenshot: Opp Name, Current Addons ARR, Amount, Close Date, Renewal Date

def filter_past_due(o):
    rd = days_until(o["renewal_date"])
    name_l = o["name"].lower()
    return (
        o["renewal_date"] != "" and rd is not None and rd < 0 and
        not o["high_value_opp"] and
        "_test_" not in name_l and
        "_invalid" not in name_l and
        not name_l.startswith("duplicate_")
    )

# ── activity normalisation + calls tab ────────────────────────────────────────
CALL_EXCLUDED_NAMES = {"ash", "jake", "rob", "alvin", "nichole", "george", "sandor", "craig"}

def norm_activity(rec):
    owner_raw = rec.get("Owner") or {}
    owner_name  = owner_raw.get("Name", "—") if isinstance(owner_raw, dict) else str(owner_raw or "—")
    owner_email = owner_raw.get("Email", "")  if isinstance(owner_raw, dict) else ""
    who_raw  = rec.get("Who")  or {}
    what_raw = rec.get("What") or {}
    return {
        "id":          rec.get("Id", ""),
        "subject":     rec.get("Subject") or "—",
        "call_result": rec.get("CallDisposition") or "—",
        "date":        rec.get("ActivityDate") or "",
        "who":         who_raw.get("Name", "—")  if isinstance(who_raw, dict)  else "—",
        "what":        what_raw.get("Name", "—") if isinstance(what_raw, dict) else "—",
        "owner":       owner_name,
        "owner_email": owner_email,
        "description": rec.get("Description") or "",
    }

def filter_calls(a):
    owner_lower = a["owner"].lower()
    return not any(name in owner_lower for name in CALL_EXCLUDED_NAMES)

activities = [norm_activity(r) for r in activity_records if isinstance(r, dict)]
activities = [a for a in activities if filter_calls(a)]

# ── tab definitions ───────────────────────────────────────────────────────────
TABS = [
    ("gate1",       "Gate 1 Non-HVO: 140D No Engagement", filter_gate1),
    ("gate2",       "Gate 2 Non-HVO: 90D Quote Not Sent",  filter_gate2),
    ("gate3",       "Gate 3: 30D Not Finalizing",          filter_gate3),
    ("gate4",       "Gate 4: 0D Not Closed",               filter_gate4),
    ("not_touched", "Not Touched This Week",               filter_not_touched),
    ("past_due",    "Past Due",                            filter_past_due),
    ("calls",       "Calls",                               filter_calls),
]

# Per-tab SF report data files (produced by the 6 targeted SOQL queries in CI).
# When present these take precedence over Python filtering of the main dump.
PER_TAB_FILES = {
    "gate1":       "data/sf_gate1.json",
    "gate2":       "data/sf_gate2.json",
    "gate3":       "data/sf_gate3.json",
    "gate4":       "data/sf_gate4.json",
    "not_touched": "data/sf_not_touched.json",
    "past_due":    "data/sf_past_due.json",
}

def _load_tab_file(path):
    with open(path) as f:
        raw = json.load(f)
    if isinstance(raw, dict):
        for key in ("records", "data", "result"):
            if key in raw and isinstance(raw[key], list):
                raw = raw[key]; break
        else:
            raw = [raw]
    return [norm(r) for r in raw if isinstance(r, dict)]

tab_opps = {}
for tid, _, fn in TABS:
    if tid == "calls":
        tab_opps[tid] = [a for a in activities if fn(a)]
    elif tid in PER_TAB_FILES and os.path.exists(PER_TAB_FILES[tid]):
        tab_opps[tid] = _load_tab_file(PER_TAB_FILES[tid])
    else:
        pool = gate4_pool if tid in ("gate4", "past_due") else opps
        tab_opps[tid] = [o for o in pool if fn(o)]

# ── per-tab table builders ────────────────────────────────────────────────────

def _search_attr(o):
    return (o['name'] + o['owner'] + o['account'] + o['product_family']).lower()

def build_table_gate1_style(tab_id, tab_opps_list):
    """Gates 1–3: Opp | Owner | ARR | Renewal Date | Stage | Last Activity | Churn Risk | Next FU"""
    rows = []
    for o in tab_opps_list:
        arr_val = o["arr"] or o["current_arr"]
        la_days = days_since(o["last_activity"])
        if la_days is not None:
            la_str = f'{fmt_date(o["last_activity"])} <small style="color:#64748b">({la_days}d ago)</small>'
        elif o["last_activity"]:
            la_str = fmt_date(o["last_activity"])
        else:
            la_str = '<span style="color:#ef4444">Never</span>'
        rows.append(
            f'<tr data-owner="{o["owner"]}" data-stage="{o["stage"]}" '
            f'data-search="{_search_attr(o)}">'
            f'<td>{opp_link(o)}</td>'
            f'<td>{o["owner"]}</td>'
            f'<td>{fmt_arr(arr_val)}</td>'
            f'<td>{fmt_date(o["renewal_date"])}</td>'
            f'<td>{o["stage"]}</td>'
            f'<td>{la_str}</td>'
            f'<td>{churn_badge(o["churn_risk"])}</td>'
            f'<td>{fmt_date(o["next_fu"])}</td>'
            f'</tr>'
        )
    thead = ('<tr><th>Opportunity / Account</th><th>Owner</th><th>ARR</th>'
             '<th>Renewal Date</th><th>Stage</th><th>Last Activity</th>'
             '<th>Churn Risk</th><th>Next FU</th></tr>')
    return thead, "\n".join(rows)

def build_table_gate4(tab_id, tab_opps_list):
    """Gate 4: Opp | Owner | Current ARR | Offer ARR | Renewal Date | Days Late | Stage | Win Type | Next Step"""
    sorted_opps = sorted(tab_opps_list, key=lambda o: days_until(o["renewal_date"]) or 0)
    rows = []
    for o in sorted_opps:
        arr_val = o["current_arr"] or o["arr"]
        rd = days_until(o["renewal_date"])
        days_late = abs(rd) if rd is not None and rd < 0 else 0
        days_late_cell = f'<span style="color:#ef4444;font-weight:600">{days_late}d</span>'
        ns = o["next_step"]
        ns_cell = (f'<span title="{ns}">{ns[:40]}{"…" if len(ns) > 40 else ""}</span>'
                   if ns and ns != "—" else "—")
        rows.append(
            f'<tr data-owner="{o["owner"]}" data-stage="{o["stage"]}" '
            f'data-search="{_search_attr(o)}">'
            f'<td>{opp_link(o)}</td>'
            f'<td>{o["owner"]}</td>'
            f'<td>{fmt_arr(arr_val)}</td>'
            f'<td>{fmt_arr(o["offer_arr"]) if o["offer_arr"] else "—"}</td>'
            f'<td>{fmt_date(o["renewal_date"])}</td>'
            f'<td>{days_late_cell}</td>'
            f'<td>{o["stage"]}</td>'
            f'<td>{o["win_type"]}</td>'
            f'<td style="max-width:220px">{ns_cell}</td>'
            f'</tr>'
        )
    thead = ('<tr><th>Opportunity / Account</th><th>Owner</th><th>Current ARR</th>'
             '<th>Offer ARR</th><th>Renewal Date</th><th>Days Late</th>'
             '<th>Stage</th><th>Win Type</th><th>Next Step</th></tr>')
    return thead, "\n".join(rows)

def build_table_not_touched(tab_id, tab_opps_list):
    """Not Touched: Opp | Owner | ARR | Close Date | Age | Last Modified | Last Activity | Description"""
    rows = []
    for o in sorted(tab_opps_list, key=lambda o: days_since(o["last_activity"]) or 9999, reverse=True):
        arr_val = o["arr"] or o["current_arr"]
        age = days_since(o["created_date"])
        age_str = f"{age}d" if age is not None else "—"
        la_days = days_since(o["last_activity"])
        la_str = (f'{la_days}d ago' if la_days is not None
                  else '<span style="color:#ef4444">Never</span>')
        desc = o["description"]
        desc_cell = (f'<span title="{desc}">{desc[:60]}{"…" if len(desc) > 60 else ""}</span>'
                     if desc else "—")
        rows.append(
            f'<tr data-owner="{o["owner"]}" data-stage="{o["stage"]}" '
            f'data-search="{_search_attr(o)}">'
            f'<td>{opp_link(o)}</td>'
            f'<td>{o["owner"]}</td>'
            f'<td>{fmt_arr(arr_val)}</td>'
            f'<td>{fmt_date(o["close_date"])}</td>'
            f'<td>{age_str}</td>'
            f'<td>{fmt_date(o["last_modified"])}</td>'
            f'<td>{la_str}</td>'
            f'<td style="max-width:240px">{desc_cell}</td>'
            f'</tr>'
        )
    thead = ('<tr><th>Opportunity / Account</th><th>Owner</th><th>ARR</th>'
             '<th>Close Date</th><th>Age</th><th>Last Modified</th>'
             '<th>Last Activity</th><th>Description</th></tr>')
    return thead, "\n".join(rows)

def build_table_past_due(tab_id, tab_opps_list):
    """Past Due: Opp | Owner | Current ARR | ARR | Close Date | Renewal Date"""
    sorted_opps = sorted(tab_opps_list, key=lambda o: days_until(o["renewal_date"]) or 0)
    rows = []
    for o in sorted_opps:
        arr_val = o["current_arr"] or o["arr"]
        rows.append(
            f'<tr data-owner="{o["owner"]}" data-stage="{o["stage"]}" '
            f'data-search="{_search_attr(o)}">'
            f'<td>{opp_link(o)}</td>'
            f'<td>{o["owner"]}</td>'
            f'<td>{fmt_arr(arr_val)}</td>'
            f'<td>{fmt_arr(o["arr"])}</td>'
            f'<td>{fmt_date(o["close_date"])}</td>'
            f'<td>{fmt_date(o["renewal_date"])}</td>'
            f'</tr>'
        )
    thead = ('<tr><th>Opportunity / Account</th><th>Owner</th><th>Current ARR</th>'
             '<th>ARR</th><th>Close Date</th><th>Renewal Date</th></tr>')
    return thead, "\n".join(rows)

def call_result_badge(result):
    colors = {
        "Completed":     "#22c55e",
        "Attempted":     "#f59e0b",
        "No Show":       "#ef4444",
        "Check-in Call": "#3b82f6",
    }
    c = colors.get(result, "#94a3b8")
    return f'<span class="badge" style="background:{c}">{result}</span>'

def build_table_calls(tab_id, acts):
    rows = []
    for a in acts:
        ds = days_since(a["date"])
        date_str = (f'{fmt_date(a["date"])} <small style="color:#64748b">({ds}d ago)</small>'
                    if ds is not None else fmt_date(a["date"]))
        sf_url = f"https://trilogy-sales.lightning.force.com/lightning/r/Report/00OIh000000mHHJMA2/"
        what_cell = f'<a href="{sf_url}" target="_blank">{a["what"][:45]}</a>' if a["what"] != "—" else "—"
        rows.append(
            f'<tr data-owner="{a["owner"]}" data-stage="{a["call_result"]}" '
            f'data-search="{(a["owner"]+a["who"]+a["what"]+a["subject"]).lower()}">'
            f'<td>{date_str}</td>'
            f'<td>{a["owner"]}</td>'
            f'<td>{a["subject"]}</td>'
            f'<td>{call_result_badge(a["call_result"])}</td>'
            f'<td>{a["who"]}</td>'
            f'<td>{what_cell}</td>'
            f'</tr>'
        )
    thead = ('<tr><th>Date</th><th>Owner</th><th>Subject</th>'
             '<th>Call Result</th><th>Contact</th><th>Opportunity / Account</th></tr>')
    return thead, "\n".join(rows)

TABLE_BUILDERS = {
    "gate1":       build_table_gate1_style,
    "gate2":       build_table_gate1_style,
    "gate3":       build_table_gate4,
    "gate4":       build_table_gate4,
    "not_touched": build_table_not_touched,
    "past_due":    build_table_past_due,
    "calls":       build_table_calls,
}

# ── render each tab section ───────────────────────────────────────────────────
def render_tab_section(tab_id, tab_label, tab_opps_list):
    builder = TABLE_BUILDERS[tab_id]
    thead, tbody = builder(tab_id, tab_opps_list)
    count = len(tab_opps_list)
    is_calls = tab_id == "calls"

    if is_calls:
        stat_pills = f'<span class="stat-pill">{count} calls</span>'
        unique_owners  = sorted({a["owner"]       for a in tab_opps_list})
        unique_results = sorted({a["call_result"] for a in tab_opps_list})
        owner_opts  = "".join(f'<option value="{v}">{v}</option>' for v in unique_owners)
        stage_opts  = "".join(f'<option value="{v}">{v}</option>' for v in unique_results)
        stage_label = "All Results"
        empty_text  = "No call activity data — run ↻ Update to load."
    else:
        total_arr  = sum(o["arr"] or o["current_arr"] for o in tab_opps_list)
        stat_pills = f'<span class="stat-pill">{count} opportunities</span><span class="stat-pill">{fmt_arr(total_arr)} ARR</span>'
        unique_owners = sorted({o["owner"] for o in tab_opps_list})
        unique_stages = sorted({o["stage"] for o in tab_opps_list})
        owner_opts  = "".join(f'<option value="{v}">{v}</option>' for v in unique_owners)
        stage_opts  = "".join(f'<option value="{v}">{v}</option>' for v in unique_stages)
        stage_label = "All Stages"
        empty_text  = "No opportunities match this report&apos;s criteria."

    owner_opts_html = f'<option value="">All Owners</option>{owner_opts}'
    stage_opts_html = f'<option value="">{stage_label}</option>{stage_opts}'

    empty_msg = (f'<tr><td colspan="9" style="text-align:center;color:#64748b;padding:32px">'
                 f'{empty_text}</td></tr>'
                 if not tab_opps_list else "")

    return f"""
<div id="tab-{tab_id}" class="tab-content" style="display:none">
  <div class="tab-header">
    <div class="tab-stats">
      {stat_pills}
    </div>
    <div class="tab-filters">
      <input type="text" class="tab-search" placeholder="Search…"
             oninput="filterTabTable('{tab_id}')">
      <select class="tab-owner-filter" onchange="filterTabTable('{tab_id}')">
        {owner_opts_html}
      </select>
      <select class="tab-stage-filter" onchange="filterTabTable('{tab_id}')">
        {stage_opts_html}
      </select>
      <span class="count-badge" id="count-{tab_id}">{count} rows</span>
    </div>
  </div>
  <div class="table-wrap">
    <table id="table-{tab_id}">
      <thead>{thead}</thead>
      <tbody>{tbody}{empty_msg}</tbody>
    </table>
  </div>
</div>"""

tab_sections_html = "\n".join(
    render_tab_section(tid, tlabel, tab_opps[tid])
    for tid, tlabel, _ in TABS
)

# ── KPI row ───────────────────────────────────────────────────────────────────
TAB_COLORS = {
    "gate1":       "#0d9488",
    "gate2":       "#d97706",
    "gate3":       "#ea580c",
    "gate4":       "#dc2626",
    "not_touched": "#6366f1",
    "past_due":    "#b91c1c",
    "calls":       "#0891b2",
}

KPI_ITEMS = [
    ("gate1",       "Gate 1",      "140D No Engagement"),
    ("gate2",       "Gate 2",      "90D Quote Not Sent"),
    ("gate3",       "Gate 3",      "30D Not Finalizing"),
    ("gate4",       "Gate 4",      "0D Not Closed"),
    ("not_touched", "Not Touched", "This Week"),
    ("past_due",    "Past Due",    "Overdue"),
    ("calls",       "Calls",       "Last 14 Days"),
]

kpi_html = "\n".join(
    f'<div class="kpi-card" onclick="openTab(\'{tid}\')" role="button" tabindex="0" '
    f'onkeydown="if(event.key===\'Enter\')openTab(\'{tid}\')">'
    f'<div class="kpi-sub">{sub}</div>'
    f'<div class="kpi-count" style="color:{TAB_COLORS[tid]}">{len(tab_opps[tid])}</div>'
    f'<div class="kpi-title">{title}</div>'
    f'</div>'
    for tid, title, sub in KPI_ITEMS
)

# ── compact tables for gate cards ─────────────────────────────────────────────
def build_compact_table(tab_id, opps_list):
    rows = []
    if tab_id in ("gate1", "gate2"):
        thead = '<tr><th>Opportunity</th><th>Owner</th><th>Renewal</th></tr>'
        for o in opps_list[:30]:
            fname = o["owner"].split()[0] if o["owner"] not in ("—", "") else "—"
            rows.append(
                f'<tr>'
                f'<td>{opp_link(o, 30)}</td>'
                f'<td class="ct-col">{fname}</td>'
                f'<td class="ct-col">{fmt_date(o["renewal_date"])}</td>'
                f'</tr>'
            )
    elif tab_id == "gate3":
        thead = '<tr><th>Opportunity</th><th>Owner</th><th>Due In</th></tr>'
        for o in sorted(opps_list, key=lambda x: days_until(x["renewal_date"]) or 999)[:30]:
            rd    = days_until(o["renewal_date"])
            due   = f'<span style="color:#ea580c;font-weight:600">{rd}d</span>' if rd is not None else "—"
            fname = o["owner"].split()[0] if o["owner"] not in ("—", "") else "—"
            rows.append(
                f'<tr>'
                f'<td>{opp_link(o, 30)}</td>'
                f'<td class="ct-col">{fname}</td>'
                f'<td class="ct-col">{due}</td>'
                f'</tr>'
            )
    elif tab_id == "gate4":
        thead = '<tr><th>Opportunity</th><th>Owner</th><th>Late</th></tr>'
        for o in sorted(opps_list, key=lambda x: days_until(x["renewal_date"]) or 0)[:30]:
            rd    = days_until(o["renewal_date"])
            late  = abs(rd) if rd is not None and rd < 0 else 0
            fname = o["owner"].split()[0] if o["owner"] not in ("—", "") else "—"
            rows.append(
                f'<tr>'
                f'<td>{opp_link(o, 30)}</td>'
                f'<td class="ct-col">{fname}</td>'
                f'<td class="ct-col"><span style="color:#dc2626;font-weight:600">{late}d</span></td>'
                f'</tr>'
            )
    else:
        return ""
    empty = ('<tr><td colspan="3" style="text-align:center;padding:20px;color:#94a3b8">No records</td></tr>'
             if not opps_list else "")
    return f'<thead>{thead}</thead><tbody>{"".join(rows)}{empty}</tbody>'

GATE_CARD_DEFS = [
    ("gate1", "Gate 1 Non-HVO: 140D No Engagement"),
    ("gate2", "Gate 2 Non-HVO: 90D Quote Not Sent"),
    ("gate3", "Gate 3: 30D Not Finalizing"),
    ("gate4", "Gate 4: 0D Not Closed"),
]

def render_gate_card(tab_id, label, opps_list):
    count   = len(opps_list)
    color   = TAB_COLORS[tab_id]
    arr_tot = sum(o["arr"] or o["current_arr"] for o in opps_list)
    ct      = build_compact_table(tab_id, opps_list)
    return f'''<div class="gate-card">
  <div class="gate-card-hdr" style="border-top:3px solid {color}">
    <div>
      <div class="gate-card-title">{label}</div>
      <div class="gate-card-meta">{count} opps &nbsp;·&nbsp; {fmt_arr(arr_tot)} ARR</div>
    </div>
    <button class="view-all-btn" onclick="openTab('{tab_id}')">View All →</button>
  </div>
  <div class="ct-wrap">
    <table class="ct-table">{ct}</table>
  </div>
</div>'''

gate_cards_html = "\n".join(
    render_gate_card(tid, label, tab_opps[tid])
    for tid, label in GATE_CARD_DEFS
)

tab_labels_js = "{" + ", ".join(f'"{tid}": "{tlabel}"' for tid, tlabel, _ in TABS) + "}"

# ── overall stats ─────────────────────────────────────────────────────────────
total_count = len(opps)
total_arr   = sum(o["arr"] or o["current_arr"] for o in opps)

# ── build HTML ────────────────────────────────────────────────────────────────
title_suffix = f" — {args.owner}" if args.owner else ""
generated_at = datetime.now().strftime("%B %d, %Y at %I:%M %p")

html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Trilogy Dashboard{title_suffix}</title>
<style>
  :root {{
    --bg:          #f1f5f9;
    --surface:     #ffffff;
    --surface2:    #f8fafc;
    --border:      #e2e8f0;
    --border2:     #f1f5f9;
    --text:        #1e293b;
    --text-strong: #0f172a;
    --text-muted:  #475569;
    --text-faint:  #64748b;
    --text-meta:   #94a3b8;
    --text-td:     #334155;
    --link:        #2563eb;
    --link-hover:  #1d4ed8;
    --accent:      #3b82f6;
    --accent-bg:   #dbeafe;
    --accent-text: #1d4ed8;
    --row-hover:   #f8fafc;
    --shadow:      0 1px 3px rgba(0,0,0,.08),0 0 0 1px rgba(0,0,0,.04);
  }}
  body.dark {{
    --bg:          #0f172a;
    --surface:     #1e293b;
    --surface2:    #0f172a;
    --border:      #334155;
    --border2:     #1e293b;
    --text:        #e2e8f0;
    --text-strong: #f8fafc;
    --text-muted:  #94a3b8;
    --text-faint:  #64748b;
    --text-meta:   #475569;
    --text-td:     #cbd5e1;
    --link:        #60a5fa;
    --link-hover:  #93c5fd;
    --accent:      #3b82f6;
    --accent-bg:   #1d4ed8;
    --accent-text: #bfdbfe;
    --row-hover:   #1e293b;
    --shadow:      0 1px 3px rgba(0,0,0,.3),0 0 0 1px rgba(255,255,255,.04);
  }}

  *,*::before,*::after {{ box-sizing:border-box; margin:0; padding:0; }}
  body {{ font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
         background:var(--bg); color:var(--text); min-height:100vh; }}

  /* ── Header ── */
  .page-header {{
    display:flex; align-items:center; gap:10px;
    background:var(--surface); border-bottom:1px solid var(--border);
    padding:0 20px; height:46px; position:sticky; top:0; z-index:20;
    box-shadow:var(--shadow);
  }}
  .brand {{ font-size:14px; font-weight:700; color:var(--text-strong); white-space:nowrap; }}
  .header-meta {{ flex:1; font-size:11px; color:var(--text-muted); }}
  .header-meta strong {{ color:var(--text-faint); }}
  .theme-toggle,.refresh-btn {{
    flex-shrink:0; background:var(--surface2); border:1px solid var(--border);
    color:var(--text-muted); border-radius:6px; padding:4px 10px;
    font-size:11px; cursor:pointer; transition:color .15s,background .15s; white-space:nowrap;
  }}
  .theme-toggle:hover,.refresh-btn:hover {{ color:var(--text); }}
  .refresh-btn:disabled {{ opacity:.6; cursor:default; }}

  /* ── KPI bar (always visible) ── */
  .kpi-bar {{ padding:14px 20px 0; }}

  /* ── Dashboard body ── */
  .dashboard-body {{ padding:10px 20px 16px; }}

  /* ── KPI row ── */
  .kpi-row {{
    display:grid; grid-template-columns:repeat(7,1fr); gap:10px; margin-bottom:14px;
  }}
  .kpi-card {{
    background:var(--surface); border:1px solid var(--border); border-radius:8px;
    padding:12px 14px; cursor:pointer; user-select:none;
    box-shadow:var(--shadow); transition:box-shadow .15s,transform .1s;
  }}
  .kpi-card:hover {{ box-shadow:0 4px 12px rgba(0,0,0,.12); transform:translateY(-1px); }}
  .kpi-sub   {{ font-size:10px; color:var(--text-meta); text-transform:uppercase;
                letter-spacing:.04em; margin-bottom:4px; }}
  .kpi-count {{ font-size:36px; font-weight:700; line-height:1; margin-bottom:4px; }}
  .kpi-title {{ font-size:11px; color:var(--text-muted); font-weight:500; }}

  /* ── Gate grid ── */
  .gate-grid {{
    display:grid; grid-template-columns:repeat(4,1fr); gap:12px;
  }}
  .gate-card {{
    background:var(--surface); border:1px solid var(--border); border-radius:8px;
    overflow:hidden; box-shadow:var(--shadow); display:flex; flex-direction:column;
  }}
  .gate-card-hdr {{
    display:flex; align-items:flex-start; justify-content:space-between;
    padding:12px 14px 10px; gap:8px;
  }}
  .gate-card-title {{ font-size:12px; font-weight:600; color:var(--text-strong); line-height:1.3; }}
  .gate-card-meta  {{ font-size:11px; color:var(--text-muted); margin-top:3px; }}
  .view-all-btn {{
    flex-shrink:0; background:none; border:1px solid var(--border);
    color:var(--accent); border-radius:5px; padding:3px 8px;
    font-size:11px; cursor:pointer; white-space:nowrap; transition:background .12s;
  }}
  .view-all-btn:hover {{ background:var(--accent-bg); }}

  /* ── Compact embedded table ── */
  .ct-wrap {{ overflow-y:auto; max-height:340px; border-top:1px solid var(--border); }}
  .ct-table {{ width:100%; border-collapse:collapse; font-size:12px; }}
  .ct-table thead th {{
    background:var(--surface2); color:var(--text-faint); text-transform:uppercase;
    letter-spacing:.04em; font-size:10px; font-weight:600;
    padding:6px 10px; text-align:left; position:sticky; top:0; z-index:1; white-space:nowrap;
  }}
  .ct-table tbody tr {{ border-bottom:1px solid var(--border2); }}
  .ct-table tbody tr:hover {{ background:var(--row-hover); }}
  .ct-table tbody td {{ padding:7px 10px; color:var(--text-td); vertical-align:top; }}
  .ct-col {{ white-space:nowrap; width:1%; }}

  /* ── Full detail table view ── */
  .table-nav {{
    display:flex; align-items:center; gap:14px;
    padding:9px 20px; background:var(--surface); border-bottom:1px solid var(--border);
  }}
  .back-btn {{
    background:none; border:1px solid var(--border); color:var(--text-muted);
    border-radius:6px; padding:4px 12px; font-size:12px; cursor:pointer;
    transition:color .15s,border-color .15s;
  }}
  .back-btn:hover {{ color:var(--text); border-color:var(--text-muted); }}
  .table-nav-title {{ font-size:14px; font-weight:600; color:var(--text-strong); }}

  .tab-content {{ padding:18px 20px; }}
  .tab-header {{ display:flex; align-items:center; justify-content:space-between;
                 flex-wrap:wrap; gap:10px; margin-bottom:12px; }}
  .tab-stats {{ display:flex; gap:8px; }}
  .stat-pill {{
    background:var(--surface); border:1px solid var(--border); color:var(--text-muted);
    padding:4px 12px; border-radius:12px; font-size:12px; font-weight:500;
  }}
  .tab-filters {{ display:flex; flex-wrap:wrap; gap:8px; align-items:center; }}
  .tab-filters input,.tab-filters select {{
    background:var(--surface); border:1px solid var(--border); color:var(--text);
    padding:6px 12px; border-radius:8px; font-size:12px; outline:none;
  }}
  .tab-filters input {{ min-width:180px; }}
  .tab-filters input:focus,.tab-filters select:focus {{ border-color:var(--accent); }}
  .count-badge {{
    background:var(--surface); border:1px solid var(--border); color:var(--text-faint);
    padding:4px 10px; border-radius:6px; font-size:11px;
  }}
  .table-wrap {{ border-radius:8px; border:1px solid var(--border); overflow:auto; max-height:65vh; }}
  table {{ width:100%; border-collapse:collapse; font-size:13px; }}
  thead th {{
    background:var(--surface2); color:var(--text-faint); text-transform:uppercase;
    letter-spacing:.04em; font-size:11px; font-weight:600;
    padding:10px 12px; text-align:left; position:sticky; top:0; z-index:1; white-space:nowrap;
  }}
  tbody tr {{ border-bottom:1px solid var(--border2); transition:background .1s; }}
  tbody tr:hover {{ background:var(--row-hover); }}
  tbody tr.hidden {{ display:none; }}
  tbody td {{ padding:9px 12px; color:var(--text-td); vertical-align:top; }}
  a {{ color:var(--link); text-decoration:none; }}
  a:hover {{ color:var(--link-hover); text-decoration:underline; }}
  .badge {{
    display:inline-block; color:#fff; padding:2px 8px;
    border-radius:4px; font-size:11px; font-weight:600; white-space:nowrap;
  }}
</style>
</head>
<body>

<header class="page-header">
  <span class="brand">Trilogy Dashboard{title_suffix}</span>
  <span class="header-meta">Generated {generated_at} &nbsp;·&nbsp; <strong>{total_count}</strong> open opps &nbsp;·&nbsp; <strong>{fmt_arr(total_arr)}</strong> ARR</span>
  <button class="refresh-btn" id="refresh-btn" onclick="refreshDashboard()">↻ Update</button>
  <button class="theme-toggle" id="theme-btn" onclick="toggleTheme()">☾ Dark</button>
</header>

<div class="kpi-bar">
  <div class="kpi-row">
    {kpi_html}
  </div>
</div>

<div id="dashboard-body" class="dashboard-body">
  <div class="gate-grid">
    {gate_cards_html}
  </div>
</div>

<div id="table-view" style="display:none">
  <div class="table-nav">
    <button class="back-btn" onclick="showDashboard()">← All Gates</button>
    <span class="table-nav-title" id="table-nav-title"></span>
  </div>
  {tab_sections_html}
</div>

<script>
const TAB_LABELS = {tab_labels_js};

function openTab(tabId) {{
  document.getElementById('dashboard-body').style.display = 'none';
  document.getElementById('table-view').style.display = 'block';
  document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
  const content = document.getElementById('tab-' + tabId);
  if (content) content.style.display = 'block';
  document.getElementById('table-nav-title').textContent = TAB_LABELS[tabId] || tabId;
  document.querySelector('.kpi-bar').scrollIntoView();
}}

function showDashboard() {{
  document.getElementById('table-view').style.display = 'none';
  document.getElementById('dashboard-body').style.display = 'block';
  document.querySelector('.kpi-bar').scrollIntoView();
}}

function filterTabTable(tabId) {{
  const section = document.getElementById('tab-' + tabId);
  if (!section) return;
  const q     = section.querySelector('.tab-search').value.toLowerCase();
  const owner = section.querySelector('.tab-owner-filter').value;
  const stage = section.querySelector('.tab-stage-filter').value;
  const rows  = section.querySelectorAll('tbody tr');
  let visible = 0;
  rows.forEach(row => {{
    if (!row.dataset.search) return;
    const match =
      (!q     || row.dataset.search.includes(q)) &&
      (!owner || row.dataset.owner === owner) &&
      (!stage || row.dataset.stage === stage);
    row.classList.toggle('hidden', !match);
    if (match) visible++;
  }});
  const badge = document.getElementById('count-' + tabId);
  if (badge) badge.textContent = visible + ' rows';
}}

async function refreshDashboard() {{
  const btn = document.getElementById('refresh-btn');
  btn.disabled = true;
  btn.textContent = '↻ Updating…';
  try {{
    const res  = await fetch('/admin/refresh', {{ method: 'POST' }});
    const data = await res.json();
    if (data.ok) {{
      btn.textContent = '✓ Updating — live in ~2 min';
      btn.style.color = '#22c55e';
      setTimeout(() => {{ btn.textContent = '↻ Update'; btn.style.color = ''; btn.disabled = false; }}, 8000);
    }} else {{
      btn.textContent = '✗ ' + (data.error || 'Error');
      btn.style.color = '#ef4444';
      setTimeout(() => {{ btn.textContent = '↻ Update'; btn.style.color = ''; btn.disabled = false; }}, 4000);
    }}
  }} catch (e) {{
    btn.textContent = '✗ Request failed';
    btn.style.color = '#ef4444';
    setTimeout(() => {{ btn.textContent = '↻ Update'; btn.style.color = ''; btn.disabled = false; }}, 4000);
  }}
}}

function toggleTheme() {{
  const isDark = document.body.classList.toggle('dark');
  document.getElementById('theme-btn').textContent = isDark ? '☀ Light' : '☾ Dark';
  localStorage.setItem('trilogy-theme', isDark ? 'dark' : 'light');
}}
(function() {{
  if (localStorage.getItem('trilogy-theme') === 'dark') {{
    document.body.classList.add('dark');
    document.getElementById('theme-btn').textContent = '☀ Light';
  }}
}})();
</script>
</body>
</html>"""

# ── write output ──────────────────────────────────────────────────────────────
os.makedirs(os.path.dirname(os.path.abspath(args.output_html)), exist_ok=True)
with open(args.output_html, "w") as f:
    f.write(html)

print(f"  → Dashboard written: {args.output_html}")
print(f"  → {total_count} opportunities · {fmt_arr(total_arr)} total ARR")
for tid, tlabel, _ in TABS:
    print(f"     {tlabel}: {len(tab_opps[tid])}")
if args.owner:
    print(f"  → Filtered to: {args.owner}")
