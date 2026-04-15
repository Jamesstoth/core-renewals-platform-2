import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('platform_settings')
    .select('*')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const settings: Record<string, unknown> = {}
  for (const row of data ?? []) {
    settings[row.key] = row.value
  }
  return NextResponse.json(settings)
}

export async function PUT(req: NextRequest) {
  const body = await req.json() as Record<string, unknown>
  const supabase = await createClient()

  const upserts = Object.entries(body).map(([key, value]) => ({
    key,
    value: value as Record<string, unknown>,
    updated_at: new Date().toISOString(),
  }))

  const { error } = await supabase
    .from('platform_settings')
    .upsert(upserts, { onConflict: 'key' })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
