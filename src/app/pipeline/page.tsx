import { createClient } from '@/lib/supabase/server'
import Dashboard from '@/components/Dashboard'
import type { Opportunity, Activity, LastRefresh } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function PipelinePage() {
  const supabase = await createClient()

  const [oppRes, actRes, refreshRes] = await Promise.all([
    supabase.from('opportunities').select('*'),
    supabase.from('activities').select('*'),
    supabase.from('last_refresh').select('*').eq('id', 1).single(),
  ])

  const opportunities: Opportunity[] = (oppRes.data as Opportunity[]) ?? []
  const activities: Activity[] = (actRes.data as Activity[]) ?? []
  const lastRefresh: LastRefresh | null = (refreshRes.data as LastRefresh) ?? null

  return <Dashboard opportunities={opportunities} activities={activities} lastRefresh={lastRefresh} />
}
