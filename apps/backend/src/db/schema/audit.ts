import { index, jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { auditActionEnum } from './enums';
import { users } from './users';
import { primaryId } from './_shared';

/**
 * Audit log — every staff action recorded immutably (who/what/when/old→new),
 * a CLAUDE.md golden rule. Append-only: the app never updates or deletes rows
 * here. The full audit UI is I8; we start WRITING here in I1 (cheap now,
 * painful to retrofit). `changes` holds a per-field { from, to } diff.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: primaryId(),
    // Nullable + a denormalized label so the trail survives user deletion.
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    actorLabel: varchar('actor_label', { length: 120 }).notNull().default('admin'),
    action: auditActionEnum('action').notNull(),
    entityType: varchar('entity_type', { length: 80 }).notNull(),
    entityId: varchar('entity_id', { length: 80 }).notNull(),
    /** Per-field diff: { field: { from, to } } (create/delete store the snapshot). */
    changes: jsonb('changes'),
    summary: text('summary'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_logs_entity_idx').on(t.entityType, t.entityId),
    index('audit_logs_created_idx').on(t.createdAt),
  ],
);
