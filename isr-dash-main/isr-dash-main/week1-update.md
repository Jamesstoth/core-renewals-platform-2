# Trilogy Renewals Dashboard — Week 1 Update

**Project:** Self-contained renewal opportunity tracker for the Trilogy ISR team
**Live URL:** https://trilogy-renewals-dashboard.pages.dev
**Repo:** jamesqtrilogy/trilogy-renewals-dashboard

---

## What Have I Done?

Built and shipped a full-stack internal dashboard from scratch in ~2 days (Apr 1–2, 2026). Key deliverables:

**Dashboard (8 commits, ~1,000 lines of Python + JS)**

- `lib/build_dashboard.py` (871 lines) — reads Salesforce opportunity + activity JSON and generates a self-contained, single-file HTML dashboard with 6 tabbed report views: pipeline overview, by-rep breakdowns, churn risk, renewal calendar, activity log, and high-value opps
- Covers all 3 ISRs (James Q, James S, Fredrik) with per-rep filters and ARR aggregation
- Pulls 14 fields of opportunity data (ARR, renewal date, churn risk, health score, priority, etc.) and 5 activity call types from the last 14 days

**Data pipeline**

- `lib/query_sf_api.py` — queries Salesforce via Anthropic API + remote MCP server; retries on timeout/empty result; writes `data/sf_latest.json` and `data/sf_activities_latest.json`
- `config.json` — SOQL templates with a configurable date window (1 month back, 6 months forward for opps; last 14 days for activities)

**Infrastructure**

- Hosted on **Cloudflare Pages**, auto-deploys from `main` branch
- **Google OAuth** restricted to `@trilogy.com` accounts via `functions/auth/`
- **GitHub Actions** (`refresh.yml`) runs Mon–Fri at 7 AM UTC and on-demand via an "Update" button on the dashboard
- Refresh flow: query SF → validate output (guards against empty result) → rebuild HTML → commit + push → Cloudflare auto-deploys

**Iteration log** (what was fixed along the way):

| Commit | Problem | Fix |
|--------|---------|-----|
| `5e66b18` | Activities SOQL returning wrong data | Rewrote filters to match the actual SF report (LAST_N_DAYS:14, LIKE on subject) |
| `382cdc2` | Needed a direct MCP client fallback | Added `query_sf_mcp.py` — raw HTTP SSE client |
| `87cc442` | SSE stream hanging indefinitely | Fixed to read line-by-line instead of buffering |
| `ec11c22` | Switched back to Anthropic SDK approach | More reliable than raw MCP HTTP; `query_sf_api.py` is now canonical |
| `f4fd6a9` | Dep install failures in CI + refresh button | Hardened `pip install` version pinning and Cloudflare Function error handling |

---

## Where Is the Project Going?

The dashboard is functional and deployed. The next phase is about **data quality and usability**:

- The SOQL date window, field selection, and activity filters are all configurable in `config.json` — easy to tune as the team uses it and identifies gaps
- The checkpoint files (`build_dashboard_checkpoint_v1.py`, `_v2.py`) exist as rollback points while the builder is still being iterated on
- The auth layer is in place; the team can now access it without any extra setup

---

## What Are the Next Steps?

1. **Team rollout** — share the live URL with the ISR team (James S, Fredrik) and SDR/SalesOps (Venus, Alvy, Najeeha, Ana); confirm all `@trilogy.com` logins work
2. **SOQL tuning** — add `Gate_3_Violation_Date__c` alerting to the dashboard if Gate 3 violations need surfacing; confirm activity call type filters match what reps actually log
3. **Dashboard polish** — sort/filter interactions on the opportunity table; potential per-ERM view (Tim, Sebastian) for manager-level review
4. **Monitoring** — verify the scheduled 7 AM UTC refresh is landing correctly and that the auto-commit shows up in the repo each weekday
5. **Cleanup** — remove checkpoint files and the multiple `query_sf_*.py` variants once `query_sf_api.py` is confirmed stable in CI
