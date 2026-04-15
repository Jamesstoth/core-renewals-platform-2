import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('email_templates')
    .select('*')
    .order('is_default', { ascending: false })
    .order('name', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('email_templates')
    .insert({
      name: body.name,
      subject_template: body.subject_template ?? '',
      body_template: body.body_template ?? '',
      tone: body.tone ?? 'professional',
      ai_instructions: body.ai_instructions ?? null,
      is_default: false,
    })
    .select()
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
    .from('email_templates')
    .update({
      name: body.name,
      subject_template: body.subject_template,
      body_template: body.body_template,
      tone: body.tone,
      ai_instructions: body.ai_instructions,
      updated_at: new Date().toISOString(),
    })
    .eq('id', body.id)
    .select()
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
  const { error } = await supabase.from('email_templates').delete().eq('id', id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
