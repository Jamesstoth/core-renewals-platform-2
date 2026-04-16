#!/usr/bin/env python3
"""
Agent Gate Evaluator — Phase 2 (AI Reasoning Layer)

Takes the Phase 1 deterministic evaluation + raw SF data, sends each ISR's
portfolio to Claude via the Messages API for deeper reasoning, and produces:

  1. data/gate_evaluations_agent.json  — enriched evaluations with AI reasoning
  2. data/briefings/{owner_slug}.md    — per-ISR daily briefing markdown

Runs AFTER evaluate_gates.py in the pipeline. If this script fails, Phase 1
output remains as the fallback — the dashboard still works.

Requires: ANTHROPIC_API_KEY environment variable.

Usage:
  python3 lib/agent_evaluate.py
  python3 lib/agent_evaluate.py --dry-run          # show what would be sent, no API calls
  python3 lib/agent_evaluate.py --owner "James Quigley"  # single ISR only
"""

import json
import os
import sys
import time
import urllib.request
import urllib.error
from datetime import date, datetime
from collections import defaultdict

# ══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION
# ══════════════════════════════════════════════════════════════════════════════

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TODAY = date.today()

# Input files
EVAL_FILE = os.path.join(BASE_DIR, "data", "gate_evaluations.json")
RAW_FILE = os.path.join(BASE_DIR, "data", "sf_latest.json")
ACTIVITIES_FILE = os.path.join(BASE_DIR, "data", "sf_activities_latest.json")

# Output files
AGENT_EVAL_FILE = os.path.join(BASE_DIR, "data", "gate_evaluations_agent.json")
BRIEFINGS_DIR = os.path.join(BASE_DIR, "data", "briefings")

# API config
API_URL = "https://api.anthropic.com/v1/messages"
MODEL = "claude-sonnet-4-6"
MAX_TOKENS = 16384

# CLI args
DRY_RUN = "--dry-run" in sys.argv
SINGLE_OWNER = None
for i, arg in enumerate(sys.argv):
    if arg == "--owner" and i + 1 < len(sys.argv):
        SINGLE_OWNER = sys.argv[i + 1]

# ══════════════════════════════════════════════════════════════════════════════
# SYSTEM PROMPT
# ══════════════════════════════════════════════════════════════════════════════

