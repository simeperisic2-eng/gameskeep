/**
 * Control Panel BFF (SPEC I8, Slice 1). The browser Control Panel calls
 * `/admin/api/...`; this relays to the backend, forwarding the STAFF SESSION
 * cookie + CSRF header both ways so the backend applies I6 RBAC per the logged-in
 * staff's rank. It NO LONGER injects the `x-admin-token` — the old blanket-access
 * proxy is retired (that token is now automation/verify only). Mirrors the
 * community/awards BFFs: header ALLOWLIST (x-forwarded-for / x-real-ip never pass
 * — req.ip stays the unspoofable socket peer) and a strict per-segment charset
 * (rejects '.'/'..').
 */
const BACKEND = process.env.BACKEND_INTERNAL_URL ?? 'http://localhost:4000';

/** letters/digits/_/- only (UUIDs, `_meta`, `_audit`, slugs pass; dots don't). */
const SEGMENT_RE = /^[A-Za-z0-9_-]+$/;
const FORWARD_HEADERS = ['cookie', 'content-type', 'x-csrf-token', 'user-agent'] as const;

async function relay(req: Request, params: Promise<{ path: string[] }>): Promise<Response> {
  const { path } = await params;
  if (!path || path.length === 0 || path.some((seg) => !SEGMENT_RE.test(seg))) {
    return Response.json(
      { error: 'bad_path', message: 'Invalid admin path segment.' },
      { status: 400 },
    );
  }

  const url = new URL(req.url);
  const target = `${BACKEND}/admin/api/${path.join('/')}${url.search}`;

  const headers: Record<string, string> = {};
  for (const name of FORWARD_HEADERS) {
    const value = req.headers.get(name);
    if (value) headers[name] = value;
  }

  const init: RequestInit = { method: req.method, headers, cache: 'no-store', redirect: 'manual' };
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
      { error: 'admin_unreachable', message: 'Admin service is unreachable.' },
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
export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  return relay(req, ctx.params);
}
export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  return relay(req, ctx.params);
}
