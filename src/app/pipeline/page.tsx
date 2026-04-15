import { createClient } from '@/lib/supabase/server'
import Dashboard from '@/components/Dashboard'
import type { Opportunity, LastRefresh } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function PipelinePage() {
  const supabase = await createClient()

  // Only fetch opportunities that are currently in one of the 6 gate buckets.
  // Without this filter PostgREST's default 1000-row cap pulls in hundreds of
  // stale historical "Sales Integration" records and crowds out the live ISR
  // set — the dashboard ends up looking empty.
  const [oppRes, refreshRes] = await Promise.all([
    supabase
      .from('opportunities')
      .select('*')
      .or(
        'in_gate1.eq.true,in_gate2.eq.true,in_gate3.eq.true,in_gate4.eq.true,in_not_touched.eq.true,in_past_due.eq.true',
      ),
    supabase.from('last_refresh').select('*').eq('id', 1).single(),
  ])

  const opportunities: Opportunity[] = (oppRes.data as Opportunity[]) ?? []
  const lastRefresh: LastRefresh | null = (refreshRes.data as LastRefresh) ?? null

  return <Dashboard opportunities={opportunities} lastRefresh={lastRefresh} />
}