SYSTEM_PROMPT = """You are the AI Renewal Analyst for Trilogy's Core Renewals team. You analyse renewal opportunities through a 7-gate lifecycle framework and produce actionable daily briefings for ISRs (Inside Sales Representatives).

## Your role
- Read each opportunity's deterministic gate evaluation (pass/fail/violation per gate)
- Read the raw Salesforce Description and NextStep fields for context the evaluator cannot parse
- Identify churn signals, engagement patterns, and cross-portfolio risks
- Produce a prioritised daily briefing the ISR can act on immediately

## 7-gate framework
- Gate 0 (Data readiness, T-180 to T-120): Required fields populated, AR clause confirmed
- Gate 1 (Outreach, T-120 to T-90): Customer engaged, stage past Pending
- Gate 2 (Discovery, T-90 to T-60): Discovery call done, Probable Outcome set. T-60 = AR notice deadline
- Gate 3 (Proposal, T-60 to T-30): Quote sent. AR auto-invoice fires at T-30
- Gate 4 (Negotiation, T-30 to T-7): Quote follow-up. T-5 final warning for non-AR unresponsive
- Gate 5 (Close, T-7 to T+0): Must be closed by renewal date
- Gate 6 (QC, T+0 to T+30): Post-close quality check

## 10 closing scenarios
1. Standard on-time renewal (signs before deadline)
2. Standard on-time cancellation (formal notice before AR deadline)
3. Customer delay with commitment (signs extension form)
4. Customer delay without commitment (closed-lost)
5. Internal delay (our fault — 2-week extension)
6. Late signature with AR (AR executed at T-7, quote can override)
7. Unresponsive with AR (AR auto-executed)
8. Late cancellation with AR (AR binding, cancellation denied)
9. Unresponsive without AR (final warning at T-5, closed-lost at T+0)
10. Bankruptcy / legal hold (suspended, Finance/Legal directed)

## Business rules
- 25/35/45% pricing: Standard +25%, Gold +35%, Platinum +45%. Non-negotiable.
- AR penalty: +10% on top of success uplift for "then current" pricing
- AR notice period: 60 days (standard). After T-60, customer cannot cancel if AR exists.
- Extension requires signed commitment form (Scenario 3) or internal fault (Scenario 5)
- Cancellations route to cancellations@trilogy.com — 72-hour SLA

## What to look for in Description/NextStep text
- Churn language: "cancel", "not renew", "evaluating alternatives", "budget pressure", "competitor"
- Positive signals: "ready to sign", "procurement processing", "just need PO", "approved internally"
- Legal/compliance blockers: "legal review", "redlines", "DPA", "security questionnaire"
- Internal delays: "O2C", "billing issue", "quote error", "system problem"
- Customer delays: "internal approval", "budget cycle", "reorganisation"

## Output format
Respond with valid JSON only. No markdown, no backticks, no preamble. The JSON structure:

{
  "briefing_date": "YYYY-MM-DD",
  "owner": "Full Name",
  "executive_summary": "2-3 sentence overview of portfolio health and top priorities",
  "critical_actions": [
    {
      "opp_name": "...",
      "account": "...",
      "arr": 0,
      "days_to_renewal": 0,
      "action": "Specific action to take today",
      "reasoning": "Why this is urgent — what the agent sees that the deterministic evaluator might miss",
      "scenario_prediction": "Scenario #N: Name",
      "confidence": "high/medium/low"
    }
  ],
  "at_risk_accounts": [
    {
      "opp_name": "...",
      "account": "...",
      "arr": 0,
      "risk_summary": "What the Description/NextStep reveals about churn risk",
      "recommended_approach": "Specific strategy from the playbook"
    }
  ],
  "positive_signals": [
    {
      "opp_name": "...",
      "account": "...",
      "signal": "What looks good and why"
    }
  ],
  "cross_portfolio_patterns": [
    "Pattern observed across multiple accounts (e.g. product-level issues, timing clusters)"
  ],
  "opportunity_assessments": [
    {
      "opp_id": "...",
      "opp_name": "...",
      "agent_reasoning": "1-2 sentence AI assessment beyond what the deterministic evaluator found",
      "confidence_adjustment": "agree/upgrade/downgrade",
      "adjusted_risk": "critical/high/medium/low",
      "adjusted_scenario": "Scenario #N or null if no change"
    }
  ]
}

CRITICAL OUTPUT CONSTRAINTS:
- Keep executive_summary under 3 sentences
- critical_actions: maximum 5 items. Only the most urgent.
- at_risk_accounts: maximum 5 items.
- positive_signals: maximum 3 items.
- cross_portfolio_patterns: maximum 3 items.
- opportunity_assessments: maximum 15 items. Only include opps where your assessment DIFFERS from the deterministic evaluator or adds meaningful insight. Skip opps where you agree with the existing evaluation.
- Keep all text fields concise. One sentence per field unless the situation demands more."""

# ══════════════════════════════════════════════════════════════════════════════
# DATA LOADING
# ══════════════════════════════════════════════════════════════════════════════


def load_json(path, required=True):
    if not os.path.exists(path):
        if required:
            print(f"ERROR: Required file not found: {path}", file=sys.stderr)
            sys.exit(1)
        return []
    with open(path) as f:
        data = json.load(f)
    if isinstance(data, dict) and "records" in data:
        data = data["records"]
    return data


# ══════════════════════════════════════════════════════════════════════════════
# PORTFOLIO CONSTRUCTION
# ══════════════════════════════════════════════════════════════════════════════


