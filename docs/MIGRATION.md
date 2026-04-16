# Phase 1: Gate Evaluator — Migration Guide

**Purpose:** Replay these changes against any clean copy of the `core-renewals-platform` repo.
**Source branch:** `experiment/cloudflare`
**Date:** 2026-04-15
**Author:** AI Renewal Platform (James Quigley)

---

## Prerequisites

- Python 3.11+
- Existing data pipeline producing `data/sf_latest.json`, `data/sf_activities_latest.json`
- Existing gate SOQL queries producing `data/sf_gate*.json` (optional — evaluator can work from `sf_latest.json` alone)

---

## Files Added

| File | Purpose |
|------|---------|
| `config/gate_rules.json` | 7-gate framework definition: time windows, required fields, stage mappings, violation thresholds, scenario routing |
| `lib/evaluate_gates.py` | Deterministic gate evaluator. Reads SF JSON data, evaluates every open opportunity against the gate framework, outputs `data/gate_evaluations.json` |
| `docs/MIGRATION.md` | This file |

## Files Modified

| File | Change |
|------|--------|
| `.github/workflows/refresh.yml` | Added `Evaluate Gates` step after SF queries, before Supabase write |

## Files NOT Modified

- `config.json` — existing SOQL queries untouched
- `lib/query_sf_direct.py` — data pull logic unchanged
- `lib/write_to_supabase.py` — Supabase sync unchanged
- `lib/build_dashboard.py` — dashboard build unchanged
- All `src/`, `functions/`, `public/` — application code unchanged

---

## Change Log

### 1. `config/gate_rules.json` (NEW)

Defines the 7-gate framework as a structured JSON config. Each gate specifies:
- `time_trigger_days`: days before renewal date when the gate window opens/closes
- `required_stages`: SF stages that indicate the gate has been passed
- `required_fields`: SF fields that must be populated for the gate to pass
- `violation_conditions`: logic for when a gate is considered violated
- `scenario_routing`: which of the 10 closing scenarios apply at this gate

The gate model replaces the existing SOQL-filter-based approach (gate1_soql through gate4_soql) with a unified state machine evaluation. The existing SOQL queries continue to run for backward compatibility with the dashboard, but the evaluator derives gate status from field state rather than from which SOQL filter an opp matches.

### 2. `lib/evaluate_gates.py` (NEW)

Reads:
- `data/sf_latest.json` (primary — all open opps)
- `data/sf_activities_latest.json` (activity signals)
- `config/gate_rules.json` (gate definitions)

Outputs:
- `data/gate_evaluations.json` — one entry per opportunity with:
  - Current gate position (0-6)
  - Pass/fail/violation status per gate
  - Days until next gate deadline
  - Recommended actions
  - Predicted scenario (1-10)
  - Risk flags

Key design decisions:
- **Read-only**: zero Salesforce writes. All output goes to JSON.
- **Idempotent**: same input data always produces same output.
- **Framework-first**: implements the 7-gate model from the discussion document, not the existing 4-gate SOQL filters.
- **Graceful degradation**: missing fields produce warnings, not crashes.

### 3. `.github/workflows/refresh.yml` (MODIFIED)

Added one step after all SF queries complete:

```yaml
- name: Evaluate Gates
  run: |
    echo "Running gate evaluation..."
    python3 lib/evaluate_gates.py
```

Placed after the last SF query step and before the "Write to Supabase" step.

---

## Replay Instructions

1. Copy `config/gate_rules.json` to `config/`
2. Copy `lib/evaluate_gates.py` to `lib/`
3. Copy `docs/MIGRATION.md` to `docs/`
4. Add the "Evaluate Gates" step to `.github/workflows/refresh.yml` (see diff above)
5. Run: `python3 lib/evaluate_gates.py` — should produce `data/gate_evaluations.json`
6. Verify: `python3 -c "import json; d=json.load(open('data/gate_evaluations.json')); print(f'{len(d[\"opportunities\"])} opportunities evaluated')"`

---

## Phase 1b: Dashboard Integration (2026-04-15)

### Files Modified

| File | Change |
|------|--------|
| `lib/build_dashboard.py` | Added gate evaluation tab, KPI card, summary card, table builder, risk-level filtering |

### Changes to `lib/build_dashboard.py`

**Data loading** (after activities loading):
- Loads `data/gate_evaluations.json` into `gate_eval_data`
- Extracts summary stats (`ge_summary`, `ge_risk`, `ge_violations`, `ge_arr_at_risk`)

**New tab definition:**
- `gate_eval` tab added as first tab in `TABS` list
- Tab data populated from `gate_eval_data["opportunities"]` (filtered to open opps only)
- Uses `build_table_gate_eval()` table builder with columns: Opportunity/Account, Owner, ARR, Renewal, Gate, Risk, Violations, Scenario, Next Action

**New visual elements:**
- Gate eval KPI card (purple, shows violation count + critical/high breakdown + ARR at risk)
- Full-width summary card in gate grid (gate distribution pills, risk breakdown, per-owner violation table)
- Risk-level dropdown filter (replaces Stage filter for this tab, uses `data-risk` attribute)

**Helper functions added:**
- `risk_badge()` — colored badge for risk level
- `gate_position_badge()` — colored badge for current gate position (G0-G6)
- `violation_pills()` — red pills showing which specific gates are violated
- `scenario_cell()` — scenario number with confidence dot
- `action_cell()` — truncated recommended action with tooltip

**JavaScript update:**
- `filterTabTable()` updated to read `data-filter-attr` from the stage select element, supporting `data-risk` filtering for the gate eval tab while maintaining backward compatibility with `data-stage` for all other tabs

### Replay for dashboard changes

Apply the diff to `lib/build_dashboard.py`. The changes are:
1. Gate evaluations data loading block (after line ~49)
2. `gate_eval` added to `TABS` list (first position)
3. `gate_eval` branch in `tab_opps` population loop
4. `build_table_gate_eval()` function and helpers (before `TABLE_BUILDERS`)
5. `gate_eval` added to `TABLE_BUILDERS`, `TAB_COLORS`
6. `gate_eval_kpi` card prepended to `kpi_html`
7. `gate_eval_card_html` prepended to `gate_cards_html`
8. `render_tab_section()` updated with `is_gate_eval` branch
9. `filterTabTable()` JS updated for `data-filter-attr` support
