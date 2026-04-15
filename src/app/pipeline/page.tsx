import Dashboard from '@/components/Dashboard'
import { fetchPipelineFromSalesforce } from '@/lib/salesforce-api'
import type { LastRefresh } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function PipelinePage() {
  const { opportunities, activities } = await fetchPipelineFromSalesforce()

  const lastRefresh: LastRefresh = {
    refreshed_at: new Date().toISOString(),
    opp_count: opportunities.length,
    activity_count: activities.length,
  }

  return <Dashboard opportunities={opportunities} activities={activities} lastRefresh={lastRefresh} />
}
