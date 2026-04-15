import { createClient } from '@/lib/supabase/server'
import Dashboard from '@/components/Dashboard'
import type { Opportunity, LastRefresh } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function PipelinePage() {
  const supabase = await createClient()

  // "Active, valid renewals" per the Trilogy playbook (see lib/build_dashboard.py):
  //   Type = 'Renewal' AND IsClosed = false AND Type != 'OEM'
  // The gate-flag columns (in_gate1..4, in_not_touched, in_past_due) remain on
  // each row so the Gates tab can still bucket these opps downstream.
  // PostgREST caps at 1000 rows by default — bump explicitly so the full
  // active renewal book comes through.
  const [oppRes, refreshRes] = await Promise.all([
    supabase
      .from('opportunities')
      .select('*')
      .eq('opp_type', 'Renewal')
      .eq('is_closed', false)
      .range(0, 4999),
    supabase.from('last_refresh').select('*').eq('id', 1).single(),
  ])

  const opportunities: Opportunity[] = (oppRes.data as Opportunity[]) ?? []
  const lastRefresh: LastRefresh | null = (refreshRes.data as LastRefresh) ?? null

  return <Dashboard opportunities={opportunities} lastRefresh={lastRefresh} />
}
