// Auth middleware — runs on every request.
// Passes /auth/* through; redirects everything else to /auth/login if not authenticated.

function parseCookies(header) {
  if (!header) return {};
  return Object.fromEntries(
    header.split(';').map(c => {
      const idx = c.indexOf('=');
      return idx < 0 ? [c.trim(), ''] : [c.slice(0, idx).trim(), c.slice(idx + 1).trim()];
    })
  );
}

function fromB64url(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  return atob(b64 + '='.repeat((4 - b64.length % 4) % 4));
}

async function verifyJWT(token, secret) {
  try {
    const [header, body, sig] = token.split('.');
    if (!header || !body || !sig) return null;
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    const sigBytes = Uint8Array.from(
      atob(sig.replace(/-/g, '+').replace(/_/g, '/')),
      c => c.charCodeAt(0)
    );
    const valid = await crypto.subtle.verify(
      'HMAC', key, sigBytes, enc.encode(`${header}.${body}`)
    );
    if (!valid) return null;
    const data = JSON.parse(fromB64url(body));
    if (data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}

export async function onRequest(context) {
  const { request, next, env } = context;
  const url = new URL(request.url);

  if (url.pathname.startsWith('/auth/')) return next();

  const cookies = parseCookies(request.headers.get('Cookie') || '');
  const session = cookies.auth_token
    ? await verifyJWT(cookies.auth_token, env.JWT_SECRET)
    : null;

  if (!session) {
    return Response.redirect(`${url.origin}/auth/login`, 302);
  }

  return next();
}
