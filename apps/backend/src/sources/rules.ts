import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/client';
import { sourceTypes } from '../db/schema';

/**
 * Source data rules (Phase P hygiene 3 → S2). The source type shown publicly as
 * "Standalone" must never be applied to an outlet with a parent company on
 * record (that would claim an owned outlet stands alone). The rule keys on the
 * type's ROLE — a built-in, stable identifier the admin CRUD cannot write — so
 * renaming the type's label OR its key in admin can't detach the rule.
 */
export const STANDALONE_ROLE = 'standalone';
/** The built-in type's historic key (used only to adopt / create it). */
const STANDALONE_LEGACY_KEY = 'independent';

export async function sourceRuleViolation(next: {
  parentCompany?: unknown;
  typeId?: unknown;
}): Promise<string | null> {
  const parent = typeof next.parentCompany === 'string' ? next.parentCompany.trim() : '';
  if (!parent || typeof next.typeId !== 'string' || !next.typeId) return null;
  const [type] = await db
    .select({ role: sourceTypes.role })
    .from(sourceTypes)
    .where(eq(sourceTypes.id, next.typeId))
    .limit(1);
  return type?.role === STANDALONE_ROLE
    ? 'A source with a parent company on record cannot be typed "Standalone".'
    : null;
}

/**
 * Make sure the built-in Standalone type exists and carries its role (every
 * mode, at boot; idempotent). Adopts the historic `independent` row when no row
 * holds the role yet; otherwise creates it. Never changes a row that already has
 * the role.
 */
export async function ensureBuiltinSourceTypes(): Promise<void> {
  const [holder] = await db
    .select({ id: sourceTypes.id })
    .from(sourceTypes)
    .where(eq(sourceTypes.role, STANDALONE_ROLE))
    .limit(1);
  if (holder) return;
  const adopted = await db
    .update(sourceTypes)
    .set({ role: STANDALONE_ROLE, updatedAt: new Date() })
    .where(and(eq(sourceTypes.key, STANDALONE_LEGACY_KEY), isNull(sourceTypes.role)))
    .returning({ id: sourceTypes.id });
  if (adopted.length) return;
  await db
    .insert(sourceTypes)
    .values({ key: STANDALONE_LEGACY_KEY, label: 'Standalone', role: STANDALONE_ROLE })
    .onConflictDoNothing();
}
