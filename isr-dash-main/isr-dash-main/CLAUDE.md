# Trilogy Renewals Dashboard

Next.js dashboard for Trilogy renewal opportunities. Data lives in Supabase; page is always fresh (SSR, no cache).

**Live URL:** https://isr-secr.vercel.app (Vercel)  
**Repo:** jamesqtrilogy/isr-dash

## Architecture

```
GitHub Actions (refresh.yml)
  → query_sf_mcp.py  ×6 tabs  (SF MCP server, JWT auth)
  → write_to_supabase.py       (upserts to Supabase via REST)

Vercel (Next.js App Router, SSR)
  → page.tsx reads Supabase on every page load
  → /api/refresh  triggers GH Actions workflow_dispatch
  → middleware.ts enforces @trilogy.com Google OAuth
```

## Running Locally

```bash
npm install
cp .env.local.example .env.local   # fill in Supabase + GitHub values
npm run dev
```

To re-query SF locally and write to Supabase:
```bash
SF_MCP_TOKEN=... python3 lib/query_sf_mcp.py data/sf_gate1.json --soql-key gate1_soql --allow-empty
# ... repeat for gate2–4, not_touched, past_due, activities
SUPABASE_URL=... SUPABASE_SERVICE_KEY=... python3 lib/write_to_supabase.py
```

## Key Files

| File | Purpose |
|------|---------|
| `lib/query_sf_mcp.py` | SF query via direct MCP curl (6 per-tab queries) |
| `lib/write_to_supabase.py` | Merges gate files, upserts to Supabase |
| `supabase/schema.sql` | DB schema — run once in Supabase SQL editor |
| `config.json` | SOQL templates (gate1_soql … activities_soql) |
| `.github/workflows/refresh.yml` | Scheduled + on-demand refresh pipeline |
| `src/app/page.tsx` | SSR page — reads Supabase, renders Dashboard |
| `src/components/Dashboard.tsx` | Client component with all interactivity |
| `src/app/api/refresh/route.ts` | POST → triggers GH Actions workflow_dispatch |
| `middleware.ts` | Auth guard — @trilogy.com only |

## Supabase Setup (one-time)

1. Create project at supabase.com
2. Run `supabase/schema.sql` in the SQL editor
3. Enable Google OAuth: Authentication → Providers → Google
4. Add `https://trilogy-renewals-dashboard.vercel.app/auth/callback` as redirect URL
5. Copy URL + anon key for Vercel env vars; copy service_role key for GitHub secret

## Salesforce Data

Per-tab SOQL keys in `config.json`: `gate1_soql`, `gate2_soql`, `gate3_soql`, `gate4_soql`, `not_touched_soql`, `past_due_soql`, `activities_soql`.

Key fields: `Id`, `Name`, `Owner.Name`, `Owner.Email`, `Account.Name`, `StageName`, `ARR__c`, `Current_ARR__c`, `Renewal_Date__c`, `LastActivityDate`, `Next_Follow_Up_Date__c`, `AI_Churn_Risk_Category__c`, `Priority_Score__c`, `High_Value_Opp__c`, `Handled_by_BU__c`, `Gate_3_Violation_Date__c`

## Team (as of 2026-04-02)

ISR: James Quigley, James Stothard, Fredrik Scheike  
SDR/SalesOps: Venus Laney, Alvy Gordo, Najeeha Humayun, Ana Roman  
ERMs: Tim Courtenay, Sebastian Destand  
VPs: David Morris, Tim Courtenay  
SVP: Dmitry Bakaev

## Required Secrets

| Secret | Where | Purpose |
|--------|-------|---------|
| `SF_MCP_TOKEN` | GitHub | JWT for SF MCP server |
| `SUPABASE_URL` | GitHub | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | GitHub | service_role key (bypasses RLS) |
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel | Supabase URL (public) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel | Supabase anon key (public) |
| `GITHUB_TOKEN` | Vercel | Trigger refresh workflow |
| `GITHUB_REPO` | Vercel | `jamesqtrilogy/trilogy-renewals-dashboard` |
