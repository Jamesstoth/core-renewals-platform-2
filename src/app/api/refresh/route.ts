import { NextResponse } from 'next/server'

export async function POST() {
  // Auth bypass — allow anyone to trigger refresh for now
  const token = process.env.GITHUB_TOKEN
  const repo  = process.env.GITHUB_REPO ?? 'jamesqtrilogy/core-renewals-platform'

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
      'User-Agent': 'core-renewals-platform',
    },
    body: JSON.stringify({ ref: 'main' }),
  })

  if (resp.status === 204) {
    return NextResponse.json({ ok: true, triggered: new Date().toISOString() })
  }

  const body = await resp.text()
  return NextResponse.json({ error: body }, { status: resp.status })
}
