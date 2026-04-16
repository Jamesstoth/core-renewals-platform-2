# Core Renewals Platform — Project Checkpoints

## Checkpoint 1 — Project foundation
**Date:** ~March 2026
**Repo:** `jamesqtrilogy/trilogy-renewals-dashboard`

Original static renewals dashboard established.

- Self-contained HTML dashboard deployed on Cloudflare Pages
- Google OAuth restricted to `@trilogy.com`
- SF data pulled via Anthropic API + remote MCP (`query_sf_api.py`)
- GitHub Actions cron refresh (Mon-Fri 7am UTC) + manual trigger
- 4-gate SOQL reporting: Gate 1 (140D no engagement), Gate 2 (90D quote not sent), Gate 3 (30D not finalising), Gate 4 (0D not closed)
- Additional views: Not Touched This Week, Past Due, Calls (last 14 days)
- Data committed as JSON: `sf_latest.json`, `sf_activities_latest.json`

---

## Checkpoint 2 — Core Renewals Platform merge
**Date:** ~Early April 2026
**Repo:** `jamesqtrilogy/core-renewals-platform`
**Branch:** `experiment/cloudflare`

Two previously separate projects merged into a unified platform.

**Dashboard (James Quigley):** Pipeline view with Gate framework violations, ARR at risk, team-wide filtering, charts. Reads from Supabase.

**Opportunity Detail Pages (James Stothard):** AI-powered detail view — AI deal summary, call objectives, 7 email draft types, activity history, AI chat.

Key changes from Checkpoint 1:
- Next.js 15 app with React 19 + TypeScript
- Supabase (project: zligncbwriqjiplrgsvv) as read layer for dashboard
- Direct Salesforce API via jsforce replacing MCP for opportunity detail pages
- `query_sf_direct.py` replacing `query_sf_api.py` for pipeline queries (Username-Password OAuth)
- `write_to_supabase.py` added to pipeline
- AI features via Anthropic + OpenAI APIs
- Gate-specific SOQL queries in `config.json` (`gate1_soql` through `gate4_soql`, `not_touched_soql`, `past_due_soql`)
- Gate-specific data files: `sf_gate1.json` through `sf_gate4.json`
- `Gate_3_Violation_Date__c` and `Gate_4_Violation_Date__c` SF fields in use
- Live at: `core-renewals-platform.vercel.app`

---

## Checkpoint 3 — Phase 1: 7-Gate evaluation framework
**Date:** April 15, 2026
**Branch:** `experiment/cloudflare`
**Commit:** `723c344` (+ YAML fix at `723c344`)

New 7-gate evaluation framework running in production. Deterministic, read-only.

**Files added:**
- `lib/evaluate_gates.py` — Gate evaluator (432 lines). Evaluates all open opps against Gates 0-6, detects risk signals, predicts closing scenarios (1-10), generates recommended actions.
- `config/gate_rules.json` — 7-gate framework definitions: time windows, required fields, violation thresholds, scenario routing, risk signal patterns.
- `docs/MIGRATION.md` — Replay guide for applying changes to a vanilla repo.
- `data/gate_evaluations.json` — Auto-generated evaluation output.

**Files modified:**
- `.github/workflows/refresh.yml` — Added "Evaluate Gates" step + gate evaluation summary in workflow output.

**7-gate model (new, overrides existing 4-gate SOQL approach):**
- Gate 0: Data readiness (T-180 to T-120)
- Gate 1: Outreach activation (T-120 to T-90)
- Gate 2: Discovery & needs assessment (T-90 to T-60, aligns with AR notice deadline)
- Gate 3: Proposal & pricing (T-60 to T-30, AR auto-invoice at T-30)
- Gate 4: Negotiation & follow-up (T-30 to T-7)
- Gate 5: Close execution (T-7 to T+0)
- Gate 6: Post-close QC & feedback (T+0 to T+30)

**Test results against live data:**
- 267 opportunities evaluated
- 83 gate violations detected
- $24.2M ARR at risk
- Risk: 61 critical, 130 high, 21 medium, 55 low

