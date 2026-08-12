import { Queue, Worker, type Job } from 'bullmq';
import { and, eq, isNotNull } from 'drizzle-orm';
import { queueConnection } from '../queue/connection';
import { redis } from '../redis/client';
import { db } from '../db/client';
import { gameExternalRatings, gamePlayerCounts, gamePrices, games } from '../db/schema';
import { getSteamProvider } from '../data-source/steam';

/**
 * Steam sync job (B2) — the accumulate-our-own-history sweep. In PRODUCTION a
 * repeatable job fetches the CURRENT player count for every tracked game
 * (steam_app_id set) and APPENDS a history row to game_player_counts — that is
 * how SteamCharts-style history exists at all (Steam has no past-players API);
 * ours grows from the day the sweep first runs. It also refreshes the Steam
 * storefront snapshot (price / review %) where available.
 *
 * Standing rules: off the request path (users read stored rows); append-only;
 * ONE FAILING APP NEVER ABORTS THE SWEEP (per-game try/catch, failures
 * counted); the schedule is ARMED ONLY IN PRODUCTION — in demo the processor
 * is registered but dormant and history comes from the seed. No key material
 * is ever logged (the provider guarantees status-only errors).
 */
export const STEAM_QUEUE = 'steam';
export const STEAM_SWEEP_JOB = 'steam-sweep';
export const STEAM_STATE_KEY = 'gameskeep:steam:last-sweep';
/** 30 min — SteamCharts-style granularity without hammering the API. */
export const STEAM_SWEEP_EVERY_MS = 30 * 60 * 1000;

export interface SteamSweepResult {
  tracked: number;
  appended: number;
  storefrontUpdated: number;
  failures: number;
}

export interface SteamSweepState extends SteamSweepResult {
  finishedAt: string;
}

let queue: Queue | null = null;

/** Lazily create the queue so importing this module has no side effects. */
export function getSteamQueue(): Queue {
  if (queue) return queue;
  queue = new Queue(STEAM_QUEUE, { connection: queueConnection() });
  return queue;
}

/**
 * Arm the repeatable sweep — PRODUCTION ONLY (called at worker start; a no-op
 * in demo so the demo never even enqueues). Idempotent via the fixed job id.
 */
export async function armSteamSync(): Promise<boolean> {
  if (getSteamProvider().name !== 'live') return false;
  await getSteamQueue().add(
    STEAM_SWEEP_JOB,
    {},
    {
      repeat: { every: STEAM_SWEEP_EVERY_MS },
      jobId: 'steam-sweep-repeat',
      removeOnComplete: 50,
      removeOnFail: 50,
    },
  );
  return true;
}

/** One full sweep over every tracked game. Exposed for the worker + tests. */
export async function runSteamSweep(): Promise<SteamSweepResult> {
  const provider = getSteamProvider();
  const tracked = await db
    .select({ id: games.id, appId: games.steamAppId })
    .from(games)
    .where(isNotNull(games.steamAppId));

  const result: SteamSweepResult = {
    tracked: tracked.length,
    appended: 0,
    storefrontUpdated: 0,
    failures: 0,
  };

  for (const g of tracked) {
    // Append the current player count — our history accumulates from these.
    try {
      const current = await provider.getCurrentPlayers(g.appId!);
      if (current != null) {
        await db
          .insert(gamePlayerCounts)
          .values({ gameId: g.id, source: 'steam', currentPlayers: current });
        result.appended += 1;
      }
    } catch {
      result.failures += 1; // one failing app never aborts the sweep
    }

    // Refresh the storefront snapshot (price / review %) where available.
    try {
      const snap = await provider.getStorefrontSnapshot(g.appId!);
      if (snap) {
        if (snap.priceCents != null) {
          await db
            .update(gamePrices)
            .set({
              priceCents: snap.priceCents,
              discountPct: snap.discountPct ?? 0,
              isOnSale: (snap.discountPct ?? 0) > 0,
              capturedAt: new Date(),
            })
            .where(and(eq(gamePrices.gameId, g.id), eq(gamePrices.store, 'Steam')));
        }
        if (snap.reviewPositivePct != null) {
          // Only the STEAM row — never clobber metacritic/opencritic entries.
          await db
            .update(gameExternalRatings)
            .set({ sentimentPct: snap.reviewPositivePct, sampleSize: snap.reviewSampleSize })
            .where(
              and(eq(gameExternalRatings.gameId, g.id), eq(gameExternalRatings.kind, 'steam')),
            );
        }
        result.storefrontUpdated += 1;
      }
    } catch {
      result.failures += 1;
    }
  }

  return result;
}

/** Worker that runs sweeps. Registered always; only ever fed in production. */
export function startSteamWorker(): Worker {
  return new Worker(
    STEAM_QUEUE,
    async (_job: Job): Promise<SteamSweepResult> => {
      const result = await runSteamSweep();
      const state: SteamSweepState = { ...result, finishedAt: new Date().toISOString() };
      await redis.set(STEAM_STATE_KEY, JSON.stringify(state));
      return result;
    },
    { connection: queueConnection() },
  );
}

/** Read the last recorded sweep result (readiness/verify observability). */
export async function readSteamSyncState(): Promise<SteamSweepState | null> {
  const raw = await redis.get(STEAM_STATE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SteamSweepState;
  } catch {
    return null;
  }
}
