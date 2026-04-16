#!/usr/bin/env python3
"""
Split Gates — Generates per-gate JSON files from the single sf_latest.json dump.

Replaces 6 separate Salesforce SOQL queries (gate1-4, not_touched, past_due)
with local Python filtering of the main opportunity dump. Reduces SF API calls
from 7 to 2 (opps + activities).

The filter logic mirrors the SOQL WHERE clauses from config.json gate*_soql
keys, adapted to work on the in-memory JSON records.

Usage:
  python3 lib/split_gates.py
  python3 lib/split_gates.py --input data/sf_latest.json

Inputs:
  data/sf_latest.json  (or --input path)

Outputs:
  data/sf_gate1.json
  data/sf_gate2.json
  data/sf_gate3.json
  data/sf_gate4.json
  data/sf_not_touched.json
  data/sf_past_due.json
"""

import json
import os
import sys
from datetime import date, datetime, timedelta

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TODAY = date.today()

# CLI args
INPUT_FILE = os.path.join(BASE_DIR, "data", "sf_latest.json")
for i, arg in enumerate(sys.argv):
    if arg == "--input" and i + 1 < len(sys.argv):
        INPUT_FILE = sys.argv[i + 1]

# ══════════════════════════════════════════════════════════════════════════════
# HELPERS
# ══════════════════════════════════════════════════════════════════════════════

def days_until(d_str):
    if not d_str:
        return None
    try:
        return (date.fromisoformat(d_str[:10]) - TODAY).days
    except (ValueError, TypeError):
        return None

def days_since(d_str):
    if not d_str:
        return None
    try:
        return (TODAY - date.fromisoformat(d_str[:10])).days
    except (ValueError, TypeError):
        return None

def get_owner(rec):
    owner = rec.get("Owner")
    if isinstance(owner, dict):
        return owner.get("Name", "")
    return ""

def get_name(rec):
    return rec.get("Name", "")

EXCLUDED_OWNERS = {"Fionn AI", "Sales Integration"}
TEAM_OWNERS = {"James Stothard", "Sebastian Desand", "Tim Courtenay", "James Quigley", "Fredrik Scheike"}

# ══════════════════════════════════════════════════════════════════════════════
# GATE FILTERS (mirror the SOQL WHERE clauses from config.json)
# ══════════════════════════════════════════════════════════════════════════════

def base_filter(rec):
    """Common base: active team owner, not test/invalid."""
    owner = get_owner(rec)
    name = get_name(rec).lower()
    return (
        owner in TEAM_OWNERS
        and "_test_" not in name
    )

def filter_gate1(rec):
    """Gate 1: 140D No Engagement (non-HVO)."""
    rd = days_until(rec.get("Renewal_Date__c"))
    return (
        base_filter(rec)
        and rec.get("StageName") in ("Outreach", "Pending")
        and not rec.get("High_Value_Opp__c", False)
        and not rec.get("Handled_by_BU__c", False)
        and rec.get("Product__c") not in ("Contently", "Khoros")
        and rec.get("Type") != "OEM"
        and not rec.get("IsClosed", False)
        and rd is not None and 0 <= rd <= 140
    )

def filter_gate2(rec):
    """Gate 2: 90D Quote Not Sent (non-HVO)."""
    rd = days_until(rec.get("Renewal_Date__c"))
    return (
        base_filter(rec)
        and rec.get("StageName") in ("Engaged", "Outreach", "Pending", "Proposal")
        and not rec.get("High_Value_Opp__c", False)
        and not rec.get("Handled_by_BU__c", False)
        and rec.get("Product__c") not in ("Khoros", "BroadVision")
        and rec.get("Type") == "Renewal"
        and not rec.get("IsClosed", False)
        and rd is not None and 0 <= rd <= 89
    )

