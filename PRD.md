# Product Requirements Document
## Trilogy Renewals Dashboard

**Version:** 1.0
**Date:** April 2, 2026  
**Owner:** James Quigley  
**Status:** Live — v1 deployed

---

## 1. Overview

The Trilogy Renewals Dashboard is an internal web tool that gives the ISR team a real-time view of their renewal pipeline. It pulls data directly from Salesforce, surfaces at-risk and action-required opportunities through a Gate reporting framework, and logs recent call activity — all in a single, always-up-to-date interface accessible to any `@trilogy.com` employee.

**Live URL:** https://trilogy-renewals-dashboard.pages.dev  
**Repo:** jamesqtrilogy/trilogy-renewals-dashboard

---

## 2. Problem

The ISR team manages a high-volume renewal pipeline across multiple reps. Before this dashboard:

- Pipeline visibility required logging into Salesforce and manually running reports
- Gate violations (opps approaching renewal without the right stage progression) were caught late or inconsistently
- No single view existed for managers to see team-wide activity and risk at a glance
- Call activity tracking was siloed in Salesforce with no aggregated summary

This created blind spots in the renewal process, slower response to at-risk accounts, and uneven execution across the team.

---

## 3. Goals

| Goal | Measure |
|------|---------|
| Surface Gate violations before they become missed renewals | All Gate 1–4 opps visible with days-to-renewal |
| Reduce time spent pulling Salesforce reports manually | Dashboard refreshes automatically, no manual SF login needed |
| Give managers a team-wide activity view | Call log and "Not Touched" report visible on one page |
| Accessible to all `@trilogy.com` staff | Google OAuth, no extra accounts needed |

---

## 4. Users

| Role | Names | Primary Use |
|------|-------|-------------|
| ISR (Inside Sales Rep) | James Quigley, James Stothard, Fredrik Scheike | Daily pipeline review, own-rep focus |
| SDR / Sales Ops | Venus Laney, Alvy Gordo, Najeeha Humayun, Ana Roman | Activity tracking, support workflows |
| ERM (Enterprise Renewal Manager) | Tim Courtenay, Sebastian Destand | Cross-rep oversight, escalations |
| VP / SVP | David Morris, Tim Courtenay, Dmitry Bakaev | Executive pipeline health, ARR at risk |

---

## 5. Reports (Gate Framework)

The dashboard is structured around Trilogy's Gate model — a staged accountability system that flags opportunities based on how far they are from renewal and whether the correct sales motion has been completed.

### Gate 1 — 140D No Engagement
**Purpose:** Catch non-HVO opps in early stages (Outreach, Pending) with renewal in the next 140 days that haven't been engaged yet.  
**Filters:** Stage ∈ {Outreach, Pending} · Renewal ≤ 140 days · High Value Opp = False · Product ≠ Contently, Khoros · Not BU-handled  
**Columns:** Opportunity / Account · Owner · ARR · Renewal Date · Stage · Last Activity · Churn Risk · Next Follow-Up

### Gate 2 — 90D Quote Not Sent
**Purpose:** Flag non-HVO opps approaching 90 days without a proposal in flight.  
**Filters:** Stage ∈ {Engaged, Outreach, Pending, Proposal} · Renewal ≤ 89 days · High Value Opp = False · Product ≠ Khoros, BroadVision · Not BU-handled · Type = Renewal  
**Columns:** Opportunity / Account · Owner · ARR · Renewal Date · Stage · Last Activity · Churn Risk · Next Follow-Up

### Gate 3 — 30D Not Finalizing
**Purpose:** Surface opps within 30 days of renewal that haven't reached the Finalizing stage.  
**Filters (Branch A):** Type = Renewal · Stage ≠ Finalizing · Renewal 1–30 days · Not closed · Not BU-handled  
**Filters (Branch B):** Closed within last 8 weeks · Gate 3 Violation Date set · Closed = True  
**Columns:** Opportunity / Account · Owner · ARR · Renewal Date · Days Until · Stage · Win Type · Next Step

### Gate 4 — 0D Not Closed
**Purpose:** Track opps where the renewal date has already passed but the opportunity remains open.  
**Filters:** Renewal Date < today · Not Closed Won / Closed Lost  
**Columns:** Opportunity / Account · Owner · Current ARR · Offer ARR · Renewal Date · Days Late · Stage · Win Type · Next Step

### Not Touched This Week
**Purpose:** Gate 3 opps with no logged activity in the past 7 days — highest urgency.  
**Filters:** Passes Gate 3 filter · Last Activity > 7 days ago (or never)  
**Columns:** Opportunity / Account · Owner · ARR · Close Date · Age · Last Modified · Last Activity · Description

