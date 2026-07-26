import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

/**
 * Shared HTTP helpers for the admin surface — the actor extractor and the
 * error→status mapper. Lives in its own module so both the generic CRUD routes
 * and the catalog routes can use them without a circular import.
 */
export interface Actor {
  label: string;
}

export function actorOf(req: FastifyRequest): Actor {
  const raw = req.headers['x-admin-actor'];
  const label = (Array.isArray(raw) ? raw[0] : raw)?.toString().slice(0, 120) || 'admin';
  return { label };
}

interface PgErrorLike {
  code: string;
  constraint?: string;
  detail?: string;
}

/**
 * Find the underlying Postgres error. Drizzle wraps driver errors in a
 * DrizzleQueryError whose `.cause` carries the real pg error (with its SQLSTATE
 * `code`), so we unwrap a couple of levels.
 */
function findPgError(err: unknown): PgErrorLike | null {
  let current: unknown = err;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (typeof current === 'object' && current !== null && 'code' in current) {
      const code = (current as { code?: unknown }).code;
      if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) {
        return current as PgErrorLike;
      }
    }
    current = (current as { cause?: unknown })?.cause;
  }
  return null;
}

/** Map validation + Postgres integrity errors to clean HTTP responses. */
export function sendError(reply: FastifyReply, err: unknown): void {
  if (err instanceof ZodError) {
    reply.code(400).send({ error: 'validation', issues: err.issues });
    return;
  }
  const e = findPgError(err);
  if (e) {
    const detail = e.constraint ?? e.detail;
    switch (e.code) {
      case '23505':
        reply.code(409).send({
          error: 'conflict',
          message: `Duplicate / unique violation${detail ? `: ${detail}` : ''}`,
        });
        return;
      case '23514':
        reply.code(400).send({
          error: 'check_violation',
          message: `Constraint failed${detail ? `: ${detail}` : ''}`,
        });
        return;
      case '23503':
        reply.code(400).send({
          error: 'foreign_key',
          message: `Related row not found${detail ? `: ${detail}` : ''}`,
        });
        return;
      case '23502':
        reply.code(400).send({
          error: 'not_null',
          message: `Missing required field${detail ? `: ${detail}` : ''}`,
        });
        return;
      case '22P02':
        reply
          .code(400)
          .send({ error: 'invalid_input', message: 'Malformed value (e.g. bad UUID)' });
        return;
    }
  }
  reply
    .code(500)
    .send({ error: 'internal', message: err instanceof Error ? err.message : String(err) });
}