def build_opp_context(eval_opp, raw_by_id, activity_index):
    """Build a concise context block for one opportunity."""
    opp_id = eval_opp.get("opp_id", "")
    raw = raw_by_id.get(opp_id, {})

    desc = (raw.get("Description") or "")
    # Truncate to most recent entries — 800 chars balances context vs cost
    if len(desc) > 800:
        desc = desc[:800] + "... [truncated]"

    next_step = raw.get("NextStep") or ""
    churn_risks = raw.get("Churn_Risks__c") or ""

    # Get activities for this opp
    opp_name = eval_opp.get("opp_name", "")
    activities = activity_index.get(opp_name, [])
    act_summary = ""
    if activities:
        act_lines = []
        for a in activities[:5]:
            act_lines.append(f"  {a.get('ActivityDate','')} | {a.get('Subject','')} | {a.get('CallDisposition','')}")
        act_summary = "\n".join(act_lines)

    # Compact eval summary (skip full gate_results to save tokens)
    risk_signals = eval_opp.get("risk_signals", [])
    signals_str = "; ".join(s.get("detail", "") for s in risk_signals) if risk_signals else "None"

    return f"""--- OPP: {opp_name} ---
Account: {eval_opp.get('account_name','')}
ARR: ${eval_opp.get('current_arr',0):,.0f} (offer: ${eval_opp.get('arr',0):,.0f})
Renewal: {eval_opp.get('renewal_date','')} ({eval_opp.get('days_to_renewal','')} days)
Stage: {eval_opp.get('stage','')} | AR: {eval_opp.get('ar_clause','')} | HVO: {eval_opp.get('is_hvo',False)}
Probable Outcome: {eval_opp.get('probable_outcome','')}
Gate: {eval_opp.get('current_gate','')} | Risk: {eval_opp.get('overall_risk','')} | Violations: {eval_opp.get('violation_count',0)}
Scenario prediction: {eval_opp.get('scenario_prediction',{}).get('name','')} (confidence: {eval_opp.get('scenario_prediction',{}).get('confidence','')})
Risk signals: {signals_str}
Churn Risks (SF field): {churn_risks}
NextStep: {next_step}
Description (recent):
{desc}
{f'Recent activities:{chr(10)}{act_summary}' if act_summary else ''}"""


def build_portfolio_prompt(owner, eval_opps, raw_by_id, activity_index):
    """Build the user message for one ISR's portfolio."""
    # Sort: critical first, then by days_to_renewal ascending
    risk_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    sorted_opps = sorted(
        eval_opps,
        key=lambda o: (
            risk_order.get(o.get("overall_risk", "low"), 4),
            o.get("days_to_renewal", 9999),
        ),
    )

    # Only send critical + high risk opps to Claude (Option B optimisation)
    # Medium/low risk opps are adequately covered by Phase 1 deterministic evaluation
    detailed = [o for o in sorted_opps if o.get("overall_risk") in ("critical", "high")]
    skipped = [o for o in sorted_opps if o.get("overall_risk") in ("medium", "low")]

    opp_blocks = []
    for o in detailed:
        opp_blocks.append(build_opp_context(o, raw_by_id, activity_index))

    portfolio_text = "\n\n".join(opp_blocks)

    return f"""Analyse the following renewal portfolio for {owner} as of {TODAY.isoformat()}.

Total open: {len(eval_opps)} opportunities
Sent for AI analysis (critical + high risk): {len(detailed)}
Handled by deterministic evaluator only (medium + low): {len(skipped)}

Produce the daily briefing JSON for {owner}. Focus on:
1. What needs to happen TODAY (critical actions with specific steps)
2. Which accounts show churn signals in the Description that the gate evaluator flagged but couldn't interpret
3. Any positive signals that suggest an opp is closer to closing than the gate status implies
4. Cross-portfolio patterns (same product issues, timing clusters, common blockers)

PORTFOLIO DATA:

{portfolio_text}"""


