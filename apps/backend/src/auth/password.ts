import { randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';

/**
 * Password hashing (SPEC I6, locked decision 3) — Argon2id via @node-rs/argon2
 * (prebuilt Rust bindings; no node-gyp pain on Alpine/musl), OWASP parameters.
 * The scheme id is stored per-user in `password_algo` so a future parameter
 * bump can re-hash lazily at the next successful login.
 *
 * SECURITY: a hash is written to the DB and NOWHERE else — never logged, never
 * returned in any payload, redacted from admin CRUD + audit snapshots.
 */

// OWASP Argon2id minimums (2024 cheat-sheet): m=19 MiB, t=2, p=1.
const ARGON2_OPTIONS = {
  memoryCost: 19_456, // KiB ≈ 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

/** Stored in users.password_algo — bump when ARGON2_OPTIONS change. */
export const PASSWORD_ALGO = 'argon2id-19m-t2-p1';

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON2_OPTIONS);
}

export async function verifyPassword(passwordHash: string, plain: string): Promise<boolean> {
  try {
    // NOTE: no options on verify — the PHC string self-describes its params,
    // and passing cost options makes @node-rs/argon2 do extra work (measured
    // ~5× slower), which would also skew the enumeration-timing symmetry.
    return await verify(passwordHash, plain);
  } catch {
    // Malformed/foreign hash — treat as no-match, never throw into a route.
    return false;
  }
}

// ── enumeration-safe timing (I6 hardening) ───────────────────────────────────
// When login hits an unknown identifier (or register hits a taken email), we
// still burn one full Argon2 verify/hash against a throwaway value so the
// response *timing* is indistinguishable from the real-user path.
let dummyHashPromise: Promise<string> | null = null;

function dummyHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = hash(`gk-dummy-${randomBytes(16).toString('hex')}`, ARGON2_OPTIONS);
  }
  return dummyHashPromise;
}

/** Burn a full verify against the dummy hash (always false). Cost equalizer —
 * the EXACT same call shape as verifyPassword, so the paths are symmetric by
 * construction. */
export async function dummyVerify(plain: string): Promise<void> {
  const dh = await dummyHash();
  await verify(dh, plain).catch(() => undefined);
}
