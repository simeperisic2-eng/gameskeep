/**
 * Set (or reset) a user's password from the command line (SPEC I6, Slice 3 —
 * "the owner password is set here; the seed admin has none by design").
 *
 * The demo boots with ZERO secrets: the seeded `admin` account (role: owner)
 * has NO password, so it cannot be logged into until an operator sets one here.
 * This tool is the ONLY place a real password enters the system, and it never
 * lets that password touch source, logs, or the process table:
 *
 *   • Interactive (default): prompts twice with terminal echo OFF.
 *   • Non-interactive: reads $OWNER_PASSWORD (for CI/automation only).
 *
 * The plaintext is Argon2id-hashed (the same `hashPassword` the login path
 * uses) and only the hash is written; the account is marked email-verified and
 * ALL its existing sessions are revoked (a password change invalidates old
 * logins — decision 1). The password and the hash are NEVER printed.
 *
 * Run inside the backend container (it has DB access + the Rust argon2 binding):
 *
 *   docker compose exec backend npx tsx src/scripts/set-owner-password.ts
 *   docker compose exec backend npx tsx src/scripts/set-owner-password.ts --username admin
 *
 * Non-interactive (avoid in a shared shell — the value lands in history/env):
 *
 *   docker compose exec -e OWNER_PASSWORD=... backend \
 *     npx tsx src/scripts/set-owner-password.ts --username admin
 */
import { createInterface } from 'node:readline';
import { eq, sql } from 'drizzle-orm';
import { db, pool } from '../db/client';
import { roles, sessions, users } from '../db/schema';
import { PASSWORD_ALGO, hashPassword } from '../auth/password';

const MIN_LENGTH = 8; // matches the register/reset validation floor

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

/** Prompt with terminal echo suppressed so the password never appears on screen. */
function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // Mute the output stream while the answer is typed.
    const out = process.stdout as NodeJS.WriteStream & { write: (s: string) => boolean };
    const realWrite = out.write.bind(out);
    let muted = false;
    out.write = ((chunk: string) => (muted ? true : realWrite(chunk))) as typeof out.write;
    process.stdout.write(question);
    muted = true;
    rl.question('', (answer) => {
      muted = false;
      out.write = realWrite;
      process.stdout.write('\n');
      rl.close();
      resolve(answer);
    });
  });
}

async function readPassword(): Promise<string> {
  const fromEnv = process.env.OWNER_PASSWORD;
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
  if (!process.stdin.isTTY) {
    throw new Error('No TTY and $OWNER_PASSWORD is unset — cannot read a password.');
  }
  const first = await promptHidden('New password: ');
  const second = await promptHidden('Confirm password: ');
  if (first !== second) throw new Error('Passwords did not match.');
  return first;
}

async function main(): Promise<void> {
  const username = argValue('--username') ?? 'admin';

  const [target] = await db
    .select({
      id: users.id,
      username: users.username,
      roleKey: roles.key,
      isStaff: roles.isStaff,
    })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(sql`lower(${users.username}) = ${username.toLowerCase()}`)
    .limit(1);

  if (!target) {
    throw new Error(`No user with username "${username}".`);
  }

  const password = await readPassword();
  if (password.length < MIN_LENGTH) {
    throw new Error(`Password must be at least ${MIN_LENGTH} characters.`);
  }

  const passwordHash = await hashPassword(password);
  await db
    .update(users)
    .set({ passwordHash, passwordAlgo: PASSWORD_ALGO, isEmailVerified: true })
    .where(eq(users.id, target.id));

  // A password (re)set invalidates every existing login for that account.
  const revoked = await db
    .delete(sessions)
    .where(eq(sessions.userId, target.id))
    .returning({ id: sessions.id });

  // Never print the password or the hash — only the outcome.
  process.stdout.write(
    `✓ Password set for "${target.username}" (role: ${target.roleKey}${target.isStaff ? ', staff' : ''}). ` +
      `${revoked.length} existing session(s) revoked.\n`,
  );
  if (!target.isStaff) {
    process.stdout.write(
      '  Note: this account is NOT staff — it cannot reach the admin surface.\n',
    );
  }
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    process.stderr.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
    await pool.end().catch(() => undefined);
    process.exit(1);
  });
