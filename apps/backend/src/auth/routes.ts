import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import {
  authEmailRequestInput,
  authLoginInput,
  authRegisterInput,
  authResetPasswordInput,
  authVerifyEmailInput,
} from '@gameskeep/shared/validation';
import { db } from '../db/client';
import { roles, users } from '../db/schema';
import { env, isProduction } from '../config/env';
import { sendError } from '../admin/http';
import {
  sendAccountExistsNotice,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from '../email/send';
import { canSend } from '../email/throttle';
import { PASSWORD_ALGO, dummyVerify, hashPassword, verifyPassword } from './password';
import { consumeToken, issueToken } from './tokens';
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

// Enumeration-safe generic bodies for the email-flow endpoints (Slice 2): the
// response is IDENTICAL whether or not the email maps to an account, so a
// requester learns nothing about who is registered.
const GENERIC_VERIFY_BODY = {
  status: 'pending_verification',
  message: 'If that account needs verification, an email is on its way.',
} as const;

const GENERIC_RESET_BODY = {
  status: 'reset_requested',
  message: 'If an account exists for that email, a reset link is on its way.',
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
            // matches the fresh path. The "account exists" notice goes to the
            // REAL owner of that address (byEmail.id) — NEVER the requester, who
            // gets nothing that confirms the email is registered. Throttled so
            // this can't be used to spam the real owner.
            await hashPassword(input.password);
            if (await canSend(emailLower, req.ip)) {
              await sendAccountExistsNotice(emailLower, byEmail.id);
            }
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
          const [created] = await db
            .insert(users)
            .values({
              username: input.username,
              email: emailLower,
              roleId: role.id,
              passwordHash,
              passwordAlgo: PASSWORD_ALGO,
              isEmailVerified: false,
            })
            .returning({ id: users.id });

          // Issue a single-use verification token (hashed at rest, 24h TTL) and
          // email the link (throttled per email + IP; a throttle silently skips
          // the send and the response is unchanged).
          if (created && (await canSend(emailLower, req.ip))) {
            const token = await issueToken(created.id, 'verify_email');
            await sendVerificationEmail(emailLower, token, created.id);
          }

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

      // ── POST /auth/verify-email — confirm the address (and sign in) ─────────
      auth.post('/verify-email', async (req, reply) => {
        try {
          const { token } = authVerifyEmailInput.parse(req.body);
          // Single-use, race-safe consume: a replay or a second concurrent use
          // matches zero rows and returns null.
          const consumed = await consumeToken(token, 'verify_email');
          if (!consumed) {
            reply.code(400).send({
              error: 'invalid_or_expired_token',
              message: 'This link is invalid or has expired.',
            });
            return;
          }
          await db
            .update(users)
            .set({ isEmailVerified: true })
            .where(eq(users.id, consumed.userId));

          // The verify link signs them in (the locked flip-side of register not
          // auto-logging-in) — but only if the account is active.
          const [u] = await db
            .select({ status: users.status })
            .from(users)
            .where(eq(users.id, consumed.userId))
            .limit(1);
          if (u?.status === 'active') {
            const { rawToken } = await createSession(consumed.userId, {
              ip: req.ip,
              userAgent: req.headers['user-agent'],
            });
            setSessionCookie(reply, rawToken);
            ensureCsrfCookie(req, reply);
            const session = await validateSession(rawToken);
            reply.send({ verified: true, user: session ? publicUser(session.user) : null });
            return;
          }
          reply.send({ verified: true, user: null });
        } catch (err) {
          sendError(reply, err);
        }
      });

      // ── POST /auth/request-verification — resend, enumeration-safe ──────────
      auth.post('/request-verification', async (req, reply) => {
        try {
          const { email } = authEmailRequestInput.parse(req.body);
          const emailLower = email.trim().toLowerCase();
          const [u] = await db
            .select({
              id: users.id,
              isEmailVerified: users.isEmailVerified,
              status: users.status,
            })
            .from(users)
            .where(sql`lower(${users.email}) = ${emailLower}`)
            .limit(1);
          // Only a real, active, still-unverified account triggers a send — but
          // the response is generic either way (no existence signal). Throttled.
          if (
            u &&
            !u.isEmailVerified &&
            u.status === 'active' &&
            (await canSend(emailLower, req.ip))
          ) {
            const token = await issueToken(u.id, 'verify_email');
            await sendVerificationEmail(emailLower, token, u.id);
          }
          reply.code(202).send(GENERIC_VERIFY_BODY);
        } catch (err) {
          sendError(reply, err);
        }
      });

      // ── POST /auth/request-password-reset — enumeration-safe ────────────────
      auth.post('/request-password-reset', async (req, reply) => {
        try {
          const { email } = authEmailRequestInput.parse(req.body);
          const emailLower = email.trim().toLowerCase();
          const [u] = await db
            .select({ id: users.id, status: users.status })
            .from(users)
            .where(sql`lower(${users.email}) = ${emailLower}`)
            .limit(1);
          if (u && u.status === 'active' && (await canSend(emailLower, req.ip))) {
            const token = await issueToken(u.id, 'password_reset');
            await sendPasswordResetEmail(emailLower, token, u.id);
          }
          reply.code(202).send(GENERIC_RESET_BODY);
        } catch (err) {
          sendError(reply, err);
        }
      });

      // ── POST /auth/reset-password — set new password, revoke ALL sessions ───
      auth.post('/reset-password', async (req, reply) => {
        try {
          const { token, password } = authResetPasswordInput.parse(req.body);
          const consumed = await consumeToken(token, 'password_reset');
          if (!consumed) {
            reply.code(400).send({
              error: 'invalid_or_expired_token',
              message: 'This link is invalid or has expired.',
            });
            return;
          }
          const passwordHash = await hashPassword(password);
          // Controlling the reset mailbox proves address ownership → mark verified.
          await db
            .update(users)
            .set({ passwordHash, passwordAlgo: PASSWORD_ALGO, isEmailVerified: true })
            .where(eq(users.id, consumed.userId));
          // A password reset revokes EVERY session (locked decision 1) — any
          // stolen or stale cookie dies here. They log in fresh with the new one.
          const revoked = await revokeAllSessions(consumed.userId);
          reply.send({ ok: true, revoked });
        } catch (err) {
          sendError(reply, err);
        }
      });
    },
    { prefix: '/auth' },
  );

  // Cookie secret sanity: the plugin is registered in server.ts with
  // env.SESSION_SECRET; nothing else may read it. Never log it.
  void env;
}
