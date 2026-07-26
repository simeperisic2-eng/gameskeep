import { boolean, integer, pgTable, real, text, uuid, varchar } from 'drizzle-orm/pg-core';
import { sourceStatusEnum } from './enums';
import { sourceTypes } from './lookups';
import { primaryId, timestamps } from './_shared';

/**
 * Source — a news outlet we aggregate (BLUEPRINT 2.5). RSS-first: each source
 * has an adapter that normalizes its feed to one Article shape (adapters land
 * in I3). Reputation baselines are mild and update dynamically later (I4);
 * stats (stat_*) are derived and filled by background jobs in later phases.
 */
export const sources = pgTable('sources', {
  id: primaryId(),
  slug: varchar('slug', { length: 160 }).notNull().unique(),
  name: varchar('name', { length: 300 }).notNull(),
  logoUrl: text('logo_url'),
  websiteUrl: text('website_url'),
  rssUrl: text('rss_url'),
  description: text('description'),
  // Extensible source type (mainstream/independent/industry/blog) — keep the
  // source even if its type is deleted from the lookup.
  typeId: uuid('type_id').references(() => sourceTypes.id, { onDelete: 'set null' }),
  parentCompany: varchar('parent_company', { length: 200 }),
  status: sourceStatusEnum('status').notNull().default('active'),

  // --- pull settings (admin-configurable) ---
  adapterKey: varchar('adapter_key', { length: 80 }).notNull().default('rss-generic'),
  pullFrequencyMinutes: integer('pull_frequency_minutes').notNull().default(60),
  pullDepth: integer('pull_depth').notNull().default(25),
  pullEnabled: boolean('pull_enabled').notNull().default(true),

  // --- reputation baselines (0..1; updated dynamically in I4) ---
  reputationBaseline: real('reputation_baseline'),
  reputationCommercial: real('reputation_commercial'),
  reputationGeneral: real('reputation_general'),

  // --- derived public stats (filled by jobs later) ---
  statArticleCount: integer('stat_article_count'),
  statAffiliatePct: real('stat_affiliate_pct'),
  statAvgTrust: real('stat_avg_trust'),

  ...timestamps(),
});
