# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Internal renewals follow-up portal for a SaaS renewals team. Reads Salesforce opportunity and activity data, applies a rules engine to identify opportunities needing post-renewal-call follow-up, and surfaces them in a prioritized queue for rep review. **No outbound action is taken automatically — human approval is required for everything** (email sends, call task creation, etc.).

## Tech Stack

- **Framework:** Next.js 14 (App Router) with TypeScript
- **Styling:** Tailwind CSS
- **Database:** Supabase (queue state, snooze/blocker/dismissal records, audit log)
- **CRM:** Salesforce via MCP server (remote, pre-authenticated)
- **AI:** Anthropic API for generating email drafts and call objectives
- **Deployment:** Vercel
- **Repo:** github.com/Jamesstoth/renewals-portal-stage1

## Common Commands

```bash
npm run dev          # Start dev server (localhost:3000)
npm run build        # Production build
npm run lint         # ESLint
npm run type-check   # tsc --noEmit
npm test             # Run test suite
npm test -- --watch  # Watch mode
npm test -- path/to/file.test.ts  # Single test file
```

## Architecture

### Data Flow

```
Salesforce (MCP) → Rules Engine → Follow-up Queue (Supabase) → Rep UI → Approved Actions → Salesforce (MCP)
                                                                      → Email Draft (Anthropic API) → Rep Approval → Send
```

### Key Layers

1. **Salesforce sync** — Server-side functions query Salesforce via MCP tools to pull opportunity and activity history data. This is read-heavy; writes only happen on rep-approved actions.
2. **Rules engine** — Evaluates each opportunity against follow-up cadence rules (see below) to determine if/when follow-up is needed and what type.
3. **Queue** — Supabase tables store queue state: which opportunities are surfaced, their status (pending/snoozed/blocked/dismissed/actioned), and the audit trail.
4. **Rep UI** — Next.js App Router pages. Reps see a prioritized queue and can: approve email drafts, create call tasks, snooze, log blockers, or dismiss.
5. **AI generation** — Anthropic API generates contextual email drafts and call objective summaries from opportunity data. These are always presented as drafts for rep editing/approval.

### Salesforce MCP Tools

The Salesforce MCP server is remote and pre-authenticated. Available tools:

| Tool | Usage |
|---|---|
| `sf_query` | SOQL queries for opportunities, activities, contacts |
| `sf_get_record` | Fetch a single record by ID |
| `sf_update_record` | Write back approved actions (tasks, activity logs) |
| `sf_track_activity` | Log follow-up activities against opportunities |
| `sf_describe_object` | Inspect object schemas (Opportunity, Task, Activity, etc.) |

When calling these tools, use the `mcp__salesforce__` prefix (e.g., `mcp__salesforce__sf_query`).

### Key Salesforce Field Names

**Opportunity object:**

| Field API Name | Purpose |
|---|---|
| `Renewal_Date__c` | Custom renewal date (use instead of `CloseDate` for cadence timing) |
| `Type` | Picklist — use `Type = 'Renewal'` to filter renewal opportunities (not `SBQQ__Renewal__c`) |
| `SBQQ__Renewal__c` | Boolean — CPQ renewal flag (exists but is `false` in this org; do not use for filtering) |
| `IsClosed` / `IsWon` | Terminal state detection |
| `LastActivityDate` | Standard field — last activity logged |
| `Next_Follow_Up_Date__c` | Custom field — scheduled next follow-up |
| `ARR__c` / `ARR_in_USD__c` / `Current_ARR__c` | Revenue fields (prefer `ARR_in_USD__c` for consistency) |
| `Health_Score__c` | Account health percentage |
| `AI_Churn_Risk_Category__c` | AI-assigned churn risk bucket |
| `Priority_Score__c` | Priority percentage for queue ranking |
| `Account.Name` / `Owner.Name` | Accessed via relationship in SOQL |

**Task object:**

