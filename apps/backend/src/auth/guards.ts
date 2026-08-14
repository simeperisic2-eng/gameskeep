import type { FastifyReply, FastifyRequest } from 'fastify';
import { SESSION_COOKIE, validateSession, type ValidSession } from './session';

/**
 * Permission guards (SPEC I6, Slice 3). Small composable primitives —
 * `requireAuth` / `requireVerified` / `requireStaff` / `requireRole(minRank)` —
 * used as Fastify preHandlers OR called inline. Each resolves the signed
 * session cookie ONCE per request (cached on the request object) so stacking
 * guards costs a single DB round-trip.
 *
 * The ranks come from the `roles` table (visitor 0 < registered 10 < writer 20
 * < moderator 30 < admin 40 < owner 50) and are JOINed fresh on every
 * `validateSession`, so a role change takes effect on the user's very next
 * request — no re-login, no stale token claim (a reason we chose opaque
 * server-side sessions over JWT).
 *
 * A guard that denies SENDS the response (401/403) and returns null; a Fastify
 * preHandler that has already replied short-circuits the route. A guard that
 * allows returns the `ValidSession` so the handler can use the actor.
 */

/** Symbol-keyed cache slot so the session lookup happens at most once/request. */
const SESSION_SLOT = Symbol('gkSession');
interface WithSession {
  [SESSION_SLOT]?: ValidSession | null;
}

/** Resolve the signed session cookie to a live session (cached per request). */
export async function sessionFromRequest(req: FastifyRequest): Promise<ValidSession | null> {
  const holder = req as unknown as WithSession;
  if (SESSION_SLOT in holder) return holder[SESSION_SLOT] ?? null;

  let result: ValidSession | null = null;
  const raw = req.cookies[SESSION_COOKIE];
  if (raw) {
    const unsigned = req.unsignCookie(raw);
    if (unsigned.valid && unsigned.value) result = await validateSession(unsigned.value);
  }
  holder[SESSION_SLOT] = result;
  return result;
}

const UNAUTHORIZED = { error: 'unauthorized', message: 'Sign in required.' } as const;
const FORBIDDEN = { error: 'forbidden', message: 'You do not have access to this.' } as const;
const UNVERIFIED = {
  error: 'email_unverified',
  message: 'Verify your email address to do this.',
} as const;

/** Require a signed-in user. Returns the session, or 401s and returns null. */
export async function requireAuth(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<ValidSession | null> {
  const session = await sessionFromRequest(req);
  if (!session) {
    reply.code(401).send(UNAUTHORIZED);
    return null;
  }
  return session;
}

/** Require a signed-in user with a VERIFIED email (community-write gate). */
export async function requireVerified(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<ValidSession | null> {
  const session = await requireAuth(req, reply);
  if (!session) return null;
  if (!session.user.isEmailVerified) {
    reply.code(403).send(UNVERIFIED);
    return null;
  }
  return session;
}

/** Require a signed-in STAFF user (`role.isStaff`). */
export async function requireStaff(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<ValidSession | null> {
  const session = await requireAuth(req, reply);
  if (!session) return null;
  if (!session.user.role.isStaff) {
    reply.code(403).send(FORBIDDEN);
    return null;
  }
  return session;
}

/**
 * Require a signed-in user whose role rank is at least `minRank`. Factory so it
 * reads naturally at the call site: `requireRole(40)` (admin), `requireRole(50)`
 * (owner). Rank gating implies authentication.
 */
export function requireRole(minRank: number) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<ValidSession | null> => {
    const session = await requireAuth(req, reply);
    if (!session) return null;
    if (session.user.role.rank < minRank) {
      reply.code(403).send(FORBIDDEN);
      return null;
    }
    return session;
  };
}
