import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  // Auth bypass — go straight to the dashboard.
  // To re-enable auth, restore the Supabase user check that was here before.
  redirect('/pipeline')
}
