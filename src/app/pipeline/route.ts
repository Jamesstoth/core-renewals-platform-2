import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data, error } = await supabase
    .from('pipeline_html')
    .select('html, updated_at')
    .eq('id', 1)
    .single()

  if (error || !data?.html) {
    return new Response(
      `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px">
        <h2>Pipeline dashboard not yet generated</h2>
        <p>Run the refresh workflow to build it.</p>
      </body></html>`,
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    )
  }

  return new Response(data.html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}