**Constraints:**
- Zero Salesforce writes (read-only evaluation mode)
- All output to `data/gate_evaluations.json`
- Existing 4-gate SOQL queries continue to run for backward compatibility

---

## Checkpoint 4 — Phase 1b: Dashboard gate evaluation view
**Date:** April 15, 2026
**Branch:** `experiment/cloudflare`
**Commit:** `2bd74b6`
**GitHub Actions:** Refresh #24 passed successfully

Gate evaluation data surfaced visually on the dashboard.

**Files modified:**
- `lib/build_dashboard.py` — Added gate evaluation tab, KPI card, summary card, table builder, risk-level filtering.
- `docs/MIGRATION.md` — Appended Phase 1b changes.

**New dashboard elements:**
- Purple "Violations" KPI card (first in top row) — violation count, critical/high breakdown, ARR at risk
- Full-width summary card above gate grid — gate distribution pills, risk breakdown, per-owner violation table
- "Gate Evaluation" tab with 9-column table: Opportunity/Account, Owner, ARR, Renewal, Gate (coloured badge G0-G6), Risk (coloured badge), Violations (red pills per violated gate), Scenario (predicted #1-10), Next Action
- Risk-level dropdown filter (replaces Stage filter for this tab)
- Stat pills showing violation count and critical/high counts

**Helper functions added:**
- `risk_badge()`, `gate_position_badge()`, `violation_pills()`, `scenario_cell()`, `action_cell()`
- `build_table_gate_eval()` table builder
- `filterTabTable()` JS updated for `data-filter-attr` support

---

## Produced but not deployed as code

**Renewal Gate & Trigger Framework — Discussion Document (.docx)**
- 7 gates with time triggers, activity triggers, required tasks, violation conditions
- RACI matrix across all gates
- Critical timeline table (T-180 through T+30)
- Closing scenarios cross-reference (all 10 scenarios mapped to gates)
- Implementation considerations (SF automation, AI platform integration)
- 5 open questions for team discussion
- Source: 17 playbook documents from Core Renewals NotebookLM

**10 Closing Scenario Process Flows (interactive steppers)**
- Scenario #1: Standard on-time renewal (all gates pass)
- Scenario #2: Standard on-time cancellation (gate 2 redirects to cancellation track)
- Scenario #3: Customer delay with commitment (extension form signed)
- Scenario #4: Customer delay without commitment (closed-lost)
- Scenario #5: Internal delay (2-week extension, internal escalation)
- Scenario #6: Late signature with AR (AR executed at T-7, override possible)
- Scenario #7: Unresponsive with AR (AR auto-executed)
- Scenario #8: Late cancellation with AR (AR binding, cancellation denied)
- Scenario #9: Unresponsive without AR (T-5 warning, closed-lost at T+0)
- Scenario #10: Bankruptcy / legal hold (suspended, Finance/Legal directed)
- Each scenario: full gate-by-gate journey with pass/fail/violation status, SF field states, decision points, and recommended actions

**Architecture Recommendation**
- Option B recommended: Claude Managed Agents + Option A (deterministic evaluator) as fallback
- 4-phase implementation roadmap: (1) Deterministic evaluator ✓, (2) Managed Agent core, (3) Intelligence layer, (4) Autonomous gate progression
- Read-only constraint acknowledged — SF writes deferred to future phase

---

## Next: Phase 2 — Claude Managed Agent
**Status:** Not started
**Prerequisite:** Team confidence in Phase 1 evaluation accuracy

Phase 2 adds an AI reasoning layer on top of the deterministic evaluator:
- Register agent via Anthropic Managed Agents API (`/v1/agents`)
- System prompt: 7-gate framework + 17 playbooks + team roster + scenario decision trees
- Agent evaluates each opp with reasoning (not just field checks)
- Cross-opportunity pattern detection
- Activity sentiment analysis (churn language detection from emails/notes)
- Scenario pre-routing with confidence levels
- Draft communication generation for ISR review queue
- All output to JSON — no SF writes until explicitly enabled
