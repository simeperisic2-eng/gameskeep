import { describe, expect, it } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { PASSWORD_ALGO, hashPassword, verifyPassword } from '../src/auth/password';
import { coarsenIp, csrfOk, hashToken, newCsrfToken } from '../src/auth/session';
import { consumeToken } from '../src/auth/tokens';
import { requireAuth, requireRole, requireStaff, requireVerified } from '../src/auth/guards';
import { DEFAULT_SECTION_RANK, RANK, SECTION_RANK_DEFAULTS, sectionOf } from '../src/admin/rbac';
import { assertProductionSecrets, trustProxyValue, type Env } from '../src/config/env';
import { constantTimeEqual } from '../src/lib/crypto';
import { accountExistsEmail, passwordResetEmail, verificationEmail } from '../src/email/templates';

/**
 * Hermetic I6 Slice-1 tests — pure logic only (no DB/Redis): the Argon2id
 * contract, token hashing, IP coarsening, the fail-closed production guard,
 * TRUST_PROXY parsing, and the constant-time compare. The live attack-path
 * proofs (lockout, enumeration, CSRF, cookies) run in scripts/i6-check.mjs.
 */
describe('auth: password hashing (Argon2id)', () => {
  it('hashes with argon2id and never stores the plaintext', { timeout: 20_000 }, async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).not.toContain('correct horse');
    expect(PASSWORD_ALGO).toMatch(/^argon2id/);
  });

  it('verifies the right password and rejects the wrong one', { timeout: 20_000 }, async () => {
    const hash = await hashPassword('s3cret-passw0rd!');
    expect(await verifyPassword(hash, 's3cret-passw0rd!')).toBe(true);
    expect(await verifyPassword(hash, 's3cret-passw0rd?')).toBe(false);
    // Malformed/foreign hashes are a clean false, never a throw.
    expect(await verifyPassword('not-a-hash', 'whatever')).toBe(false);
  });
});

describe('auth: session token hygiene', () => {
  it('stores only a SHA-256 of the token (hash ≠ raw, deterministic)', () => {
    const raw = 'ab'.repeat(32); // shape of a real 256-bit hex token
    const h = hashToken(raw);
    expect(h).toMatch(/^[a-f0-9]{64}$/);
    expect(h).not.toBe(raw);
    expect(hashToken(raw)).toBe(h);
  });

  it('CSRF tokens are 256-bit hex and unique', () => {
    const a = newCsrfToken();
    const b = newCsrfToken();
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(a).not.toBe(b);
  });
});

describe('auth: IP coarsening (GDPR-lean storage)', () => {
  it('zeroes the IPv4 host octet and truncates IPv6', () => {
    expect(coarsenIp('203.0.113.77')).toBe('203.0.113.0');
    expect(coarsenIp('10.1.2.3')).toBe('10.1.2.0');
    expect(coarsenIp('2001:db8:abcd:12:34:56:78:9a')).toBe('2001:db8:abcd::');
    expect(coarsenIp('not-an-ip')).toBeNull();
    expect(coarsenIp(null)).toBeNull();
  });
});

describe('env: fail-closed production secrets (I6 hardening, LOW)', () => {
  const base = { APP_MODE: 'production' } as unknown as Env;

  it('refuses production with demo-default secrets', () => {
    expect(() =>
      assertProductionSecrets({
        ...base,
        SESSION_SECRET: 'demo-insecure-session-secret-change-me',
        ADMIN_API_TOKEN: 'real-token-here',
      } as Env),
    ).toThrow(/SESSION_SECRET/);
    expect(() =>
      assertProductionSecrets({
        ...base,
        SESSION_SECRET: 'a-real-generated-secret',
        ADMIN_API_TOKEN: 'demo-admin-token',
      } as Env),
    ).toThrow(/ADMIN_API_TOKEN/);
  });

  it('accepts production with real secrets, and demo with defaults', () => {
    expect(() =>
      assertProductionSecrets({
        ...base,
        SESSION_SECRET: 'a-real-generated-secret',
        ADMIN_API_TOKEN: 'a-real-admin-token',
      } as Env),
    ).not.toThrow();
    expect(() =>
      assertProductionSecrets({
        APP_MODE: 'demo',
        SESSION_SECRET: 'demo-insecure-session-secret-change-me',
        ADMIN_API_TOKEN: 'demo-admin-token',
      } as unknown as Env),
    ).not.toThrow();
  });
});

describe('env: TRUST_PROXY parsing (I6 hardening, HIGH — spoofable IP)', () => {
  it('defaults to false (unspoofable socket peer) and parses the variants', () => {
    expect(trustProxyValue('false')).toBe(false);
    expect(trustProxyValue('')).toBe(false);
    expect(trustProxyValue('true')).toBe(true);
    expect(trustProxyValue('1')).toBe(1);
    expect(trustProxyValue('2')).toBe(2);
    expect(trustProxyValue('10.0.0.0/8,172.16.0.0/12')).toBe('10.0.0.0/8,172.16.0.0/12');
  });
});