# ══════════════════════════════════════════════════════════════════════════════
# ANTHROPIC API CALL
# ══════════════════════════════════════════════════════════════════════════════


def call_claude(system, user_message, retries=3):
    """Call Claude Messages API. Returns parsed JSON response or None on failure."""
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("ERROR: ANTHROPIC_API_KEY not set", file=sys.stderr)
        return None

    payload = json.dumps({
        "model": MODEL,
        "max_tokens": MAX_TOKENS,
        "system": system,
        "messages": [{"role": "user", "content": user_message}],
    }).encode()

    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }

    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(API_URL, data=payload, headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=300) as resp:
                data = json.loads(resp.read().decode())

            # Extract text content
            text = ""
            for block in data.get("content", []):
                if block.get("type") == "text":
                    text += block.get("text", "")

            # Check if response was truncated
            stop_reason = data.get("stop_reason", "")
            if stop_reason == "max_tokens":
                print(f"    WARNING: Response truncated (hit max_tokens). Attempting salvage.", file=sys.stderr)

            # Parse JSON from response (strip any markdown fencing)
            text = text.strip()
            if text.startswith("```"):
                text = text.split("\n", 1)[1] if "\n" in text else text[3:]
            if text.endswith("```"):
                text = text[:-3]
            text = text.strip()

            try:
                result = json.loads(text)
            except json.JSONDecodeError:
                # Attempt to salvage truncated JSON by closing open structures
                salvaged = text
                # Count open braces/brackets
                opens = salvaged.count("{") - salvaged.count("}")
                opens_arr = salvaged.count("[") - salvaged.count("]")
                # Strip back to last complete entry
                for char in [",", "\n"]:
                    idx = salvaged.rfind(char)
                    if idx > len(salvaged) * 0.8:
                        salvaged = salvaged[:idx]
                        break
                salvaged += "]" * max(0, opens_arr) + "}" * max(0, opens)
                try:
                    result = json.loads(salvaged)
                    print(f"    Salvaged truncated JSON successfully", file=sys.stderr)
                except json.JSONDecodeError:
                    raise

            # Log token usage
            usage = data.get("usage", {})
            print(f"    Tokens: {usage.get('input_tokens', '?')} in, {usage.get('output_tokens', '?')} out",
                  file=sys.stderr)

            return result

        except urllib.error.HTTPError as e:
            body = e.read().decode()[:300]
            print(f"  → Attempt {attempt} HTTP error {e.code}: {body}", file=sys.stderr)
            if e.code == 529 or e.code == 429:
                # Overloaded or rate limited — wait and retry
                time.sleep(10 * attempt)
            elif attempt == retries:
                print(f"  → All retries exhausted for API call", file=sys.stderr)
                return None
        except json.JSONDecodeError as e:
            print(f"  → Attempt {attempt} JSON parse error: {e}", file=sys.stderr)
            print(f"    Raw text (first 500): {text[:500]}", file=sys.stderr)
            if attempt == retries:
                return None
        except Exception as e:
            print(f"  → Attempt {attempt} error: {e}", file=sys.stderr)
            if attempt == retries:
                return None

        time.sleep(2 ** attempt)

    return None


# ══════════════════════════════════════════════════════════════════════════════
# BRIEFING GENERATION
# ══════════════════════════════════════════════════════════════════════════════


