/**
 * Same-origin proxy for the admin API. The browser admin console calls
 * `/admin/api/...` (this handler), which forwards to the backend and injects
 * the `x-admin-token` SERVER-SIDE so the token never reaches the client. The
 * full permissioned Control Panel + login arrive in I8; this keeps the I1 admin
 * usable in the browser without exposing the demo token.
 */
const BACKEND = process.env.BACKEND_INTERNAL_URL ?? 'http://localhost:4000';
const TOKEN = process.env.ADMIN_API_TOKEN ?? 'demo-admin-token';

async function forward(req: Request, path: string[]): Promise<Response> {
  const url = new URL(req.url);
  const target = `${BACKEND}/admin/api/${path.map(encodeURIComponent).join('/')}${url.search}`;

  const headers: Record<string, string> = {
    'x-admin-token': TOKEN,
    'x-admin-actor': 'admin (web)',
  };
  const init: RequestInit = { method: req.method, headers, cache: 'no-store' };

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const body = await req.text();
    if (body) {
      init.body = body;
      headers['content-type'] = 'application/json';
    }
  }

  try {
    const res = await fetch(target, init);
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: 'proxy_unreachable',
        message: err instanceof Error ? err.message : String(err),
      }),
      { status: 502, headers: { 'content-type': 'application/json' } },
    );
  }
}

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  return forward(req, (await ctx.params).path);
}
export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  return forward(req, (await ctx.params).path);
}
export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  return forward(req, (await ctx.params).path);
}
export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  return forward(req, (await ctx.params).path);
}
