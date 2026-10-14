import { and, eq } from 'drizzle-orm';
import type { CurationList, CurationPage } from '@gameskeep/shared/constants';
import { db } from '../db/client';
import { curation } from '../db/schema';

/**
 * Editor curation of the computed lists (Phase P S3b — every list we publish is
 * curatable): for (page kind, page, list) an editor sets PINS (shown first, in
 * order) and EXCLUDES (never shown); the automatic list fills the rest. Keys are
 * slugs (stories, games) or source slugs (coverage rows).
 */
export interface Curation {
  pins: string[];
  excludes: string[];
}
export const NO_CURATION: Curation = { pins: [], excludes: [] };

export async function curationFor(
  pageKind: CurationPage,
  pageKey: string,
  listKey: CurationList,
): Promise<Curation> {
  try {
    const [row] = await db
      .select({ pins: curation.pins, excludes: curation.excludes })
      .from(curation)
      .where(
        and(
          eq(curation.pageKind, pageKind),
          eq(curation.pageKey, pageKey),
          eq(curation.listKey, listKey),
        ),
      )
      .limit(1);
    return row ? { pins: row.pins ?? [], excludes: row.excludes ?? [] } : NO_CURATION;
  } catch {
    return NO_CURATION;
  }
}

/** Every curation row of one list kind for a page kind (e.g. coverage rows of all stories). */
export async function curationsOf(
  pageKind: CurationPage,
  listKey: CurationList,
): Promise<Map<string, Curation>> {
  const rows = await db
    .select({ key: curation.pageKey, pins: curation.pins, excludes: curation.excludes })
    .from(curation)
    .where(and(eq(curation.pageKind, pageKind), eq(curation.listKey, listKey)));
  return new Map(rows.map((r) => [r.key, { pins: r.pins ?? [], excludes: r.excludes ?? [] }]));
}

/**
 * Pins first (in their order, when they resolve — from \`pinned\` or the automatic
 * list), then the automatic list minus excluded + already pinned, cut to \`size\`.
 * Pure; unit-tested.
 */
export function curateList<T>(
  auto: T[],
  keyOf: (t: T) => string,
  cur: Curation,
  size: number,
  pinned: Map<string, T> = new Map(),
): T[] {
  const ex = new Set(cur.excludes);
  const out: T[] = [];
  const seen = new Set<string>();
  const byKey = new Map(auto.map((t) => [keyOf(t), t]));
  for (const k of cur.pins) {
    if (out.length >= size) break;
    if (ex.has(k) || seen.has(k)) continue;
    const t = pinned.get(k) ?? byKey.get(k);
    if (!t) continue;
    out.push(t);
    seen.add(k);
  }
  for (const t of auto) {
    if (out.length >= size) break;
    const k = keyOf(t);
    if (ex.has(k) || seen.has(k)) continue;
    out.push(t);
    seen.add(k);
  }
  return out;
}
