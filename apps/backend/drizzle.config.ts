import { defineConfig } from 'drizzle-kit';

// The six core models live in src/db/schema/ (re-exported from index.ts).
// `db:generate` diffs this schema to produce SQL migrations under ./drizzle.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url:
      process.env.DATABASE_URL ?? 'postgresql://gameskeep:gameskeep_demo@localhost:5432/gameskeep',
  },
});