describe('email: templates (I6 Slice 2 — links, TTL, no token leak)', () => {
  const TOKEN = 'ab'.repeat(32); // shape of a real 256-bit hex token

  it('verification email embeds the token link and normalizes the base', () => {
    const m = verificationEmail('user@example.test', TOKEN, 'https://games.keep/');
    expect(m.purpose).toBe('verify_email');
    expect(m.toEmail).toBe('user@example.test');
    // Trailing slash on the base must not double up.
    expect(m.bodyText).toContain(`https://games.keep/verify-email?token=${TOKEN}`);
    expect(m.bodyText).not.toContain('keep//verify-email');
    expect(m.bodyText).toMatch(/24 hours/);
  });

  it('password-reset email embeds a one-hour, single-use link', () => {
    const m = passwordResetEmail('user@example.test', TOKEN, 'https://games.keep');
    expect(m.purpose).toBe('password_reset');
    expect(m.bodyText).toContain(`https://games.keep/reset-password?token=${TOKEN}`);
    expect(m.bodyText).toMatch(/1 hour/);
  });

  it('account-exists notice carries NO token and goes to the real owner', () => {
    const m = accountExistsEmail('owner@example.test', 'https://games.keep');
    expect(m.purpose).toBe('account_exists');
    expect(m.toEmail).toBe('owner@example.test');
    // The whole point: this notice can never carry a redeemable token.
    expect(m.bodyText).not.toContain('token=');
    expect(m.bodyText).toContain('https://games.keep/login');
    expect(m.bodyText).toContain('https://games.keep/reset-password');
  });
});

describe('email: token consume shape gate (I6 Slice 2)', () => {
  it('rejects a malformed token without any DB hit', async () => {
    // Non-64-hex tokens are rejected by the shape gate before touching the DB,
    // so this stays hermetic (no Postgres needed).
    expect(await consumeToken('not-a-token', 'verify_email')).toBeNull();
    expect(await consumeToken('abc123', 'password_reset')).toBeNull();
  });
});

describe('auth: CSRF double-submit check (I6 Slice 3 — shared by admin path)', () => {
  const mk = (cookie?: string, header?: string | string[]): FastifyRequest =>
    ({
      cookies: cookie ? { gk_csrf: cookie } : {},
      headers: header ? { 'x-csrf-token': header } : {},
    }) as unknown as FastifyRequest;

  it('passes only when a present header equals the present cookie', () => {
    const tok = 'ab'.repeat(32);
    expect(csrfOk(mk(tok, tok))).toBe(true);
    expect(csrfOk(mk(tok, 'different'))).toBe(false);
    expect(csrfOk(mk(tok, undefined))).toBe(false); // header missing
    expect(csrfOk(mk(undefined, tok))).toBe(false); // cookie missing
    expect(csrfOk(mk(undefined, undefined))).toBe(false);
  });
});

describe('auth: permission guards deny without a session (I6 Slice 3, no DB)', () => {
  // A request with no session cookie is rejected by the shape gate before any
  // DB hit, so these stay hermetic. The ALLOW paths run live in i6-check.mjs.
  const noCookieReq = () => ({ cookies: {} }) as unknown as FastifyRequest;
  const fakeReply = () => {
    const r = {
      statusCode: 0,
      body: undefined as unknown,
      code(n: number) {
        r.statusCode = n;
        return r;
      },
      send(o: unknown) {
        r.body = o;
        return r;
      },
    };
    return r as unknown as FastifyReply & { statusCode: number; body: { error?: string } };
  };

  it('requireAuth → 401 unauthorized', async () => {
    const reply = fakeReply();
    expect(await requireAuth(noCookieReq(), reply)).toBeNull();
    expect(reply.statusCode).toBe(401);
    expect(reply.body.error).toBe('unauthorized');
  });

  it('requireVerified / requireStaff / requireRole all 401 (auth checked first)', async () => {
    for (const guard of [requireVerified, requireStaff, requireRole(40)]) {
      const reply = fakeReply();
      expect(await guard(noCookieReq(), reply)).toBeNull();
      expect(reply.statusCode).toBe(401);
    }
  });
});

describe('admin: per-section rank map (I6 Slice 3)', () => {
  it('classifies the section from the admin URL', () => {
    expect(sectionOf('/admin/api/games')).toBe('games');
    expect(sectionOf('/admin/api/users/abc-123')).toBe('users');
    expect(sectionOf('/admin/api/relations/topic-subject')).toBe('relations');
    expect(sectionOf('/admin/api/_meta?x=1')).toBe('_meta');
    expect(sectionOf('/admin/api/')).toBe('');
  });

  it('gates identity at owner, moderation at moderator, the rest at admin', () => {
    // privilege/identity — owner only
    expect(SECTION_RANK_DEFAULTS.users).toBe(RANK.owner);
    expect(SECTION_RANK_DEFAULTS.roles).toBe(RANK.owner);
    // content moderation — moderator
    expect(SECTION_RANK_DEFAULTS.topics).toBe(RANK.moderator);
    expect(SECTION_RANK_DEFAULTS.articles).toBe(RANK.moderator);
    // system tuning — admin, NOT moderator: bias weights drive every public
    // number, so bias falls through to admin like ratings/catalog.
    expect(SECTION_RANK_DEFAULTS.bias).toBeUndefined();
    expect(SECTION_RANK_DEFAULTS.games).toBeUndefined();
    expect(DEFAULT_SECTION_RANK).toBe(RANK.admin);
    // the ladder is strictly increasing
    expect(RANK.moderator).toBeLessThan(RANK.admin);
    expect(RANK.admin).toBeLessThan(RANK.owner);
  });
});

describe('crypto: constant-time compare', () => {
  it('matches equal strings, rejects different or partial ones', () => {
    expect(constantTimeEqual('demo-admin-token', 'demo-admin-token')).toBe(true);
    expect(constantTimeEqual('demo-admin-token', 'demo-admin-tokeN')).toBe(false);
    expect(constantTimeEqual('demo-admin-token', 'demo')).toBe(false);
    expect(constantTimeEqual('', 'demo-admin-token')).toBe(false);
  });
});
