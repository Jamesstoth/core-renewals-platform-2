/**
 * GET /api/opportunity-activities?id=006...
 *
 * Fetches activity history (Tasks + Events) for a single opportunity
 * directly from the Salesforce REST API. Called on-demand when a rep
 * opens an opportunity detail page.
 */

import { NextRequest, NextResponse } from 'next/server'
import { querySalesforce } from '@/lib/salesforce-api'

export const dynamic = 'force-dynamic'

interface SfTask extends Record<string, unknown> {
  Id: string
  Subject: string | null
  ActivityDate: string | null
  CreatedDate: string | null
  Status: string | null
  Description: string | null
  Type: string | null
  Owner: { Name: string } | null
  Is_Renewal_Call__c: boolean | null
}

interface SfEvent extends Record<string, unknown> {
  Id: string
  Subject: string | null
  ActivityDate: string | null
  CreatedDate: string | null
  Description: string | null
  Type: string | null
  Owner: { Name: string } | null
}

const TYPE_MAP: Record<string, string> = {
  Call: 'Call',
  Email: 'Email',
  Meeting: 'Meeting',
}

export async function GET(request: NextRequest) {
  try {
    const oppId = request.nextUrl.searchParams.get('id')
    if (!oppId) {
      return NextResponse.json({ error: 'Missing id parameter' }, { status: 400 })
    }

    // Sanitize the ID to prevent SOQL injection
    const safeId = oppId.replace(/[^a-zA-Z0-9]/g, '')

    const [tasks, events] = await Promise.all([
      querySalesforce<SfTask>(
        `SELECT Id, Subject, ActivityDate, CreatedDate, Status, Description, Type, Owner.Name, Is_Renewal_Call__c ` +
        `FROM Task WHERE WhatId = '${safeId}' ORDER BY ActivityDate DESC LIMIT 50`
      ),
      querySalesforce<SfEvent>(
        `SELECT Id, Subject, ActivityDate, CreatedDate, Description, Type, Owner.Name ` +
        `FROM Event WHERE WhatId = '${safeId}' ORDER BY ActivityDate DESC LIMIT 50`
      ),
    ])

    const taskActivities = tasks.map(t => ({
      id: t.Id,
      date: t.ActivityDate ?? t.CreatedDate ?? '',
      type: TYPE_MAP[t.Type ?? ''] ?? 'Internal Note',
      subject: t.Subject ?? '(No subject)',
      performedBy: t.Owner?.Name ?? 'Unknown',
      notes: t.Description ? t.Description.slice(0, 300) : '',
      isRenewalCall: t.Is_Renewal_Call__c ?? false,
    }))

    const eventActivities = events.map(e => ({
      id: e.Id,
      date: e.ActivityDate ?? e.CreatedDate ?? '',
      type: 'Meeting' as const,
      subject: e.Subject ?? '(No subject)',
      performedBy: e.Owner?.Name ?? 'Unknown',
      notes: e.Description ? e.Description.slice(0, 300) : '',
      isRenewalCall: false,
    }))

    // Merge and sort by date descending
    const activities = [...taskActivities, ...eventActivities].sort(
      (a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0)
    )

    return NextResponse.json({ activities })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[opportunity-activities] Error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
