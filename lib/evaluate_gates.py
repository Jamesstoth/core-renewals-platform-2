#!/usr/bin/env python3
"""
Gate Evaluator — Phase 1 (Deterministic, Read-Only)

Reads Salesforce opportunity data from JSON files, evaluates every open
opportunity against the 7-gate renewal lifecycle framework, and outputs
a structured evaluation file.

ZERO Salesforce writes. All output goes to data/gate_evaluations.json.

Usage:
  python3 lib/evaluate_gates.py
  python3 lib/evaluate_gates.py --output data/custom_output.json
  python3 lib/evaluate_gates.py --rules config/gate_rules.json

Inputs:
  data/sf_latest.json             All open opportunities
  data/sf_activities_latest.json  Recent activity data (optional)
  config/gate_rules.json          Gate framework definitions

Output:
  data/gate_evaluations.json      Per-opportunity gate evaluation
"""

import json
import os
import sys
from datetime import date, datetime, timedelta

# ══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION
# ══════════════════════════════════════════════════════════════════════════════

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Defaults — overridable via CLI args
OUTPUT_FILE = os.path.join(BASE_DIR, "data", "gate_evaluations.json")
RULES_FILE = os.path.join(BASE_DIR, "config", "gate_rules.json")
OPP_FILE = os.path.join(BASE_DIR, "data", "sf_latest.json")
ACTIVITIES_FILE = os.path.join(BASE_DIR, "data", "sf_activities_latest.json")

for i, arg in enumerate(sys.argv):
    if arg == "--output" and i + 1 < len(sys.argv):
        OUTPUT_FILE = sys.argv[i + 1]
    if arg == "--rules" and i + 1 < len(sys.argv):
        RULES_FILE = sys.argv[i + 1]

TODAY = date.today()

# ══════════════════════════════════════════════════════════════════════════════
# DATA LOADING
# ══════════════════════════════════════════════════════════════════════════════


def load_json(path, required=True):
    """Load a JSON file. Returns empty list if file missing and not required."""
    if not os.path.exists(path):
        if required:
            print(f"ERROR: Required file not found: {path}", file=sys.stderr)
            sys.exit(1)
        print(f"  → Optional file not found, skipping: {path}", file=sys.stderr)
        return []
    with open(path) as f:
        data = json.load(f)
    # Handle Salesforce result envelope
    if isinstance(data, dict) and "records" in data:
        data = data["records"]
    print(f"  → Loaded {len(data)} records from {os.path.basename(path)}", file=sys.stderr)
    return data


