import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { sourceTypes } from '../db/schema';

/**
 * Source data rules (Phase P hygiene 3). The source type keyed `independent` is
 * shown publicly as "Standalone" — it must never be applied to an outlet with a
 * parent company on record (that would claim an owned outlet stands alone). The
 * KEY is the rule's anchor, so an admin relabel of the type can't sidestep it.
 */
export const STANDALONE_SOURCE_TYPE_KEY = 'independent';

export async function sourceRuleViolation(next: {
  parentCompany?: unknown;
  typeId?: unknown;
}): Promise<string | null> {
  const parent = typeof next.parentCompany === 'string' ? next.parentCompany.trim() : '';
  if (!parent || typeof next.typeId !== 'string' || !next.typeId) return null;
  const [type] = await db
    .select({ key: sourceTypes.key })
    .from(sourceTypes)
    .where(eq(sourceTypes.id, next.typeId))
    .limit(1);
  return type?.key === STANDALONE_SOURCE_TYPE_KEY
    ? 'A source with a parent company on record cannot be typed "Standalone".'
    : null;
}
