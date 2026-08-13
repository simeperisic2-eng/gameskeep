import { describe, expect, it } from 'vitest';
import { PASSWORD_ALGO, hashPassword, verifyPassword } from '../src/auth/password';
import { coarsenIp, hashToken, newCsrfToken } from '../src/auth/session';
import { assertProductionSecrets, trustProxyValue, type Env } from '../src/config/env';
import { constantTimeEqual } from '../src/lib/crypto';

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

describe('crypto: constant-time compare', () => {
  it('matches equal strings, rejects different or partial ones', () => {
    expect(constantTimeEqual('demo-admin-token', 'demo-admin-token')).toBe(true);
    expect(constantTimeEqual('demo-admin-token', 'demo-admin-tokeN')).toBe(false);
    expect(constantTimeEqual('demo-admin-token', 'demo')).toBe(false);
    expect(constantTimeEqual('', 'demo-admin-token')).toBe(false);
  });
});
