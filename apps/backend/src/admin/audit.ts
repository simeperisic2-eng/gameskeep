import type { AuditAction } from '@gameskeep/shared/constants';
import { db } from '../db/client';
import { auditLogs } from '../db/schema';

/**
 * Audit-log groundwork (SPEC I1 §4, CLAUDE.md golden rule). Every create /
 * update / delete through the admin writes an immutable row here with
 * who / what / when / old→new. The full audit UI is I8 — we start writing now.
 */

export type Row = Record<string, unknown>;

export interface AuditActor {
  label: string;
  userId?: string | null;
}

/** Columns that always change or aren't meaningful in a diff. */
const DIFF_NOISE = new Set(['updatedAt', 'createdAt']);

function normalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  return value ?? null;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

/** Per-field { from, to } diff of two DB rows (changed, non-noise fields only). */
export function diffRows(before: Row, after: Row): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if (DIFF_NOISE.has(key)) continue;
    if (!valuesEqual(before[key], after[key])) {
      changes[key] = { from: normalize(before[key]), to: normalize(after[key]) };
    }
  }
  return changes;
}

export async function writeAudit(args: {
  action: AuditAction;
  entityType: string;
  entityId: string;
  changes?: unknown;
  summary?: string;
  actor: AuditActor;
}): Promise<void> {
  await db.insert(auditLogs).values({
    action: args.action,
    entityType: args.entityType,
    entityId: args.entityId,
    changes: (args.changes ?? null) as Row | null,
    summary: args.summary ?? `${args.action} ${args.entityType} ${args.entityId}`,
    actorLabel: args.actor.label,
    actorUserId: args.actor.userId ?? null,
  });
}
