/**
 * GET /api/gate-triggers
 *
 * Returns the 7-gate framework as JSON so any backend consumer (rules
 * engine, Python sync, external agents) can resolve a gate's full trigger
 * definition without embedding it into their own config.
 *
 * Optional query params:
 *   ?id=gateN          — single gate lookup
 *   ?flag=in_gateN     — resolve a Supabase flag to its gate
 *   ?daysToRenewal=N   — resolve the active gate for an opp given its renewal window
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  GATES,
  GATE_ORDER,
  CRITICAL_TIMELINE,
  CLOSING_SCENARIOS,
  SUPABASE_FLAG_TO_GATE,
  getGate,
  gateForFlag,
  gateForDaysToRenewal,
  type GateId,
} from '@/lib/gate-triggers'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams
  const id = params.get('id')
  const flag = params.get('flag')
  const daysParam = params.get('daysToRenewal')

  if (id) {
    if (!(id in GATES)) {
      return NextResponse.json({ error: `Unknown gate id: ${id}` }, { status: 404 })
    }
    return NextResponse.json({ gate: getGate(id as GateId) })
  }

  if (flag) {
    const gate = gateForFlag(flag)
    return NextResponse.json({ flag, gate })
  }

  if (daysParam !== null) {
    const days = Number(daysParam)
    if (!Number.isFinite(days)) {
      return NextResponse.json({ error: `Invalid daysToRenewal: ${daysParam}` }, { status: 400 })
    }
    return NextResponse.json({ daysToRenewal: days, gate: gateForDaysToRenewal(days) })
  }

  // Default: full framework dump, ordered
  return NextResponse.json({
    version: '1.0',
    source: 'Renewal_Gate_Trigger_Framework.docx (April 2026)',
    criticalTimeline: CRITICAL_TIMELINE,
    closingScenarios: CLOSING_SCENARIOS,
    supabaseFlagToGate: SUPABASE_FLAG_TO_GATE,
    gates: GATE_ORDER.map(gid => GATES[gid]),
  })
}
