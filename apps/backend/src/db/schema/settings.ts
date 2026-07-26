import { jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import { timestamps } from './_shared';

/**
 * Generic key→JSON app settings (SPEC I3 §3: "everything configurable from
 * admin; no hardcoded thresholds"). I3 stores the clustering knobs
 * (`clustering` key → { similarityThreshold, timeWindowDays }) here so they are
 * durable and admin-editable; every change is audit-logged like any other staff
 * action. The full Settings section of the Control Panel (I8) builds on this
 * same table — no new schema needed there.
 */
export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<Record<string, unknown>>().notNull(),
  ...timestamps(),
});
