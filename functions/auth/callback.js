// Handles Google OAuth callback: exchanges code for token, validates @trilogy.com, sets session cookie.

const ALLOWED_DOMAIN = 'trilogy.com';

function parseCookies(header) {
  if (!header) return {};
  return Object.fromEntries(
    header.split(';').map(c => {
      const idx = c.indexOf('=');
      return idx < 0 ? [c.trim(), ''] : [c.slice(0, idx).trim(), c.slice(idx + 1).trim()];
    })
  );
}

function b64url(b64) {
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  return atob(b64 + '='.repeat((4 - b64.length % 4) % 4));
}

async function createJWT(payload, secret) {
  const enc = new TextEncoder();
  const header = b64url(btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body   = b64url(btoa(JSON.stringify({
    ...payload,
    exp: Math.floor(Date.now() / 1000) + 86400, // 24 h
  })));
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${header}.${body}`));
  return `${header}.${body}.${b64url(btoa(String.fromCharCode(...new Uint8Array(sig))))}`;
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const code  = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  // CSRF check
  const cookies = parseCookies(request.headers.get('Cookie') || '');
  if (!state || state !== cookies.oauth_state) {
    return new Response('OAuth state mismatch.', { status: 400 });
  }

  // Exchange code for tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri:  `${url.origin}/auth/callback`,
      grant_type:    'authorization_code',
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    return new Response(`Token exchange failed: ${err}`, { status: 502 });
  }

  const tokens = await tokenRes.json();

  // Decode Google's ID token (trusted — came from direct server-to-server exchange over HTTPS)
  let profile;
  try {
    profile = JSON.parse(fromB64url(tokens.id_token.split('.')[1]));
  } catch {
    return new Response('Failed to decode ID token.', { status: 502 });
  }

  const email = (profile.email || '').toLowerCase();
  if (!email.endsWith(`@${ALLOWED_DOMAIN}`)) {
    return new Response(
      `<html><body style="font-family:sans-serif;padding:40px">
        <h2>Access denied</h2>
        <p><strong>${email}</strong> is not a @${ALLOWED_DOMAIN} account.</p>
        <p><a href="/auth/login">Try a different account</a></p>
      </body></html>`,
      { status: 403, headers: { 'Content-Type': 'text/html' } }
    );
  }

  const sessionToken = await createJWT(
    { email, name: profile.name || email },
    env.JWT_SECRET
  );

  const headers = new Headers({ 'Location': '/' });
  headers.append('Set-Cookie',
    `auth_token=${sessionToken}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=86400`);
  headers.append('Set-Cookie',
    `oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);

  return new Response(null, { status: 302, headers });
}