def format_briefing_markdown(briefing, owner):
    """Convert the JSON briefing response into formatted markdown."""
    lines = []
    lines.append(f"# Daily Renewal Briefing — {owner}")
    lines.append(f"**{briefing.get('briefing_date', TODAY.isoformat())}**\n")
    lines.append(f"## Executive summary")
    lines.append(f"{briefing.get('executive_summary', 'No summary available.')}\n")

    # Critical actions
    actions = briefing.get("critical_actions", [])
    if actions:
        lines.append(f"## Critical actions ({len(actions)})")
        for i, a in enumerate(actions, 1):
            arr_str = f"${a.get('arr',0):,.0f}" if a.get("arr") else ""
            lines.append(f"### {i}. {a.get('opp_name', 'Unknown')}")
            lines.append(f"**Account:** {a.get('account', '')} | **ARR:** {arr_str} | "
                         f"**Renewal:** {a.get('days_to_renewal', '?')} days")
            lines.append(f"**Action:** {a.get('action', '')}")
            lines.append(f"**Reasoning:** {a.get('reasoning', '')}")
            lines.append(f"**Scenario:** {a.get('scenario_prediction', '')} "
                         f"(confidence: {a.get('confidence', '')})\n")

    # At risk accounts
    at_risk = briefing.get("at_risk_accounts", [])
    if at_risk:
        lines.append(f"## At-risk accounts ({len(at_risk)})")
        for a in at_risk:
            arr_str = f"${a.get('arr',0):,.0f}" if a.get("arr") else ""
            lines.append(f"- **{a.get('opp_name', '')}** ({a.get('account', '')}, {arr_str}): "
                         f"{a.get('risk_summary', '')}")
            lines.append(f"  *Approach:* {a.get('recommended_approach', '')}\n")

    # Positive signals
    positives = briefing.get("positive_signals", [])
    if positives:
        lines.append(f"## Positive signals ({len(positives)})")
        for p in positives:
            lines.append(f"- **{p.get('opp_name', '')}** ({p.get('account', '')}): {p.get('signal', '')}")
        lines.append("")

    # Cross-portfolio patterns
    patterns = briefing.get("cross_portfolio_patterns", [])
    if patterns:
        lines.append(f"## Cross-portfolio patterns")
        for p in patterns:
            lines.append(f"- {p}")
        lines.append("")

    lines.append("---")
    lines.append(f"*Generated by AI Renewal Analyst — {datetime.now().strftime('%Y-%m-%d %H:%M')}*")
    lines.append(f"*Phase 1 deterministic evaluation is the fallback if this briefing is unavailable.*")

    return "\n".join(lines)


