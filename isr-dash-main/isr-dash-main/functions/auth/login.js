// Initiates Google OAuth flow.

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const state = crypto.randomUUID();
  const params = new URLSearchParams({
    client_id:     env.GOOGLE_CLIENT_ID,
    redirect_uri:  `${url.origin}/auth/callback`,
    response_type: 'code',
    scope:         'openid email profile',
    state,
    prompt:        'select_account',
  });

  return new Response(null, {
    status: 302,
    headers: {
      'Location':   `https://accounts.google.com/o/oauth2/auth?${params}`,
      'Set-Cookie': `oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`,
    },
  });
}
