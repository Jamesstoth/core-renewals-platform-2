import { createClient } from '@/lib/supabase/server'
import Dashboard from '@/components/Dashboard'
import type { Opportunity, LastRefresh } from '@/lib/types'
import {
  fetchPipelineKpis,
  fetchPipelineOpportunities,
  type PipelineKpis,
  type PipelineOpportunity,
} from '@/lib/salesforce-api'

export const dynamic = 'force-dynamic'

export default async function PipelinePage() {
  const supabase = await createClient()

  // Supabase holds the gate-bucketed subset of renewals (populated by the
  // GitHub Actions sync in lib/write_to_supabase.py). That's the right source
  // for the Gates tab — opps flagged by the gate rule engine — but NOT for the
  // Pipeline table, which needs the full active-renewal book so filter counts
  // (Total/Win/Churn/Undetermined) line up with the live KPI cards. We pull
  // that broader list straight from Salesforce.
  const [oppRes, refreshRes, pipelineKpis, pipelineOppsLive] = await Promise.all([
    supabase
      .from('opportunities')
      .select('*')
      .eq('opp_type', 'Renewal')
      .eq('is_closed', false)
      .gt('renewal_date', '2026-01-01')
      .range(0, 4999),
    supabase.from('last_refresh').select('*').eq('id', 1).single(),
    fetchPipelineKpis().catch((e: unknown) => {
      console.error('[pipeline] fetchPipelineKpis failed:', e)
      return null
    }),
    fetchPipelineOpportunities().catch((e: unknown) => {
      console.error('[pipeline] fetchPipelineOpportunities failed:', e)
      return null
    }),
  ])

  const opportunities: Opportunity[] = (oppRes.data as Opportunity[]) ?? []
  const lastRefresh: LastRefresh | null = (refreshRes.data as LastRefresh) ?? null
  const kpis: PipelineKpis | null = pipelineKpis
  const pipelineOpps: PipelineOpportunity[] = pipelineOppsLive ?? []

  return (
    <Dashboard
      opportunities={opportunities}
      pipelineOpps={pipelineOpps}
      lastRefresh={lastRefresh}
      pipelineKpis={kpis}
    />
  )
}
