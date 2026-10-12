import { index, pgTable, text, varchar } from 'drizzle-orm/pg-core';
import { subjectTypeEnum } from './enums';
import { primaryId, timestamps } from './_shared';

/**
 * Subject — the generic entity at the centre of the many-to-many graph
 * (BLUEPRINT 1.4). Types: Game / Studio / Publisher / Platform. Only Game is
 * populated for now; the rest are future expansion with no refactor needed.
 *
 * A Game is a Subject *specialization*: a `subjects` row (type='game') plus a
 * `games` row keyed by subject_id (see games.ts). Topics and Articles always
 * link to `subjects`, so they automatically work for studios/publishers later.
 */
export const subjects = pgTable(
  'subjects',
  {
    id: primaryId(),
    type: subjectTypeEnum('type').notNull(),
    slug: varchar('slug', { length: 160 }).notNull().unique(),
    name: varchar('name', { length: 300 }).notNull(),
    description: text('description'),
    ...timestamps(),
  },
  (t) => [index('subjects_type_idx').on(t.type)],
);
