import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('automation_rules')
    .select('*, signal_rules(name)')
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('automation_rules')
    .insert({
      name: body.name,
      signal_rule_id: body.signal_rule_id,
      action_type: body.action_type,
      action_config: body.action_config ?? {},
      schedule: body.schedule ?? 'when_triggered',
      is_active: body.is_active ?? true,
    })
    .select('*, signal_rules(name)')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json(data, { status: 201 })
}

export async function PUT(req: NextRequest) {
  const body = await req.json()
  if (!body.id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('automation_rules')
    .update({
      name: body.name,
      signal_rule_id: body.signal_rule_id,
      action_type: body.action_type,
      action_config: body.action_config,
      schedule: body.schedule,
      is_active: body.is_active,
      updated_at: new Date().toISOString(),
    })
    .eq('id', body.id)
    .select('*, signal_rules(name)')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json()
  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  }

  const supabase = await createClient()
  const { error } = await supabase.from('automation_rules').delete().eq('id', id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
