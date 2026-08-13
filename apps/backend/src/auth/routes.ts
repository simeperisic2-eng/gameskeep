import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { authLoginInput, authRegisterInput } from '@gameskeep/shared/validation';
import { db } from '../db/client';
import { roles, users } from '../db/schema';
import { env, isProduction } from '../config/env';
import { sendError } from '../admin/http';
import { PASSWORD_ALGO, dummyVerify, hashPassword, verifyPassword } from './password';
import {
  ABSOLUTE_CAP_MS,
  CSRF_COOKIE,
  CSRF_HEADER,
  SESSION_COOKIE,
  createSession,
  newCsrfToken,
  revokeAllSessions,
  revokeSession,
  validateSession,
  type SessionUser,
  type ValidSession,
} from './session';
import { clearFailures, isLocked, registerFailure } from './lockout';

/**
 * Auth routes (SPEC I6, Slice 1). Every response here is enumeration-safe by
 * construction (see the per-route notes) and no payload ever carries a hash,
 * token, or internal field. Reached by the browser ONLY through the Next.js
 * BFF (same-origin cookie relay).
 *
 * Cookies: the session cookie is SIGNED + HttpOnly + SameSite=Lax (+ Secure in
 * production); the CSRF cookie is readable (double-submit) — mutations must
 * echo it in the `x-csrf-token` header. Same-origin via the BFF, so an
 * attacker's site can neither read the cookie nor forge the header.
 */
const GENERIC_REGISTER_BODY = {
  status: 'pending_verification',
  message: 'If the details are valid, a verification email is on its way.',
} as const;

const INVALID_CREDENTIALS = {
  error: 'invalid_credentials',
  message: 'Invalid username/email or password.',
} as const;

const LOCKED = {
  error: 'too_many_attempts',
  message: 'Too many failed attempts. Try again later.',
} as const;

function setSessionCookie(reply: FastifyReply, rawToken: string): void {
  reply.setCookie(SESSION_COOKIE, rawToken, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction(),
    signed: true,
    maxAge: Math.floor(ABSOLUTE_CAP_MS / 1000),
  });
}

function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

function ensureCsrfCookie(req: FastifyRequest, reply: FastifyReply): string {
  const existing = req.cookies[CSRF_COOKIE];
  if (existing && /^[a-f0-9]{64}$/.test(existing)) return existing;
  const token = newCsrfToken();
  reply.setCookie(CSRF_COOKIE, token, {
    path: '/',
    httpOnly: false, // double-submit: the client must be able to echo it
    sameSite: 'lax',
    secure: isProduction(),
    signed: false,
  });
  return token;
}

/** Double-submit CSRF check: header must match the cookie, both present. */
function csrfOk(req: FastifyRequest): boolean {
  const cookie = req.cookies[CSRF_COOKIE];
  const header = req.headers[CSRF_HEADER];
  const provided = Array.isArray(header) ? header[0] : header;
  return Boolean(cookie && provided && cookie === provided);
}

/** Resolve the signed session cookie to a live session, or null. */
async function sessionOf(req: FastifyRequest): Promise<ValidSession | null> {
  const raw = req.cookies[SESSION_COOKIE];
  if (!raw) return null;
  const unsigned = req.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) return null;
  return validateSession(unsigned.value);
}

/** The public user shape — NEVER carries hash/voteWeight/levelPoints/email of others. */
function publicUser(u: SessionUser): Record<string, unknown> {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl,
    isEmailVerified: u.isEmailVerified,
    reputation: u.reputation,
    role: { key: u.role.key, label: u.role.label, isStaff: u.role.isStaff },
    level: u.level,
    createdAt: u.createdAt,
  };
}

/**
 * Resolve a login identifier to a user — CASE-INSENSITIVELY for both forms, so
 * `bob` / `Bob` / `bob@x.com` all map to ONE account and therefore ONE lockout
 * budget (`uid:<id>` — the original review's bypass fix).
 */
