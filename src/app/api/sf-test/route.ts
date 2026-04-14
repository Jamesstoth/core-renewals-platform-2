import { NextResponse } from 'next/server'
import { querySalesforce } from '@/lib/salesforce-api'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const records = await querySalesforce(
      'SELECT Id, Name FROM Opportunity LIMIT 5'
    )
    return NextResponse.json({ ok: true, count: records.length, records })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[sf-test] Error:', message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
