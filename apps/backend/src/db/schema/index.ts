/**
 * GamesKeep DB schema — the six core models (+ generic Subject) and their
 * relations, split by domain for readability and re-exported here as the single
 * Drizzle schema entrypoint (imported by the client and drizzle-kit).
 *
 *   enums      — fixed structural Postgres enums
 *   lookups    — extensible content lists (roles, levels, topic/source types,
 *                badges, award categories) as DATA, not enums
 *   subjects   — the generic entity hub (Game/Studio/Publisher/Platform)
 *   sources    — news outlets + pull/reputation settings
 *   users      — accounts, roles, levels, badges (auth itself is I6)
 *   auth       — server-side sessions + single-use email tokens (I6 Slice 1/2)
 *   email      — outbound email log / dev mailbox (I6 Slice 2)
 *   topics     — stories (top of the news hierarchy) + M2M links + embedding
 *   articles   — aggregated/ours + bias axes + M2M links + embedding
 *   games      — Subject specialization + ratings/review/flags/videos/prices/…
 *   awards     — annual editions → categories → nominations → outcomes/votes
 *   community  — comments/reactions/votes (schema room; logic in I6/I8)
 *   unmatched  — "unmatched game" queue (I2 coverage safety net)
 *   settings   — generic key→JSON app settings (I3 clustering knobs; I8 builds on it)
 *   audit      — immutable staff action log
 */
export * from './enums';
export * from './lookups';
export * from './subjects';
export * from './sources';
export * from './users';
export * from './auth';
export * from './email';
export * from './topics';
export * from './articles';
export * from './games';
export * from './awards';
export * from './community';
export * from './gdpr';
export * from './newsletter';
export * from './unmatched';
export * from './settings';
export * from './audit';
