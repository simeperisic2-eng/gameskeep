import { isDemo } from '../config/env';
import { seedDemoLists } from '../lists/service';
import { requestConsensus } from '../lists/jobs';
import { seedDemoAlternateNames } from '../search/demo';
import { requestSearchRefresh } from '../search/jobs';

/**
 * The Phase P S4 demo seed (mock lists + alternate names). It needs the catalog
 * games and the outlets, which a FRESH volume only has after the background
 * catalog import and the first ingest — so it runs at boot AND after each of
 * those jobs (idempotent; a list is only seeded once all its games exist).
 */
export async function seedS4Demo(
  reason: string,
): Promise<{ lists: number; alternateNames: number }> {
  if (!isDemo()) return { lists: 0, alternateNames: 0 };
  const lists = await seedDemoLists();
  const alternateNames = await seedDemoAlternateNames();
  if (lists > 0) await requestConsensus(`demo-${reason}`);
  if (alternateNames > 0) await requestSearchRefresh(`demo-${reason}`);
  return { lists, alternateNames };
}
