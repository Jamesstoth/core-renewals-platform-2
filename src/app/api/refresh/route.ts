import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST() {
  // Verify the caller is an authenticated @trilogy.com user
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user || !user.email?.endsWith('@trilogy.com')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const token = process.env.GITHUB_TOKEN
  const repo  = process.env.GITHUB_REPO ?? 'jamesqtrilogy/isr-dash'

  if (!token) {
    return NextResponse.json({ error: 'GITHUB_TOKEN not configured' }, { status: 500 })
  }

  const url = `https://api.github.com/repos/${repo}/actions/workflows/refresh.yml/dispatches`

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ref: 'main' }),
  })

  if (resp.status === 204) {
    return NextResponse.json({ ok: true, triggered: new Date().toISOString() })
  }

  const body = await resp.text()
  return NextResponse.json({ error: body }, { status: resp.status })
}
