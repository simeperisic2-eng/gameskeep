/**
 * Auth BFF (SPEC I6, locked decision 2) — the browser NEVER talks to Fastify
 * directly. These handlers relay `/api/auth/*` → backend `/auth/*`, forwarding
 * cookies BOTH ways (the session cookie is set by the backend and carried back
 * verbatim). Same-origin, so SameSite=Lax + the CSRF double-submit work with
 * no credentialed cross-origin CORS.
 *
 * I6 hardening baked in:
 *  - HIGH (spoofable IP): the relay forwards a strict ALLOWLIST of headers —
 *    `x-forwarded-for` / `x-real-ip` / `forwarded` never pass through, so the
 *    backend's req.ip stays the unspoofable socket peer.
 *  - LOW (path traversal): path segments must match a strict charset; `.` and
 *    `..` are rejected outright (encodeURIComponent does NOT encode dots — an
 *    allowlist, not an encoder, is the guard).
 */
const BACKEND = process.env.BACKEND_INTERNAL_URL ?? 'http://localhost:4000';

/** Strict per-segment allowlist: letters/digits/_/- only. Rejects '.'/'..'. */
const SEGMENT_RE = /^[A-Za-z0-9_-]+$/;

/** Request headers the relay forwards — an allowlist, never a passthrough. */
const FORWARD_HEADERS = ['cookie', 'content-type', 'x-csrf-token', 'user-agent'] as const;

async function relay(req: Request, params: Promise<{ path: string[] }>): Promise<Response> {
  const { path } = await params;
  if (!path || path.length === 0 || path.some((seg) => !SEGMENT_RE.test(seg))) {
    return Response.json(
      { error: 'bad_path', message: 'Invalid auth path segment.' },
      { status: 400 },
    );
  }

  const url = new URL(req.url);
  const target = `${BACKEND}/auth/${path.join('/')}${url.search}`;

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
    // Relay EVERY Set-Cookie (session + CSRF can arrive together).
    for (const cookie of res.headers.getSetCookie()) {
      out.append('set-cookie', cookie);
    }
    return new Response(text, { status: res.status, headers: out });
  } catch {
    return Response.json(
      { error: 'auth_unreachable', message: 'Auth service is unreachable.' },
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
