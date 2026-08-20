/**
 * Public newsletter unsubscribe BFF (SPEC I8, Slice 3). Relays the confirm POST
 * from the /unsubscribe page → backend `/public/newsletter/unsubscribe`. The
 * unguessable per-recipient token in the body IS the authorization capability,
 * so there is no session/CSRF here (the email recipient has neither). The reply
 * is generically OK either way (enumeration-safe).
 */
const BACKEND = process.env.BACKEND_INTERNAL_URL ?? 'http://localhost:4000';

export async function POST(req: Request): Promise<Response> {
  let token = '';
  try {
    const raw = (await req.json()) as { token?: unknown };
    if (typeof raw?.token === 'string') token = raw.token;
  } catch {
    token = '';
  }

  try {
    const res = await fetch(`${BACKEND}/public/newsletter/unsubscribe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
      cache: 'no-store',
    });
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  } catch {
    return Response.json(
      { error: 'unreachable', message: 'Service is unreachable.' },
      { status: 502 },
    );
  }
}