### Past Due
**Purpose:** Non-HVO opps past their renewal date (broader than Gate 4, includes Won't Process).  
**Columns:** Opportunity / Account · Owner · Current ARR · ARR · Close Date · Renewal Date

### Calls — Last 14 Days
**Purpose:** Log of completed renewal-related calls across the team in the past 14 days.  
**Filters:** Completed tasks · Owner = @trilogy.com · Call types: Feedback, Renewal Call, Cancellation, Platinum Upsell, Check-in Call  
**Columns:** Date · Owner · Subject · Call Result · Contact · Opportunity / Account

---

## 6. Data

### Source
Salesforce (Trilogy org) via Anthropic API + remote MCP server (`mcp.csaiautomations.com`).

### Opportunity Query Window
- **Back:** 1 month from today
- **Forward:** 6 months from today
- **Excluded:** Closed Won, Closed Lost, OEM type, Sales Integration owner, Fionn AI owner

### Key Fields
`ARR__c` · `Current_ARR__c` · `Renewal_Date__c` · `StageName` · `AI_Churn_Risk_Category__c` · `Health_Score__c` · `Priority_Score__c` · `High_Value_Opp__c` · `Handled_by_BU__c` · `Gate_3_Violation_Date__c` · `Next_Follow_Up_Date__c` · `LastActivityDate` · `Probable_Outcome__c` · `Churn_Risks__c`

### Activity Query Window
Last 14 days of completed Tasks with qualifying call dispositions and subjects.

---

## 7. Refresh

| Trigger | Schedule / Method |
|---------|-------------------|
| Scheduled | Mon–Fri, 7 AM UTC (3 AM ET) via GitHub Actions |
| On-demand | "↻ Update" button on dashboard → POST `/admin/refresh` → GitHub Actions `workflow_dispatch` |
| Cooldown | 60 seconds between dispatches |

**Refresh pipeline:**
1. Query SF opportunities → `data/sf_latest.json`
2. Query SF activities → `data/sf_activities_latest.json`
3. Validate: fail if either file returns 0 records
4. Build `public/index.html` from JSON
5. Commit and push → Cloudflare auto-deploys

---

## 8. Access & Auth

- **Auth:** Google OAuth 2.0 via Cloudflare Pages Functions
- **Restriction:** `@trilogy.com` email domain only
- **Session:** JWT signed with `JWT_SECRET`, stored in cookie

---

## 9. Architecture

```
Salesforce
    │
    ▼ (Anthropic API + MCP)
lib/query_sf_api.py
    │
    ▼ JSON
lib/build_dashboard.py ──► public/index.html
                                  │
                            GitHub (main)
                                  │
                          Cloudflare Pages
                                  │
                       @trilogy.com users (OAuth)
```

| Component | Technology |
|-----------|------------|
| Data pipeline | Python 3, Anthropic SDK |
| Dashboard | Self-contained HTML/CSS/JS (no framework) |
| Hosting | Cloudflare Pages |
| Auth | Cloudflare Pages Functions + Google OAuth |
| CI/CD | GitHub Actions |
| SF connectivity | Anthropic remote MCP (`mcp.csaiautomations.com`) |

---

## 10. Required Secrets

| Secret | Where | Purpose |
|--------|-------|---------|
| `ANTHROPIC_API_KEY` | GitHub + Cloudflare | SF queries via Anthropic API; enables Update button |
| `SF_MCP_TOKEN` | GitHub | JWT for SF MCP server |
| `GITHUB_TOKEN` | Cloudflare Pages | Trigger refresh workflow |
| `GITHUB_REPO` | Cloudflare Pages | `jamesqtrilogy/trilogy-renewals-dashboard` |
| `GOOGLE_CLIENT_ID` | Cloudflare Pages | OAuth client |
| `GOOGLE_CLIENT_SECRET` | Cloudflare Pages | OAuth client |
| `JWT_SECRET` | Cloudflare Pages | Session signing |

---

## 11. Current Status & Known Gaps

| Item | Status |
|------|--------|
| Dashboard deployed and accessible | ✅ Live |
| Google OAuth (`@trilogy.com`) | ✅ Live |
| Gate 1–4 reports | ✅ Live |
| Not Touched, Past Due, Calls reports | ✅ Live |
| Scheduled refresh (7 AM UTC) | ✅ Live — `ANTHROPIC_API_KEY` added to GitHub Secrets (2026-04-06) |
| On-demand Update button | ✅ Live — `ANTHROPIC_API_KEY` added to Cloudflare env (2026-04-06) |
| High Value Opp (HVO) separate view | 🔲 Not built |
| Per-ERM manager view | 🔲 Not built |
| Gate 3 Branch B (closed with violation) | 🔲 Requires separate closed opp query |
| Mobile layout | 🔲 Not optimised |

---

## 12. Potential V2 Features

- **Per-rep filtered URLs** — shareable links pre-filtered to a single ISR's pipeline
- **HVO dashboard** — separate view for High Value Opportunities with different Gate thresholds
- **Manager view** — ERM/VP-level cross-rep summary with ARR-at-risk roll-up
- **Gate 3 Branch B** — include closed opps with Gate 3 violation dates (requires expanded SOQL)
- **Trend charts** — week-over-week Gate counts and ARR movement
- **Slack alerts** — notify reps when a new Gate violation appears for one of their opps
- **Mobile layout** — responsive design for phone/tablet access