def parse_date(val):
    """Parse a Salesforce date string (YYYY-MM-DD) to a date object. Returns None on failure."""
    if not val:
        return None
    try:
        return datetime.strptime(val[:10], "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None


# ══════════════════════════════════════════════════════════════════════════════
# FIELD ACCESSORS (handle nested SF objects safely)
# ══════════════════════════════════════════════════════════════════════════════


def get_field(record, field):
    """Get a potentially nested field value. E.g. 'Owner.Name' -> record['Owner']['Name']."""
    parts = field.split(".")
    val = record
    for part in parts:
        if isinstance(val, dict):
            val = val.get(part)
        else:
            return None
    return val


def get_owner_name(record):
    owner = record.get("Owner")
    if isinstance(owner, dict):
        return owner.get("Name", "Unknown")
    return "Unknown"


def get_account_name(record):
    acct = record.get("Account")
    if isinstance(acct, dict):
        return acct.get("Name", "Unknown")
    return "Unknown"


# ══════════════════════════════════════════════════════════════════════════════
# STAGE ORDERING
# ══════════════════════════════════════════════════════════════════════════════

STAGE_ORDER = [
    "Pending",
    "Outreach",
    "Engaged",
    "Proposal",
    "Quote Follow Up",
    "Finalizing",
    "Closed Won",
    "Closed Lost",
    "Won't Process",
    "Co-Term",
]

STAGE_RANK = {stage: i for i, stage in enumerate(STAGE_ORDER)}


def stage_rank(stage_name):
    """Return numeric rank for a stage. Unknown stages get -1."""
    return STAGE_RANK.get(stage_name, -1)


def stage_at_or_past(current_stage, target_stage):
    """True if current_stage is at or past the target in the pipeline."""
    return stage_rank(current_stage) >= stage_rank(target_stage)


# ══════════════════════════════════════════════════════════════════════════════
# ACTIVITY INDEX
# ══════════════════════════════════════════════════════════════════════════════


def build_activity_index(activities):
    """
    Build a lookup: opportunity_name -> list of activity records.
    Activities link to opps via What.Name (the opportunity name).
    """
    index = {}
    for act in activities:
        what = act.get("What")
        if isinstance(what, dict):
            opp_name = what.get("Name", "")
            if opp_name:
                index.setdefault(opp_name, []).append(act)
    return index


# ══════════════════════════════════════════════════════════════════════════════
# GATE EVALUATION LOGIC
# ══════════════════════════════════════════════════════════════════════════════


def evaluate_gate_0(opp, days_to_renewal, rules):
    """Gate 0: Data readiness — are required fields populated?"""
    gate = rules["gates"]["gate_0"]
    required = gate["required_fields"]

    missing = []
    for field in required:
        val = get_field(opp, field)
        if val is None or val == "" or val == 0:
            missing.append(field)

    # AR clause must not be blank
    ar = opp.get("CurrentContractHasAutoRenewalClause__c")
    ar_confirmed = ar is not None and ar != ""

    # Current ARR must be > 0
    current_arr = opp.get("Current_ARR__c") or 0

    passed = len(missing) == 0 and ar_confirmed and current_arr > 0
    violated = not passed and days_to_renewal <= 120

    return {
        "gate": 0,
        "name": "Data readiness",
        "status": "pass" if passed else ("violation" if violated else "pending"),
        "missing_fields": missing,
        "ar_clause_confirmed": ar_confirmed,
        "current_arr_valid": current_arr > 0,
        "deadline_days": 120,
    }


def evaluate_gate_1(opp, days_to_renewal, activities, rules):
    """Gate 1: Outreach activation — has the customer been engaged?"""
    stage = opp.get("StageName", "")
    last_activity = parse_date(opp.get("LastActivityDate"))
    is_hvo = opp.get("High_Value_Opp__c", False)

    # Pass if stage is beyond Outreach, OR if there's recent activity
    engaged = stage_at_or_past(stage, "Engaged")
    has_activity = last_activity is not None and (TODAY - last_activity).days <= 90

    # Check activity data for completed tasks
    has_completed_task = len(activities) > 0

    passed = engaged or has_activity or has_completed_task
    violated = not passed and days_to_renewal <= 90

    return {
        "gate": 1,
        "name": "Outreach activation",
        "status": "pass" if passed else ("violation" if violated else "pending"),
        "stage_engaged": engaged,
        "has_recent_activity": has_activity,
        "has_completed_tasks": has_completed_task,
        "is_hvo": is_hvo,
        "deadline_days": 90,
    }


def evaluate_gate_2(opp, days_to_renewal, activities, rules):
    """Gate 2: Discovery & needs assessment — has discovery been conducted?"""
    stage = opp.get("StageName", "")
    probable_outcome = opp.get("Probable_Outcome__c")
    last_activity = parse_date(opp.get("LastActivityDate"))
    ar_clause = opp.get("CurrentContractHasAutoRenewalClause__c")

    # Pass criteria: stage past Outreach AND probable outcome is set to something meaningful
    stage_ok = stage_at_or_past(stage, "Engaged")
    outcome_set = probable_outcome is not None and probable_outcome not in ("", "Undetermined")

    # Activity within the gate window
    has_recent_activity = last_activity is not None and (TODAY - last_activity).days <= 60

    passed = stage_ok and (outcome_set or has_recent_activity)
    violated = not passed and days_to_renewal <= 60

    # AR notice deadline context
    ar_deadline_passed = days_to_renewal <= 60 and ar_clause == "Yes"

    return {
        "gate": 2,
        "name": "Discovery and needs assessment",
        "status": "pass" if passed else ("violation" if violated else "pending"),
        "stage_past_outreach": stage_ok,
        "probable_outcome_set": outcome_set,
        "probable_outcome_value": probable_outcome,
        "has_recent_activity": has_recent_activity,
        "ar_notice_deadline_passed": ar_deadline_passed,
        "ar_clause": ar_clause,
        "deadline_days": 60,
    }


def evaluate_gate_3(opp, days_to_renewal, rules):
    """Gate 3: Proposal & pricing — has a quote been sent?"""
    stage = opp.get("StageName", "")
    ar_clause = opp.get("CurrentContractHasAutoRenewalClause__c")

    # Pass if stage indicates quote activity
    quote_sent = stage_at_or_past(stage, "Proposal")

    passed = quote_sent
    violated = not passed and days_to_renewal <= 30

    # AR auto-invoice fires at T-30
    ar_invoice_eligible = (
        violated
        and ar_clause == "Yes"
        and stage != "Finalizing"
        and not opp.get("IsClosed", False)
    )

    return {
        "gate": 3,
        "name": "Proposal and pricing",
        "status": "pass" if passed else ("violation" if violated else "pending"),
        "quote_stage_reached": quote_sent,
        "current_stage": stage,
        "ar_invoice_eligible": ar_invoice_eligible,
        "deadline_days": 30,
    }


def evaluate_gate_4(opp, days_to_renewal, rules):
    """Gate 4: Negotiation & follow-up — approaching close."""
    stage = opp.get("StageName", "")
    ar_clause = opp.get("CurrentContractHasAutoRenewalClause__c")

    finalizing_or_closed = stage_at_or_past(stage, "Finalizing")
    passed = finalizing_or_closed
    violated = not passed and days_to_renewal <= 7

    # Scenario prediction at this gate
    scenario_prediction = None
    if violated:
        if ar_clause == "Yes":
            scenario_prediction = "7: Unresponsive + AR (auto-renew likely)"
        else:
            scenario_prediction = "9: Unresponsive, no AR (Closed-Lost at T+0)"

    # T-5 final warning check for non-AR
    needs_final_warning = (
        not passed
        and ar_clause != "Yes"
        and 3 <= days_to_renewal <= 7
    )

    return {
        "gate": 4,
        "name": "Negotiation and follow-up",
        "status": "pass" if passed else ("violation" if violated else "pending"),
        "finalizing_or_closed": finalizing_or_closed,
        "current_stage": stage,
        "scenario_prediction": scenario_prediction,
        "needs_final_warning": needs_final_warning,
        "deadline_days": 7,
    }


def evaluate_gate_5(opp, days_to_renewal, rules):
    """Gate 5: Close execution — is the opp closed?"""
    is_closed = opp.get("IsClosed", False)
    stage = opp.get("StageName", "")

    passed = is_closed
    violated = not passed and days_to_renewal <= 0

    # Past due severity
    days_past_due = max(0, -days_to_renewal) if violated else 0

    return {
        "gate": 5,
        "name": "Close execution",
        "status": "pass" if passed else ("violation" if violated else "pending"),
        "is_closed": is_closed,
        "current_stage": stage,
        "days_past_due": days_past_due,
        "deadline_days": 0,
    }


def evaluate_gate_6(opp, days_to_renewal, rules):
    """Gate 6: Post-close QC — only evaluated for closed opps."""
    is_closed = opp.get("IsClosed", False)
    stage = opp.get("StageName", "")

    if not is_closed:
        return {
            "gate": 6,
            "name": "Post-close QC and feedback",
            "status": "not_applicable",
            "reason": "Opportunity not yet closed",
        }

    # QC checks for closed opps
    issues = []

    if stage == "Closed Lost":
        # Must have loss reason
        desc = opp.get("Description") or ""
        if not desc.strip():
            issues.append("Missing Description for Closed-Lost opportunity")
        # Win_Type should not be set for lost opps
    elif stage == "Closed Won":
        win_type = opp.get("Win_Type__c")
        if not win_type:
            issues.append("Missing Win_Type__c for Closed-Won opportunity")

    passed = len(issues) == 0
    return {
        "gate": 6,
        "name": "Post-close QC and feedback",
        "status": "pass" if passed else "warning",
        "qc_issues": issues,
    }


# ══════════════════════════════════════════════════════════════════════════════
# RISK SIGNAL DETECTION
# ══════════════════════════════════════════════════════════════════════════════


def detect_risk_signals(opp, days_to_renewal, activities, rules):
    """Detect cross-gate risk signals that aren't tied to a specific gate."""
    signals = []
    risk_config = rules.get("risk_signals", {})

    # No activity in N days
    last_activity = parse_date(opp.get("LastActivityDate"))
    no_activity_threshold = risk_config.get("no_activity_days", 14)
    if last_activity:
        days_since = (TODAY - last_activity).days
        if days_since > no_activity_threshold and not opp.get("IsClosed", False):
            signals.append({
                "signal": "no_recent_activity",
                "detail": f"No activity in {days_since} days (threshold: {no_activity_threshold})",
                "severity": "high" if days_to_renewal <= 30 else "medium",
            })
    elif not opp.get("IsClosed", False):
        signals.append({
            "signal": "no_activity_ever",
            "detail": "LastActivityDate is null — no recorded activity",
            "severity": "high",
        })

    # Follow-up overdue
    follow_up = parse_date(opp.get("Next_Follow_Up_Date__c"))
    if follow_up and follow_up < TODAY and not opp.get("IsClosed", False):
        days_overdue = (TODAY - follow_up).days
        signals.append({
            "signal": "follow_up_overdue",
            "detail": f"Next Follow-Up Date was {days_overdue} days ago",
            "severity": "high" if days_overdue > 7 else "medium",
        })

    # Churn language in description/NextStep
    churn_patterns = risk_config.get("churn_language_patterns", [])
    desc = (opp.get("Description") or "").lower()
    next_step = (opp.get("NextStep") or "").lower()
    churn_risks_field = (opp.get("Churn_Risks__c") or "").lower()
    combined_text = f"{desc} {next_step} {churn_risks_field}"

    found_patterns = [p for p in churn_patterns if p in combined_text]
    if found_patterns and not opp.get("IsClosed", False):
        signals.append({
            "signal": "churn_language_detected",
            "detail": f"Found: {', '.join(found_patterns)}",
            "severity": "high",
        })

    # Probable outcome = Likely to Churn
    probable = opp.get("Probable_Outcome__c")
    if probable == "Likely to Churn" and not opp.get("IsClosed", False):
        signals.append({
            "signal": "probable_churn",
            "detail": "Probable Outcome set to Likely to Churn",
            "severity": "critical",
        })

    return signals


# ══════════════════════════════════════════════════════════════════════════════
# SCENARIO PREDICTION
# ══════════════════════════════════════════════════════════════════════════════


def predict_scenario(opp, days_to_renewal, gate_results):
    """
    Predict which of the 10 closing scenarios this opportunity is tracking toward.
    Based on current gate state, AR clause, engagement level, and signals.
    """
    stage = opp.get("StageName", "")
    ar_clause = opp.get("CurrentContractHasAutoRenewalClause__c")
    is_closed = opp.get("IsClosed", False)
    probable = opp.get("Probable_Outcome__c")

    if is_closed:
        win_type = opp.get("Win_Type__c", "")
        if stage == "Closed Won":
            if win_type == "Auto-Renew":
                return {"scenario": 7, "name": "Unresponsive + AR", "confidence": "confirmed"}
            return {"scenario": 1, "name": "Standard on-time renewal", "confidence": "confirmed"}
        elif stage == "Closed Lost":
            return {"scenario": 2, "name": "Standard on-time cancellation", "confidence": "confirmed"}
        elif stage == "Won't Process":
            return {"scenario": None, "name": "Won't Process (not a scenario)", "confidence": "confirmed"}

    # For open opps, predict based on signals
    g1 = gate_results.get(1, {})
    g2 = gate_results.get(2, {})

    # Check for engagement
    is_engaged = stage_at_or_past(stage, "Engaged")
    is_unresponsive = g1.get("status") == "violation" or (
        not is_engaged and days_to_renewal <= 60
    )

    if probable == "Likely to Churn":
        if ar_clause == "Yes" and days_to_renewal <= 60:
            return {"scenario": 8, "name": "Late cancellation + AR", "confidence": "medium"}
        return {"scenario": 2, "name": "Standard cancellation", "confidence": "medium"}

    if is_unresponsive:
        if ar_clause == "Yes":
            return {"scenario": 7, "name": "Unresponsive + AR", "confidence": "high"}
        return {"scenario": 9, "name": "Unresponsive, no AR", "confidence": "high"}

    if is_engaged and days_to_renewal > 30:
        return {"scenario": 1, "name": "Standard on-time renewal", "confidence": "low"}

    if is_engaged and days_to_renewal <= 30 and not stage_at_or_past(stage, "Finalizing"):
        if ar_clause == "Yes":
            return {"scenario": 6, "name": "Late signature + AR", "confidence": "medium"}
        return {"scenario": 3, "name": "Customer delay", "confidence": "low"}

    return {"scenario": 1, "name": "Standard on-time renewal", "confidence": "low"}


# ══════════════════════════════════════════════════════════════════════════════
# DETERMINE CURRENT GATE
# ══════════════════════════════════════════════════════════════════════════════


def determine_current_gate(gate_results):
    """
    Determine the current gate position: the earliest gate that has not passed.
    If all gates pass, the opp is fully resolved.
    """
    for gate_num in range(7):
        result = gate_results.get(gate_num, {})
        status = result.get("status", "not_applicable")
        if status in ("pending", "violation"):
            return gate_num
    return 6  # All gates passed or N/A


# ══════════════════════════════════════════════════════════════════════════════
# RECOMMENDED ACTIONS
# ══════════════════════════════════════════════════════════════════════════════


def recommend_actions(opp, days_to_renewal, current_gate, gate_results, risk_signals, scenario):
    """Generate a prioritised list of recommended actions."""
    actions = []
    stage = opp.get("StageName", "")
    ar_clause = opp.get("CurrentContractHasAutoRenewalClause__c")

    # Gate-specific actions
    if current_gate == 0:
        missing = gate_results.get(0, {}).get("missing_fields", [])
        if missing:
            actions.append({
                "priority": 1,
                "action": f"Complete data readiness: populate {', '.join(missing)}",
                "owner": "SDR",
                "deadline_days": 120,
            })

    elif current_gate == 1:
        if not gate_results.get(1, {}).get("stage_engaged", False):
            actions.append({
                "priority": 1,
                "action": "Initiate customer outreach — phone call prioritised over email",
                "owner": "ISR",
                "deadline_days": 90,
            })

    elif current_gate == 2:
        if not gate_results.get(2, {}).get("probable_outcome_set", False):
            actions.append({
                "priority": 1,
                "action": "Conduct discovery call (Pain Points Playbook). Set Probable Outcome.",
                "owner": "ISR",
                "deadline_days": 60,
            })

    elif current_gate == 3:
        if not gate_results.get(3, {}).get("quote_stage_reached", False):
            actions.append({
                "priority": 1,
                "action": "Create and send renewal quote. Submit for VP approval.",
                "owner": "ISR",
                "deadline_days": 30,
            })

    elif current_gate == 4:
        g4 = gate_results.get(4, {})
        if g4.get("needs_final_warning"):
            actions.append({
                "priority": 1,
                "action": "Send T-5 final warning email (Scenario #9 — service termination notice)",
                "owner": "ISR",
                "deadline_days": days_to_renewal,
            })
        elif g4.get("scenario_prediction") and "auto-renew" in (g4.get("scenario_prediction") or "").lower():
            actions.append({
                "priority": 1,
                "action": "Prepare AR execution — same term, edition, success + 10% AR penalty",
                "owner": "ISR",
                "deadline_days": 7,
            })

    elif current_gate == 5:
        g5 = gate_results.get(5, {})
        if g5.get("days_past_due", 0) > 0:
            actions.append({
                "priority": 1,
                "action": f"PAST DUE by {g5['days_past_due']} days — close immediately. Escalate to VP.",
                "owner": "ISR/VP",
                "deadline_days": 0,
            })

    # Risk-driven actions
    for sig in risk_signals:
        if sig["signal"] == "no_recent_activity" and sig["severity"] == "high":
            actions.append({
                "priority": 2,
                "action": f"No activity in {sig['detail'].split()[3]} days — attempt contact immediately",
                "owner": "ISR",
                "deadline_days": min(days_to_renewal, 3),
            })
        elif sig["signal"] == "follow_up_overdue":
            actions.append({
                "priority": 2,
                "action": f"Follow-up is overdue ({sig['detail']})",
                "owner": "ISR",
                "deadline_days": 0,
            })
        elif sig["signal"] == "probable_churn":
            actions.append({
                "priority": 1,
                "action": "Account flagged Likely to Churn — conduct Pain Points call, escalate to Product Owners",
                "owner": "ISR/VP",
                "deadline_days": min(days_to_renewal, 7),
            })

    # Sort by priority
    actions.sort(key=lambda a: (a["priority"], a.get("deadline_days", 999)))
    return actions


# ══════════════════════════════════════════════════════════════════════════════
# MAIN EVALUATION
# ══════════════════════════════════════════════════════════════════════════════


def evaluate_opportunity(opp, activity_index, rules):
    """Evaluate a single opportunity against all 7 gates."""
    opp_id = opp.get("Id", "unknown")
    opp_name = opp.get("Name", "unknown")
    renewal_date = parse_date(opp.get("Renewal_Date__c"))

    if not renewal_date:
        return {
            "opp_id": opp_id,
            "opp_name": opp_name,
            "error": "Missing Renewal_Date__c — cannot evaluate",
        }

    days_to_renewal = (renewal_date - TODAY).days
    opp_activities = activity_index.get(opp_name, [])

    # Evaluate each gate
    gate_results = {}
    gate_results[0] = evaluate_gate_0(opp, days_to_renewal, rules)
    gate_results[1] = evaluate_gate_1(opp, days_to_renewal, opp_activities, rules)
    gate_results[2] = evaluate_gate_2(opp, days_to_renewal, opp_activities, rules)
    gate_results[3] = evaluate_gate_3(opp, days_to_renewal, rules)
    gate_results[4] = evaluate_gate_4(opp, days_to_renewal, rules)
    gate_results[5] = evaluate_gate_5(opp, days_to_renewal, rules)
    gate_results[6] = evaluate_gate_6(opp, days_to_renewal, rules)

    # Determine current position and predictions
    current_gate = determine_current_gate(gate_results)
    risk_signals = detect_risk_signals(opp, days_to_renewal, opp_activities, rules)
    scenario = predict_scenario(opp, days_to_renewal, gate_results)
    actions = recommend_actions(opp, days_to_renewal, current_gate, gate_results, risk_signals, scenario)

    # Count violations
    violations = [g for g in gate_results.values() if g.get("status") == "violation"]

    # Overall risk level
    if len(violations) >= 2 or any(s["severity"] == "critical" for s in risk_signals):
        overall_risk = "critical"
    elif len(violations) == 1 or any(s["severity"] == "high" for s in risk_signals):
        overall_risk = "high"
    elif any(s["severity"] == "medium" for s in risk_signals):
        overall_risk = "medium"
    else:
        overall_risk = "low"

    return {
        "opp_id": opp_id,
        "opp_name": opp_name,
        "account_name": get_account_name(opp),
        "owner": get_owner_name(opp),
        "stage": opp.get("StageName"),
        "arr": opp.get("ARR__c"),
        "current_arr": opp.get("Current_ARR__c"),
        "renewal_date": opp.get("Renewal_Date__c"),
        "days_to_renewal": days_to_renewal,
        "ar_clause": opp.get("CurrentContractHasAutoRenewalClause__c"),
        "probable_outcome": opp.get("Probable_Outcome__c"),
        "is_hvo": opp.get("High_Value_Opp__c", False),
        "is_closed": opp.get("IsClosed", False),

        "current_gate": current_gate,
        "gate_results": gate_results,
        "violation_count": len(violations),
        "overall_risk": overall_risk,
        "risk_signals": risk_signals,
        "scenario_prediction": scenario,
        "recommended_actions": actions,
    }


# ══════════════════════════════════════════════════════════════════════════════
# SUMMARY STATISTICS
# ══════════════════════════════════════════════════════════════════════════════


def compute_summary(evaluations):
    """Compute aggregate statistics across all evaluated opportunities."""
    total = len(evaluations)
    by_gate = {}
    by_risk = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    by_owner = {}
    total_violations = 0
    total_arr_at_risk = 0

    for ev in evaluations:
        if "error" in ev:
            continue

        # By current gate
        gate = ev["current_gate"]
        by_gate[gate] = by_gate.get(gate, 0) + 1

        # By risk
        risk = ev.get("overall_risk", "low")
        by_risk[risk] = by_risk.get(risk, 0) + 1

        # By owner
        owner = ev.get("owner", "Unknown")
        if owner not in by_owner:
            by_owner[owner] = {"total": 0, "violations": 0, "critical": 0}
        by_owner[owner]["total"] += 1
        by_owner[owner]["violations"] += ev.get("violation_count", 0)
        if risk == "critical":
            by_owner[owner]["critical"] += 1

        # Totals
        total_violations += ev.get("violation_count", 0)
        if risk in ("critical", "high"):
            total_arr_at_risk += ev.get("current_arr") or ev.get("arr") or 0

    return {
        "total_opportunities": total,
        "evaluated_at": TODAY.isoformat(),
        "by_current_gate": {f"gate_{k}": v for k, v in sorted(by_gate.items())},
        "by_risk_level": by_risk,
        "by_owner": by_owner,
        "total_violations": total_violations,
        "total_arr_at_risk": round(total_arr_at_risk, 2),
    }


# ══════════════════════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("Gate Evaluator — Phase 1 (Read-Only)", file=sys.stderr)
    print(f"  → Date: {TODAY.isoformat()}", file=sys.stderr)
    print(f"  → Rules: {RULES_FILE}", file=sys.stderr)

    # Load data
    rules = load_json(RULES_FILE, required=True)
    # rules file is a dict, not a list
    if isinstance(rules, list):
        print("ERROR: gate_rules.json should be a JSON object, not an array", file=sys.stderr)
        sys.exit(1)
    # reload properly since load_json strips envelope
    with open(RULES_FILE) as f:
        rules = json.load(f)

    opportunities = load_json(OPP_FILE, required=True)
    activities = load_json(ACTIVITIES_FILE, required=False)

    # Build activity index
    activity_index = build_activity_index(activities)
    print(f"  → Activity index: {len(activity_index)} opportunities with activities", file=sys.stderr)

    # Filter to relevant opps (open, with renewal date)
    relevant = [
        opp for opp in opportunities
        if opp.get("Renewal_Date__c")
        and opp.get("StageName") not in ("Won't Process",)
        and opp.get("Type") != "OEM"
    ]
    print(f"  → Evaluating {len(relevant)} relevant opportunities (of {len(opportunities)} total)", file=sys.stderr)

    # Evaluate
    evaluations = []
    for opp in relevant:
        result = evaluate_opportunity(opp, activity_index, rules)
        evaluations.append(result)

    # Sort by urgency: violations first, then days to renewal
    evaluations.sort(
        key=lambda e: (
            -e.get("violation_count", 0),
            {"critical": 0, "high": 1, "medium": 2, "low": 3}.get(e.get("overall_risk", "low"), 4),
            e.get("days_to_renewal", 9999),
        )
    )

    # Compute summary
    summary = compute_summary(evaluations)

    # Write output
    output = {
        "metadata": {
            "version": "1.0",
            "evaluated_at": TODAY.isoformat(),
            "framework": "7-gate renewal lifecycle (Phase 1 — deterministic, read-only)",
            "total_evaluated": len(evaluations),
            "rules_file": os.path.basename(RULES_FILE),
        },
        "summary": summary,
        "opportunities": evaluations,
    }

    os.makedirs(os.path.dirname(os.path.abspath(OUTPUT_FILE)), exist_ok=True)
    with open(OUTPUT_FILE, "w") as f:
        json.dump(output, f, indent=2, default=str)

    print(f"\n  → Output: {OUTPUT_FILE}", file=sys.stderr)
    print(f"  → Evaluated: {len(evaluations)} opportunities", file=sys.stderr)
    print(f"  → Violations: {summary['total_violations']}", file=sys.stderr)
    print(f"  → ARR at risk: ${summary['total_arr_at_risk']:,.0f}", file=sys.stderr)
    print(f"  → Risk breakdown: {summary['by_risk_level']}", file=sys.stderr)
    print(f"  → Gate distribution: {summary['by_current_gate']}", file=sys.stderr)
