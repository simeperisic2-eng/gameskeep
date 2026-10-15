import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { is } from 'drizzle-orm';
import { PgDialect, PgTable, getTableConfig } from 'drizzle-orm/pg-core';
import * as schema from '../src/db/schema';

// Some CHECK constraints are built from shared constants (e.g. the homepage
// section keys). Adding a key without a migration makes the boot seed violate
// the stored constraint (Phase P S4: the "more" section). Guard the bug class:
// every check in the schema must equal the newest migration snapshot.

const META = join(__dirname, '..', 'drizzle', 'meta');
const newest = readdirSync(META)
  .filter((f) => /^\d{4}_snapshot\.json$/.test(f))
  .sort()
  .at(-1)!;
const snapshot = JSON.parse(readFileSync(join(META, newest), 'utf8')) as {
  tables: Record<string, { checkConstraints?: Record<string, { name: string; value: string }> }>;
};
const dialect = new PgDialect();

describe('schema ↔ newest migration snapshot', () => {
  const tables = (Object.values(schema) as unknown[]).filter((v): v is PgTable => is(v, PgTable));
  it('finds the tables', () => {
    expect(tables.length).toBeGreaterThan(20);
  });
  it(`every CHECK constraint matches ${newest} (run drizzle-kit generate after changing one)`, () => {
    const drift: string[] = [];
    for (const t of tables) {
      const cfg = getTableConfig(t);
      const stored =
        snapshot.tables[`${cfg.schema ?? 'public'}.${cfg.name}`]?.checkConstraints ?? {};
      for (const c of cfg.checks) {
        const value = dialect.sqlToQuery(c.value).sql;
        if (stored[c.name]?.value !== value) drift.push(`${cfg.name}.${c.name}`);
      }
    }
    expect(drift).toEqual([]);
  });
});
