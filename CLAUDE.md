# Core Renewals Platform

## Vision

An AI-powered platform that automates everything in the core renewals process except renewal calls — which require human judgement, relationship building, and consultative selling.

The platform serves the ISR (Inside Sales Rep) team executing Trilogy/ESW's renewal motion. The renewals business model is: acquire software companies, enforce standardised 25/35/45% price increases, retain customers through value (not discounting), and run at 75% EBITDA. Every renewal is either handled by AI/self-serve (transactional, <$100K) or by human ERMs with AI backend support (enterprise, >$100K).

The platform should automate:
- **Renewal preparation**: opp prep, contact validation, contract summary, quote config — everything the SDR does in the first 30 days of the 210-day cadence
- **Call objectives**: AI-generated briefings before every call, informed by deal history, support tickets, account health, churn risk signals, and the MEDDPICCS framework
- **Follow-up emails**: contextual drafts for every scenario — post-call follow-ups, quote chasers, AR warnings, objection responses, extension requests, escalations
- **Churn prediction**: based on engagement patterns, support ticket sentiment, product stickiness, usage trends, pricing signal analysis, and the ~20 standardised churn risk categories
- **Pipeline health monitoring**: Gate framework violations surfaced automatically (Gate 1: 140D no engagement, Gate 2: 90D quote not sent, Gate 3: 30D not finalising, Gate 4: 0D not closed)
- **Support ticket cross-referencing**: Kayako ticket history alongside renewal data so reps know about product issues before calls
- **Salesforce write-back**: auto-updating Description and NextStep fields based on email/call activity
- **Follow-up scheduling**: automated reminders aligned to the renewal cadence
- **Objection handling intelligence**: surfacing approved strategies (free seats, payment terms, Prime/Unlimited, multi-year lock) based on the customer's specific objection pattern

The rep's role becomes the high-value human interactions: renewal calls, relationship building, complex negotiations, cancellation insight calls. The platform handles everything around those calls.

## Business Rules (Critical — AI features must respect these)

- **25/35/45 pricing is non-negotiable.** 25% standard, 35% gold, 45% platinum. Zero rep discretion. Zero exceptions.
- **Never negotiate on price.** But let customers "win" with non-price concessions: free seats, modules, payment terms, Prime/Unlimited access, multi-year price lock.
- **Standard terms only:** 1, 3, or 5 years. Nothing shorter or longer.
- **No seat/license reductions.** Requesting reduction triggers repricing to full list.
- **No contract redlining under $100K TCV.** Accept losing sub-$100K customers who refuse standard paper.
- **Auto-renewal enforces engagement.** AR quote = list price + 50% penalty. Offer quote = discounted. Customer engagement is rewarded.
- **Approved pricing strategies only:** Standard 25/35/45, Flat 4 (maintenance, credible churn, 4yr), 1st Year Flat/Ramp, Free/Unlimited Seats (3-5yr HVO), Multiyear Platinum Reduced (35%, >$1M ARR, 3-5yr).
- **Value-based communication reduces churn by 40%** vs cost-based justifications. All AI-generated content must lead with value/ROI, never apologise for pricing.

## Current State

The platform merges two previously separate tools:

**Dashboard** (James Quigley): Pipeline view with Gate framework violations (Gate 1-4), ARR at risk, team-wide filtering, charts. Reads from Supabase, populated by GitHub Actions syncing from Salesforce. Lives at /pipeline.

**Opportunity Detail Pages** (James Stothard): AI-powered detail view when clicking into a deal — AI deal summary, call objectives, 7 email draft types, activity history, AI chat. Lives at /opportunity/[id].

**Live:** https://core-renewals-platform.vercel.app
**Repo:** https://github.com/Jamesstoth/core-renewals-platform

## Tech Stack

- Next.js 15 (App Router) + React 19 + TypeScript
- Supabase (project: zligncbwriqjiplrgsvv) — read layer for dashboard
- Direct Salesforce API via jsforce — live data for opportunity detail pages
- Anthropic API (Claude) — AI features
- OpenAI API — AI generation
- Tailwind CSS
- Vercel — hosting
- GitHub Actions — scheduled SF -> Supabase sync

## Key Directories

- src/app/pipeline/ — dashboard page (SSR, reads Supabase)
- src/app/opportunity/[id]/ — opportunity detail page with AI features
- src/app/api/generate/ — AI draft generation endpoint
- src/app/api/opportunities/ — opportunities API (reads Supabase)
- src/app/api/opportunity-activities/ — activity history from Salesforce
- src/app/api/sf-test/ — Salesforce API connection test
- src/components/Dashboard.tsx — main dashboard with Gate tables and charts
- src/lib/salesforce-api.ts — direct Salesforce API (jsforce, OAuth2)
- src/lib/rules-engine.ts — queue status and flag logic
- lib/ (root) — Python scripts for GitHub Actions sync pipeline
- supabase/schema.sql — database schema

## Architecture

- Auth bypassed for now (middleware.ts is no-op)
- Dashboard reads Supabase for speed (291 opps in <1s)
- Opportunity detail pages fetch live from Salesforce
- MCP replaced with direct jsforce API calls
- AI uses Anthropic and OpenAI APIs directly
- GitHub Actions populates Supabase via Python + MCP

## Environment Variables

Vercel/.env.local:
- NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY — Supabase
- SF_CLIENT_ID, SF_CLIENT_SECRET, SF_USERNAME, SF_PASSWORD, SF_SECURITY_TOKEN — Salesforce direct API
- ANTHROPIC_API_KEY — AI features
- OPENAI_API_KEY — AI generation
- SALESFORCE_MCP_TOKEN — legacy activity fetching (being replaced)

GitHub Actions:
- SF_MCP_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_KEY — scheduled sync

## Team

ISR: James Quigley, James Stothard, Fredrik Scheike
SDR/SalesOps: Venus Laney, Alvy Gordo, Najeeha Humayun, Ana Roman
ERMs: Tim Courtenay, Sebastian Destand
VPs: David Morris, Tim Courtenay
SVP: Dmitry Bakaev

## Roadmap

1. Direct Salesforce API replacing all MCP-based fetching
2. Kayako support ticket integration on opportunity pages
3. Dashboard rendering from Supabase (schema reconciliation)
4. Write-back to Salesforce (Description, NextStep)
5. Re-enable Google OAuth
6. Automated follow-up scheduling
7. Churn prediction model using the ~20 standardised risk categories
8. AI-generated renewal prep packages
9. Integration with auto-renewal enforcement workflow
