// POST /admin/refresh — triggers the GitHub Actions refresh workflow.
// Auth middleware ensures only @trilogy.com users can reach this.
//
// Required Cloudflare Pages environment variables:
//   GITHUB_TOKEN   Personal access token with Actions:write + Contents:write scopes
//   GITHUB_REPO    e.g. "quigley/trilogy-renewals-dashboard"

// Simple in-memory cooldown: one dispatch per 60 seconds.
let lastDispatch = 0;
const COOLDOWN_MS = 60_000;

export async function onRequestPost(context) {
  const { env } = context;

  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Server not configured.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (!env.ANTHROPIC_API_KEY) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Refresh disabled — add ANTHROPIC_API_KEY to Cloudflare env to enable.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const now = Date.now();
  if (now - lastDispatch < COOLDOWN_MS) {
    const wait = Math.ceil((COOLDOWN_MS - (now - lastDispatch)) / 1000);
    return new Response(
      JSON.stringify({ ok: false, error: `Already triggered. Try again in ${wait}s.` }),
      { status: 429, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(
      `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/refresh.yml/dispatches`,
      {
        method: 'POST',
        headers: {
          'Authorization':        `Bearer ${env.GITHUB_TOKEN}`,
          'Accept':               'application/vnd.github+json',
          'Content-Type':         'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent':           'trilogy-dashboard',
        },
        body: JSON.stringify({ ref: 'main' }),
        signal: controller.signal,
      }
    );

    if (res.status === 204) {
      lastDispatch = Date.now();
      return new Response(
        JSON.stringify({ ok: true }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ ok: false, error: `GitHub returned ${res.status}` }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    const msg = e.name === 'AbortError' ? 'GitHub API timed out' : 'Failed to contact GitHub';
    return new Response(
      JSON.stringify({ ok: false, error: msg }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  } finally {
    clearTimeout(timer);
  }
}

// Reject non-POST requests
export async function onRequestGet() {
  return new Response('Method not allowed', { status: 405 });
}
