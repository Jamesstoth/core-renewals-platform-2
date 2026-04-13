// Clears the session cookie and redirects to login.

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  return new Response(null, {
    status: 302,
    headers: {
      'Location':   `${url.origin}/auth/login`,
      'Set-Cookie': 'auth_token=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0',
    },
  });
}
