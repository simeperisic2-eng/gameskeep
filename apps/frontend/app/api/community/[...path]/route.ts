/**
 * Community BFF (SPEC I6, decision 2) — the browser NEVER talks to Fastify
 * directly. Relays `/api/community/*` → backend `/community/*`, forwarding
 * cookies BOTH ways so the session cookie + CSRF double-submit work same-origin.
 * Mirrors the auth BFF, with the same header ALLOWLIST (x-forwarded-for /
 * x-real-ip never pass through — req.ip stays the unspoofable socket peer) and
 * the same strict per-segment charset (rejects '.'/'..'). Adds DELETE for
 * unfollow / rating removal.
 */
const BACKEND = process.env.BACKEND_INTERNAL_URL ?? 'http://localhost:4000';

/** Strict per-segment allowlist: letters/digits/_/- only (UUIDs pass; dots don't). */
const SEGMENT_RE = /^[A-Za-z0-9_-]+$/;
const FORWARD_HEADERS = ['cookie', 'content-type', 'x-csrf-token', 'user-agent'] as const;

async function relay(req: Request, params: Promise<{ path: string[] }>): Promise<Response> {
  const { path } = await params;
  if (!path || path.length === 0 || path.some((seg) => !SEGMENT_RE.test(seg))) {
    return Response.json(
      { error: 'bad_path', message: 'Invalid community path segment.' },
      { status: 400 },
    );
  }

  const url = new URL(req.url);
  const target = `${BACKEND}/community/${path.join('/')}${url.search}`;

  const headers: Record<string, string> = {};
  for (const name of FORWARD_HEADERS) {
    const value = req.headers.get(name);
    if (value) headers[name] = value;
  }

  const init: RequestInit = {
    method: req.method,
    headers,
    cache: 'no-store',
    redirect: 'manual',
  };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const body = await req.text();
    if (body) init.body = body;
  }

  try {
    const res = await fetch(target, init);
    const text = await res.text();
    const out = new Headers({
      'content-type': res.headers.get('content-type') ?? 'application/json',
      'cache-control': 'no-store',
    });
    for (const cookie of res.headers.getSetCookie()) out.append('set-cookie', cookie);
    return new Response(text, { status: res.status, headers: out });
  } catch {
    return Response.json(
      { error: 'community_unreachable', message: 'Community service is unreachable.' },
      { status: 502 },
    );
  }
}

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  return relay(req, ctx.params);
}
export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  return relay(req, ctx.params);
}
export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  return relay(req, ctx.params);
}
