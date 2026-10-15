import { and, eq, sql } from 'drizzle-orm';
import { isDemo } from '../config/env';
import { db } from '../db/client';
import { games, subjects } from '../db/schema';

/**
 * Demo only (Phase P S4): a few well-known alternate names so search and the
 * name matcher can be tried ("BG3", "GTA VI"). Only fills a game whose list is
 * still empty — an editor's alternate names are never touched.
 */
const DEMO_ALTERNATE_NAMES: Record<string, string[]> = {
  'baldurs-gate-3': ['BG3', "Baldur's Gate III"],
  'grand-theft-auto-vi': ['GTA 6', 'GTA VI', 'GTA6'],
  'the-witcher-3-wild-hunt': ['Witcher 3', 'TW3'],
  'cyberpunk-2077': ['CP2077'],
  'red-dead-redemption-2': ['RDR2'],
  'final-fantasy-xvi': ['FF16', 'FFXVI', 'Final Fantasy 16'],
  'the-legend-of-zelda-tears-of-the-kingdom': ['Tears of the Kingdom', 'TotK', 'Zelda TOTK'],
  'counter-strike-2': ['CS2'],
};

export async function seedDemoAlternateNames(): Promise<number> {
  if (!isDemo()) return 0;
  let set = 0;
  for (const [slug, names] of Object.entries(DEMO_ALTERNATE_NAMES)) {
    const res = await db
      .update(games)
      .set({ alternateNames: names })
      .where(
        and(
          sql`${games.subjectId} = (SELECT ${subjects.id} FROM ${subjects} WHERE ${subjects.slug} = ${slug} AND ${subjects.type} = 'game')`,
          eq(sql`cardinality(${games.alternateNames})`, 0),
        ),
      )
      .returning({ id: games.id });
    set += res.length;
  }
  return set;
}
