'use client'

import { createClient } from '@/lib/supabase/client'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

function LoginForm() {
  const params = useSearchParams()
  const error  = params.get('error')

  async function handleLogin() {
    const supabase = createClient()
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: {
          hd: 'trilogy.com',   // Google hosted domain hint
          prompt: 'select_account',
        },
      },
    })
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1>Renewals Dashboard</h1>
        <p>Sign in with your @trilogy.com Google account</p>
        <button className="google-btn" onClick={handleLogin}>
          <svg width="18" height="18" viewBox="0 0 48 48">
            <path fill="#FFC107" d="M43.6 20H24v8h11.3C33.7 33.7 29.3 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 6 1.1 8.1 3l5.9-5.9C34.5 5.1 29.5 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21c10.5 0 19.5-7.3 21-17.4.1-.9.1-1.7.1-2.6 0-.7 0-1.4-.1-2h-1.4z"/>
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 6 1.1 8.1 3l5.9-5.9C34.5 5.1 29.5 3 24 3 16.3 3 9.7 7.9 6.3 14.7z"/>
            <path fill="#4CAF50" d="M24 45c5.2 0 10-1.9 13.6-5l-6.3-5.1C29.5 36.5 26.9 37 24 37c-5.2 0-9.6-3.2-11.3-7.8l-6.5 5C9.6 41 16.3 45 24 45z"/>
            <path fill="#1976D2" d="M43.6 20H24v8h11.3c-.8 2.1-2.2 3.9-4 5.1l6.3 5.1C41.1 35.3 44 30 44 24c0-.7 0-1.4-.1-2h-.3z"/>
          </svg>
          Sign in with Google
        </button>
        {error === 'not_trilogy' && (
          <p className="error-msg">Access restricted to @trilogy.com accounts.</p>
        )}
        {error === 'oauth' && (
          <p className="error-msg">Sign-in failed. Please try again or contact IT if the issue persists.</p>
        )}
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
