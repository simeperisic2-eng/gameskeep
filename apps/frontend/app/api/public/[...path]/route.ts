/**
 * Public BFF (Upcoming enrichment). Relays `/api/public/*` → backend `/public/*`,
 * forwarding cookies + the CSRF header both ways so a same-origin public write
 * (the "Suggest a missing game" form) can double-submit its CSRF token. Mirrors
 * the awards/community BFFs exactly: the same header ALLOWLIST (x-forwarded-for /
 * x-real-ip never pass — req.ip stays the unspoofable socket peer) and the same
 * strict per-segment charset (rejects '.'/'..'). Reads pass straight through.
 */
const BACKEND = process.env.BACKEND_INTERNAL_URL ?? 'http://localhost:4000';

const SEGMENT_RE = /^[A-Za-z0-9_-]+$/;
const FORWARD_HEADERS = ['cookie', 'content-type', 'x-csrf-token', 'user-agent'] as const;

async function relay(req: Request, params: Promise<{ path: string[] }>): Promise<Response> {
  const { path } = await params;
  if (!path || path.length === 0 || path.some((seg) => !SEGMENT_RE.test(seg))) {
    return Response.json(
      { error: 'bad_path', message: 'Invalid public path segment.' },
      { status: 400 },
    );
  }

  const url = new URL(req.url);
  const target = `${BACKEND}/public/${path.join('/')}${url.search}`;

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
      { error: 'public_unreachable', message: 'Service is unreachable.' },
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