async function resolveUser(identifier: string) {
  const idLower = identifier.trim().toLowerCase();
  const [row] = await db
    .select({
      id: users.id,
      passwordHash: users.passwordHash,
      status: users.status,
    })
    .from(users)
    .where(sql`lower(${users.username}) = ${idLower} OR lower(${users.email}) = ${idLower}`)
    .limit(1);
  return row ?? null;
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  await app.register(
    async (auth) => {
      // CSRF gate for every mutation in this scope. GET /csrf issues the token.
      auth.addHook('onRequest', async (req, reply) => {
        if (req.method === 'GET' || req.method === 'HEAD') return;
        if (!csrfOk(req)) {
          reply.code(403).send({
            error: 'csrf',
            message: `Missing or mismatched ${CSRF_HEADER} header (fetch /auth/csrf first).`,
          });
        }
      });

      // ── GET /auth/csrf — issue/refresh the double-submit token ──────────────
      auth.get('/csrf', async (req, reply) => {
        const token = ensureCsrfCookie(req, reply);
        return { token };
      });

      // ── POST /auth/register — enumeration-safe, NO auto-login ───────────────
      auth.post('/register', async (req, reply) => {
        try {
          const input = authRegisterInput.parse(req.body);
          const emailLower = input.email.trim().toLowerCase();

          // Username is PUBLIC identity — a distinct 409 is allowed (decision).
          const [byName] = await db
            .select({ id: users.id })
            .from(users)
            .where(sql`lower(${users.username}) = ${input.username.toLowerCase()}`)
            .limit(1);
          if (byName) {
            reply.code(409).send({ error: 'username_taken', message: 'Username is taken.' });
            return;
          }

          const [byEmail] = await db
            .select({ id: users.id })
            .from(users)
            .where(sql`lower(${users.email}) = ${emailLower}`)
            .limit(1);

          if (byEmail) {
            // Enumeration-safe: SAME generic 202, and burn a hash so timing
            // matches the fresh path. (Slice 2 emails the "account exists"
            // notice to the REAL owner — never the requester.)
            await hashPassword(input.password);
            reply.code(202).send(GENERIC_REGISTER_BODY);
            return;
          }

          const [role] = await db
            .select({ id: roles.id })
            .from(roles)
            .where(eq(roles.key, 'registered'))
            .limit(1);
          if (!role) throw new Error('roles seed missing "registered"');

          const passwordHash = await hashPassword(input.password);
          await db.insert(users).values({
            username: input.username,
            email: emailLower,
            roleId: role.id,
            passwordHash,
            passwordAlgo: PASSWORD_ALGO,
            isEmailVerified: false,
          });

          // NO session cookie here (locked consequence): the verify link or a
          // password login signs them in. Response identical to the taken-email
          // path.
          reply.code(202).send(GENERIC_REGISTER_BODY);
        } catch (err) {
          sendError(reply, err);
        }
      });

      // ── POST /auth/login — resolve→lockout→verify, enumeration-safe ─────────
      auth.post('/login', async (req, reply) => {
        try {
          const input = authLoginInput.parse(req.body);
          const ip = req.ip; // socket peer while TRUST_PROXY=false (unspoofable)

          if (await isLocked('ip', ip)) {
            reply.code(429).send(LOCKED);
            return;
          }

          // Resolve FIRST so the account lockout keys on the stable uid.
          const user = await resolveUser(input.identifier);

          if (!user || !user.passwordHash) {
            // Unknown identifier (or password-less account): burn a dummy
            // verify so body AND timing match the wrong-password path.
            await dummyVerify(input.password);
            await registerFailure('ip', ip);
            reply.code(401).send(INVALID_CREDENTIALS);
            return;
          }

          if (await isLocked('uid', user.id)) {
            // Locked stays locked — EVEN WITH THE CORRECT PASSWORD.
            reply.code(429).send(LOCKED);
            return;
          }

          const ok = await verifyPassword(user.passwordHash, input.password);
          if (!ok) {
            await registerFailure('uid', user.id);
            await registerFailure('ip', ip);
            reply.code(401).send(INVALID_CREDENTIALS);
            return;
          }

          if (user.status !== 'active') {
            // Authenticated — telling THEM their own account state is fine.
            reply.code(403).send({
              error: `account_${user.status}`,
              message: `This account is ${user.status}.`,
            });
            return;
          }

          await clearFailures(user.id);
          const { rawToken } = await createSession(user.id, {
            ip,
            userAgent: req.headers['user-agent'],
          });
          setSessionCookie(reply, rawToken);
          ensureCsrfCookie(req, reply);

          const session = await validateSession(rawToken);
          reply.send({ user: session ? publicUser(session.user) : null });
        } catch (err) {
          sendError(reply, err);
        }
      });

      // ── GET /auth/me — the session's own user, or 401 ───────────────────────
      auth.get('/me', async (req, reply) => {
        ensureCsrfCookie(req, reply);
        const session = await sessionOf(req);
        if (!session) {
          reply.code(401).send({ error: 'unauthenticated' });
          return;
        }
        reply.send({ user: publicUser(session.user) });
      });

      // ── POST /auth/logout — revoke THIS session ─────────────────────────────
      auth.post('/logout', async (req, reply) => {
        const session = await sessionOf(req);
        if (session) await revokeSession(session.sessionId);
        clearSessionCookie(reply);
        reply.send({ ok: true });
      });

      // ── POST /auth/logout-all — revoke EVERY session of this user ───────────
      auth.post('/logout-all', async (req, reply) => {
        const session = await sessionOf(req);
        if (!session) {
          reply.code(401).send({ error: 'unauthenticated' });
          return;
        }
        const revoked = await revokeAllSessions(session.user.id);
        clearSessionCookie(reply);
        reply.send({ ok: true, revoked });
      });
    },
    { prefix: '/auth' },
  );

  // Cookie secret sanity: the plugin is registered in server.ts with
  // env.SESSION_SECRET; nothing else may read it. Never log it.
  void env;
}
