import { and, eq, sql } from 'drizzle-orm';
import type { GameSuggestionInput } from '@gameskeep/shared/validation';
import { db } from '../db/client';
import { unmatchedGames } from '../db/schema';
import { coarsenIp } from '../auth/session';
import { writeAudit } from '../admin/audit';

/**
 * Public "Suggest a missing game" (Upcoming enrichment, decision 3). Files a
 * PENDING row into the existing I2 unmatched-game queue so an editor can review
 * and add it — this path deliberately does NOT call the provider auto-resolver
 * (`resolveOrQueue`), so a public submission can NEVER auto-create/publish a
 * game. Nothing goes live without editor approval. The submitter is not verified
 * (nothing publishes), the input is treated as UGC (validated at the route via
 * `gameSuggestionInput`, stored raw in `rawContext`, rendered escaped in admin),
 * and the write is rate-limited (see `allowSuggest`) + CSRF-gated (at the route).
 */
export async function suggestGame(input: GameSuggestionInput, ip?: string | null): Promise<void> {
  const rawName = (input.name.trim() || '(empty reference)').slice(0, 300);
  const context: Record<string, unknown> = {
    source: 'user-submission',
    submittedVia: 'upcoming-suggest',
    ...(input.platform ? { platform: input.platform } : {}),
    ...(input.note ? { note: input.note } : {}),
    ...(input.url ? { url: input.url } : {}),
    ip: coarsenIp(ip), // GDPR-lean; same coarsening as sessions/consents
  };

  // Dedupe: bump an existing PENDING row instead of stacking duplicates (mirrors
  // resolveOrQueue), so a repeated public suggestion doesn't flood the queue.
  const [pending] = await db
    .select({ id: unmatchedGames.id, attempts: unmatchedGames.attempts })
    .from(unmatchedGames)
    .where(
      and(
        eq(unmatchedGames.status, 'pending'),
        sql`lower(${unmatchedGames.rawName}) = ${rawName.toLowerCase()}`,
      ),
    )
    .limit(1);

  if (pending) {
    const attempts = (pending.attempts ?? 0) + 1;
    await db
      .update(unmatchedGames)
      .set({ attempts, lastTriedAt: new Date(), rawContext: context })
      .where(eq(unmatchedGames.id, pending.id));
    await writeAudit({
      action: 'update',
      entityType: 'unmatched-games',
      entityId: pending.id,
      changes: { attempts: { from: pending.attempts, to: attempts } },
      summary: `public suggestion re-queued "${rawName}" (attempt ${attempts})`,
      actor: { label: 'public: game-suggestion' },
    });
    return;
  }

  const [created] = await db
    .insert(unmatchedGames)
    .values({
      rawName,
      rawContext: context,
      status: 'pending',
      attempts: 1,
      lastTriedAt: new Date(),
    })
    .returning({ id: unmatchedGames.id });
  if (created) {
    await writeAudit({
      action: 'create',
      entityType: 'unmatched-games',
      entityId: created.id,
      changes: { created: { rawName, source: 'user-submission' } },
      summary: `public suggestion filed "${rawName}" (pending review)`,
      actor: { label: 'public: game-suggestion' },
    });
  }
}

/**
 * Rate limit for the public suggest form (a sliding per-IP window + a global
 * cap). In-memory (single backend process in demo). CAVEAT: browser submissions
 * arrive via the frontend BFF, which does NOT forward the client IP (anti-spoof),
 * so per-IP granularity collapses to the frontend's IP — this then acts as a
 * global throttle. Since nothing publishes without editor approval, the risk is
 * queue-flooding (an editor dismisses junk), not a security breach.
 * [[OWNER-TODO: in production, put a trusted reverse proxy in front and forward
 * the real client IP (TRUST_PROXY) so this becomes a true per-client limit.]]
 */
const PER_IP_MAX = 5; // suggestions per IP per window
const GLOBAL_MAX = 60; // suggestions across all IPs per window
const WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const hits = new Map<string, number[]>();
let globalHits: number[] = [];

export function allowSuggest(ip?: string | null): boolean {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  globalHits = globalHits.filter((t) => t > cutoff);
  if (globalHits.length >= GLOBAL_MAX) return false;

  const key = coarsenIp(ip) ?? 'unknown';
  const recent = (hits.get(key) ?? []).filter((t) => t > cutoff);
  if (recent.length >= PER_IP_MAX) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  globalHits.push(now);
  return true;
}