def filter_gate3(rec):
    """Gate 3: 30D Not Finalizing. Branch A (open) + Branch B (closed with violation)."""
    name = get_name(rec).lower()
    if not base_filter(rec):
        return False
    if rec.get("Type") != "Renewal":
        return False
    if rec.get("Handled_by_BU__c", False):
        return False

    rd = days_until(rec.get("Renewal_Date__c"))

    # Branch A: open, not finalizing, renewal within 30 days
    branch_a = (
        rec.get("StageName") not in ("Finalizing", "Won't Process")
        and not rec.get("IsClosed", False)
        and rd is not None and 0 <= rd <= 30
    )

    # Branch B: closed within last 8 weeks with Gate 3 violation date set
    cd = days_since(rec.get("CloseDate"))
    branch_b = (
        cd is not None and cd <= 56
        and bool(rec.get("Gate_3_Violation_Date__c"))
        and rec.get("IsClosed", False)
    )

    return branch_a or branch_b

def filter_gate4(rec):
    """Gate 4: 0D Not Closed (past renewal date, still open). Includes recently closed with Gate 4 violation."""
    name = get_name(rec).lower()
    if not base_filter(rec):
        return False
    if "_invalid" in name or name.startswith("duplicate_"):
        return False
    if rec.get("Type") != "Renewal":
        return False
    if rec.get("Handled_by_BU__c", False):
        return False
    if rec.get("Product__c") == "CallStream/CityNumbers":
        return False

    rd = days_until(rec.get("Renewal_Date__c"))

    # Open and past due
    open_past_due = (
        rd is not None and rd < 0
        and not rec.get("IsClosed", False)
    )

    # Recently closed with Gate 4 violation
    cd = days_since(rec.get("CloseDate"))
    closed_violation = (
        bool(rec.get("Gate_4_Violation_Date__c"))
        and cd is not None and cd <= 56
    )

    return open_past_due or closed_violation

def filter_not_touched(rec):
    """Not Touched This Week: passes Gate 3 filter + no activity in 7 days."""
    if not filter_gate3(rec):
        return False
    la = rec.get("LastActivityDate")
    if not la:
        return True
    ds = days_since(la)
    return ds is not None and ds > 7

def filter_past_due(rec):
    """Past Due: renewal date in the past, not closed, not test/invalid."""
    name = get_name(rec).lower()
    if not base_filter(rec):
        return False
    if "_invalid" in name or name.startswith("duplicate_"):
        return False
    rd = days_until(rec.get("Renewal_Date__c"))
    return (
        rec.get("Type") == "Renewal"
        and not rec.get("IsClosed", False)
        and rd is not None and rd < 0
        and rec.get("Product__c") not in ("CallStream/CityNumbers", "Playbooks", "Khoros")
    )

# ══════════════════════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("Split Gates — generating per-gate files from sf_latest.json", file=sys.stderr)

    if not os.path.exists(INPUT_FILE):
        print(f"ERROR: {INPUT_FILE} not found", file=sys.stderr)
        sys.exit(1)

    with open(INPUT_FILE) as f:
        records = json.load(f)
    if isinstance(records, dict):
        records = records.get("records", [])

    print(f"  → Loaded {len(records)} records from {os.path.basename(INPUT_FILE)}", file=sys.stderr)

    GATES = {
        "data/sf_gate1.json":       filter_gate1,
        "data/sf_gate2.json":       filter_gate2,
        "data/sf_gate3.json":       filter_gate3,
        "data/sf_gate4.json":       filter_gate4,
        "data/sf_not_touched.json": filter_not_touched,
        "data/sf_past_due.json":    filter_past_due,
    }

    for output_path, filter_fn in GATES.items():
        full_path = os.path.join(BASE_DIR, output_path)
        filtered = [r for r in records if filter_fn(r)]
        with open(full_path, "w") as f:
            json.dump(filtered, f)
        print(f"  → {output_path}: {len(filtered)} records", file=sys.stderr)

    print("  → Split complete", file=sys.stderr)