| Field API Name | Purpose |
|---|---|
| `Is_Renewal_Call__c` | Boolean — **entry criteria trigger**, identifies renewal calls |
| `Work_Unit_Type__c` | Picklist — distinguishes Renewal Call, Follow-Up Call, etc. |
| `CompletedDateTime` | When the task was completed (more precise than `ActivityDate`) |
| `Type` | `Call`, `Email`, `Meeting`, `Administrative`, `Other` |
| `TaskSubtype` | System field: `Task`, `Email`, `ListEmail`, `Cadence`, `Call`, `LinkedIn` |
| `CallType` | `Internal`, `Inbound`, `Outbound` (only for calls) |
| `WhatId` | Links task to an Opportunity |
| `Status` | `Open` or `Completed` |

### Supabase Tables (core)

- **follow_up_queue** — Opportunities surfaced for rep action, with status and priority
- **queue_actions** — Audit log of every rep action (approve, snooze, dismiss, block)
- **email_drafts** — AI-generated drafts linked to queue items, with edit history
- **blockers** — Rep-logged blockers with notes and resolution status

## Follow-Up Cadence Rules

### Entry Criteria

Any opportunity where a renewal call has been logged in Salesforce activity history is eligible, regardless of ARR or segment.

### Cadence

Follow-up happens **weekly (every 7 days)** after the renewal call, via call or email, until the opportunity reaches a terminal state.

### Status Classification

The rules engine assigns one of these queue statuses based on activity history and opportunity state:

| Status | Condition |
|---|---|
| **Overdue follow-up** | >14 days since renewal call or last follow-up with no contact |
| **Needs follow-up this week** | 7–14 days since last follow-up |
| **Recently contacted** | Follow-up completed within the last 7 days |
| **Waiting on customer** | Rep set explicit waiting state: customer |
| **Waiting on internal action** | Rep set explicit waiting state: legal, finance, or internal team |
| **No action needed** | Opportunity is Closed Won or Closed Lost |
| **Needs rep review** | Ambiguous state that doesn't cleanly match other statuses — surface for manual triage |

### Exclusion Rules (Do Not Flag)

An opportunity is **not** flagged for follow-up if any of these are true:

1. Opportunity stage is Closed Won or Closed Lost
2. A follow-up was completed within the last 7 days
3. Rep has manually snoozed with a reason and future review date
4. Opportunity is in an explicit waiting state (waiting on customer, waiting on legal, waiting on finance, waiting on internal team)
5. Next step is owned by another internal team

### Snooze

Reps can snooze a queue item with a required reason. Available durations:

- 7 days
- 14 days
- 30 days
- Custom date

Snoozed items re-enter the queue on the review date and are re-evaluated by the rules engine.

### Terminal States

An opportunity exits the queue when it reaches Closed Won or Closed Lost.

## Coding Standards

### TypeScript

- Strict mode enabled. No `any` types — use proper typing or `unknown` with type guards.
- Shared types live in `types/` at the project root. Salesforce record shapes, queue item types, and API response types should all be defined there.
- Use Zod for runtime validation at system boundaries (API routes, Salesforce responses, form submissions).

### Next.js Conventions

- App Router only (no `pages/` directory).
- Server Components by default. Add `'use client'` only when the component needs browser APIs, event handlers, or React state.
- API routes in `app/api/` handle mutations. Use Server Actions where appropriate.
- All Salesforce MCP calls and Anthropic API calls happen server-side only — never expose credentials or raw CRM data to the client.

### Salesforce Integration

- SOQL queries should request only the fields needed — no `SELECT *` equivalent.
- Always handle the case where Salesforce returns no records or the MCP call fails.
- Cache Salesforce describe results (object schemas rarely change).

### Anthropic API

- Use the `@anthropic-ai/sdk` package.
- Email drafts and call objectives must always be presented as editable drafts, never sent automatically.
- Include opportunity context (account name, ARR, renewal details, recent activity) in prompts for relevant generation.

### UI/UX

- Tailwind only — no CSS modules or styled-components.
- Responsive is not a priority (internal desktop tool), but the queue view should be usable at 1280px+.
- Every destructive or outbound action requires explicit confirmation UI.

### Error Handling

- Salesforce MCP failures should surface user-friendly messages in the UI, not raw errors.
- Queue operations should be idempotent where possible (e.g., approving an already-approved item is a no-op, not an error).