# ══════════════════════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("Agent Gate Evaluator — Phase 2 (AI Reasoning)", file=sys.stderr)
    print(f"  → Date: {TODAY.isoformat()}", file=sys.stderr)
    print(f"  → Model: {MODEL}", file=sys.stderr)
    if DRY_RUN:
        print("  → DRY RUN — no API calls will be made", file=sys.stderr)

    # Load data
    eval_data = load_json(EVAL_FILE, required=True)
    if isinstance(eval_data, dict):
        eval_opps = eval_data.get("opportunities", [])
    else:
        eval_opps = eval_data

    raw_records = load_json(RAW_FILE, required=True)
    if isinstance(raw_records, dict):
        raw_records = raw_records.get("records", raw_records)

    activities = load_json(ACTIVITIES_FILE, required=False)

    # Build lookups
    raw_by_id = {}
    for r in raw_records:
        if isinstance(r, dict) and "Id" in r:
            raw_by_id[r["Id"]] = r

    activity_index = defaultdict(list)
    for a in activities:
        if isinstance(a, dict):
            what = a.get("What")
            if isinstance(what, dict) and what.get("Name"):
                activity_index[what["Name"]].append(a)

    # Filter to open opps
    open_opps = [o for o in eval_opps if not o.get("is_closed", False)]
    print(f"  → {len(open_opps)} open opportunities to analyse", file=sys.stderr)

    # Group by owner
    by_owner = defaultdict(list)
    for o in open_opps:
        by_owner[o.get("owner", "Unknown")].append(o)

    if SINGLE_OWNER:
        if SINGLE_OWNER in by_owner:
            by_owner = {SINGLE_OWNER: by_owner[SINGLE_OWNER]}
        else:
            print(f"ERROR: Owner '{SINGLE_OWNER}' not found. Available: {list(by_owner.keys())}",
                  file=sys.stderr)
            sys.exit(1)

    print(f"  → {len(by_owner)} ISR portfolios to process", file=sys.stderr)

    # Process each owner
    os.makedirs(BRIEFINGS_DIR, exist_ok=True)
    all_briefings = {}
    all_assessments = {}

    for owner, owner_opps in sorted(by_owner.items()):
        slug = owner.lower().replace(" ", "_")
        print(f"\n  → Processing: {owner} ({len(owner_opps)} opps)", file=sys.stderr)

        prompt = build_portfolio_prompt(owner, owner_opps, raw_by_id, activity_index)
        token_estimate = len(prompt) // 4
        print(f"    Prompt: ~{token_estimate:,} tokens", file=sys.stderr)

        if DRY_RUN:
            # Save the prompt for inspection
            dry_path = os.path.join(BRIEFINGS_DIR, f"{slug}_prompt.txt")
            with open(dry_path, "w") as f:
                f.write(f"SYSTEM:\n{SYSTEM_PROMPT}\n\nUSER:\n{prompt}")
            print(f"    Dry run saved: {dry_path}", file=sys.stderr)
            continue

        # Call Claude
        briefing = call_claude(SYSTEM_PROMPT, prompt)

        if briefing:
            # Save briefing markdown
            md = format_briefing_markdown(briefing, owner)
            md_path = os.path.join(BRIEFINGS_DIR, f"{slug}.md")
            with open(md_path, "w") as f:
                f.write(md)
            print(f"    Briefing saved: {md_path}", file=sys.stderr)

            all_briefings[owner] = briefing

            # Collect opportunity assessments
            for assessment in briefing.get("opportunity_assessments", []):
                opp_id = assessment.get("opp_id", "")
                if opp_id:
                    all_assessments[opp_id] = assessment
        else:
            print(f"    WARNING: API call failed for {owner} — skipping", file=sys.stderr)

        # Rate limiting courtesy
        if len(by_owner) > 1:
            time.sleep(2)

    if DRY_RUN:
        print(f"\n  → Dry run complete. Prompts saved to {BRIEFINGS_DIR}/", file=sys.stderr)
        sys.exit(0)

    # ── Merge agent assessments into enriched evaluations ─────────────────────
    enriched_opps = []
    for opp in eval_opps:
        enriched = dict(opp)
        opp_id = opp.get("opp_id", "")
        if opp_id in all_assessments:
            assessment = all_assessments[opp_id]
            enriched["agent_reasoning"] = assessment.get("agent_reasoning", "")
            enriched["confidence_adjustment"] = assessment.get("confidence_adjustment", "agree")
            enriched["adjusted_risk"] = assessment.get("adjusted_risk", opp.get("overall_risk"))
            enriched["adjusted_scenario"] = assessment.get("adjusted_scenario")
        enriched_opps.append(enriched)

    # ── Write enriched evaluations ────────────────────────────────────────────
    agent_output = {
        "metadata": {
            "version": "2.0",
            "evaluated_at": TODAY.isoformat(),
            "framework": "7-gate renewal lifecycle (Phase 2 — AI reasoning layer)",
            "model": MODEL,
            "total_evaluated": len(enriched_opps),
            "briefings_generated": len(all_briefings),
            "owners_processed": list(all_briefings.keys()),
        },
        "summary": eval_data.get("summary", {}) if isinstance(eval_data, dict) else {},
        "opportunities": enriched_opps,
    }

    with open(AGENT_EVAL_FILE, "w") as f:
        json.dump(agent_output, f, indent=2, default=str)

    print(f"\n  → Agent evaluations: {AGENT_EVAL_FILE}", file=sys.stderr)
    print(f"  → Briefings: {BRIEFINGS_DIR}/", file=sys.stderr)
    print(f"  → Processed: {len(all_briefings)}/{len(by_owner)} owners", file=sys.stderr)
    print(f"  → Assessments merged: {len(all_assessments)} opportunities", file=sys.stderr)
