import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../config/env';
import { constantTimeEqual } from '../lib/crypto';
import { csrfOk, CSRF_HEADER } from '../auth/session';
import { sessionFromRequest } from '../auth/guards';
import { CANONICAL_SECTION_RE, requiredRankFor, sectionOf, RANK } from './rbac';

/**
 * Admin authentication (SPEC I6, Slice 3, decision 5). TWO paths reach the
 * admin surface:
 *
 *  1. STAFF SESSION — the primary HUMAN path. A signed session cookie whose
 *     user is `role.isStaff`, gated per section by `role.rank ≥ required`.
 *     Because the cookie is ambient, cookie-authed MUTATIONS must also carry a
 *     valid CSRF double-submit header (same rule as the /auth scope).
 *  2. SERVICE TOKEN — `x-admin-token`, RETAINED for automation as a hard
 *     constraint (`verify:i1…b2` depend on it). A bearer credential, not
 *     ambient, so it needs no CSRF and it bypasses per-section gating (a
 *     trusted service acts with full authority).
 *
 * A present-but-wrong token is a hard 401 (we do NOT fall through to the
 * session path — an explicit bad credential is an error, not an anonymous
 * request). The compare is constant-time (hash-then-timingSafeEqual).
 */
export type AdminAuth =
  | { kind: 'service'; rank: number; actorLabel: string }
  | { kind: 'staff'; rank: number; actorLabel: string; userId: string };

const AUTH_SLOT = Symbol('gkAdminAuth');
interface WithAdminAuth {
  [AUTH_SLOT]?: AdminAuth;
}

/** The resolved admin identity for this request (set by the hook). */
export function getAdminAuth(req: FastifyRequest): AdminAuth | undefined {
  return (req as unknown as WithAdminAuth)[AUTH_SLOT];
}

function setAdminAuth(req: FastifyRequest, auth: AdminAuth): void {
  (req as unknown as WithAdminAuth)[AUTH_SLOT] = auth;
}

function headerActor(req: FastifyRequest): string | null {
  const raw = req.headers['x-admin-actor'];
  const label = (Array.isArray(raw) ? raw[0] : raw)?.toString().slice(0, 120);
  return label || null;
}

const isWrite = (method: string): boolean =>
  method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';

export async function adminAuthHook(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  // ── Path 1: service token (automation). Present-but-wrong → hard 401. ──────
  const token = req.headers['x-admin-token'];
  const provided = Array.isArray(token) ? token[0] : token;
  if (provided !== undefined) {
    if (!constantTimeEqual(provided, env.ADMIN_API_TOKEN)) {
      reply.code(401).send({ error: 'unauthorized', message: 'Missing or invalid admin token' });
      return;
    }
    // Trusted service — full authority, no CSRF, no per-section gate.
    setAdminAuth(req, {
      kind: 'service',
      rank: RANK.owner,
      actorLabel: headerActor(req) ?? 'service',
    });
    return;
  }

  // ── Path 2: staff session (the primary human path). ───────────────────────
  const session = await sessionFromRequest(req);
  if (!session) {
    reply
      .code(401)
      .send({ error: 'unauthorized', message: 'Sign in as staff or supply a service token.' });
    return;
  }
  if (!session.user.role.isStaff) {
    reply.code(403).send({ error: 'forbidden', message: 'Staff access required.' });
    return;
  }
  // Ambient cookie → CSRF double-submit required for every mutation.
  if (isWrite(req.method) && !csrfOk(req)) {
    reply.code(403).send({
      error: 'csrf',
      message: `Missing or mismatched ${CSRF_HEADER} header (fetch /auth/csrf first).`,
    });
    return;
  }
  // Per-section rank gate. The section is DECODED + lowercased (so an encoded
  // section can't dodge the classifier); anything non-canonical after decoding
  // (e.g. double-encoding) is not a legitimately addressable section → 403.
  const section = sectionOf(req.url);
  if (!CANONICAL_SECTION_RE.test(section)) {
    reply.code(403).send({ error: 'forbidden', message: 'Unrecognized admin section.' });
    return;
  }
  const required = await requiredRankFor(section);
  if (session.user.role.rank < required) {
    reply.code(403).send({
      error: 'forbidden',
      message: `This section requires rank ${required}; your role has ${session.user.role.rank}.`,
    });
    return;
  }
  setAdminAuth(req, {
    kind: 'staff',
    rank: session.user.role.rank,
    actorLabel: session.user.username,
    userId: session.user.id,
  });
}
