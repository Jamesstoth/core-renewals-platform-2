import { createClient } from '@/lib/supabase/server'
import Dashboard from '@/components/Dashboard'
import type { Opportunity, LastRefresh } from '@/lib/types'
import { fetchPipelineKpis, type PipelineKpis } from '@/lib/salesforce-api'

export const dynamic = 'force-dynamic'

export default async function PipelinePage() {
  const supabase = await createClient()

  // Supabase holds the gate-bucketed subset of renewals (populated by the
  // GitHub Actions sync in lib/write_to_supabase.py). That's still the right
  // source for the Gates tab + the Pipeline table (opps needing attention),
  // but it's NOT the full active-renewal book — so we query Salesforce live
  // for the true KPI totals shown on the Pipeline cards.
  const [oppRes, refreshRes, pipelineKpis] = await Promise.all([
    supabase
      .from('opportunities')
      .select('*')
      .eq('opp_type', 'Renewal')
      .eq('is_closed', false)
      .range(0, 4999),
    supabase.from('last_refresh').select('*').eq('id', 1).single(),
    fetchPipelineKpis().catch((e: unknown) => {
      console.error('[pipeline] fetchPipelineKpis failed:', e)
      return null
    }),
  ])

  const opportunities: Opportunity[] = (oppRes.data as Opportunity[]) ?? []
  const lastRefresh: LastRefresh | null = (refreshRes.data as LastRefresh) ?? null
  const kpis: PipelineKpis | null = pipelineKpis

  return <Dashboard opportunities={opportunities} lastRefresh={lastRefresh} pipelineKpis={kpis} />
}
