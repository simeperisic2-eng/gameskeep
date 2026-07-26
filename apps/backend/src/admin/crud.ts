import { asc, eq, getTableColumns, type AnyColumn } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { db } from '../db/client';

/**
 * A tiny generic repository over Drizzle tables — the engine behind the admin
 * CRUD. It is deliberately untyped at the row level (rows are validated by Zod
 * at the route boundary and integrity is enforced by DB constraints), which
 * keeps one set of operations working for all ~30 resources. The few casts here
 * are the price of that genericity and are isolated to this file.
 */

export type Row = Record<string, unknown>;

function columnOf(table: PgTable, name: string): AnyColumn {
  const cols = getTableColumns(table) as Record<string, AnyColumn>;
  const col = cols[name];
  if (!col) throw new Error(`column "${name}" not found on table`);
  return col;
}

/** Whether a table has a given column (used to pick a stable sort order). */
export function hasColumn(table: PgTable, name: string): boolean {
  return name in getTableColumns(table);
}

export async function listRows(table: PgTable, limit = 200, offset = 0): Promise<Row[]> {
  const order = hasColumn(table, 'createdAt')
    ? asc(columnOf(table, 'createdAt'))
    : asc(columnOf(table, 'id'));
  const rows = await db.select().from(table).orderBy(order).limit(limit).offset(offset);
  return rows as Row[];
}

export async function getRow(table: PgTable, id: string): Promise<Row | null> {
  const [row] = await db
    .select()
    .from(table)
    .where(eq(columnOf(table, 'id'), id))
    .limit(1);
  return (row as Row | undefined) ?? null;
}

export async function insertRow(table: PgTable, values: Row): Promise<Row> {
  const [row] = await db
    .insert(table)
    .values(values as never)
    .returning();
  return row as Row;
}

export async function updateRow(table: PgTable, id: string, values: Row): Promise<Row | null> {
  if (Object.keys(values).length === 0) return getRow(table, id);
  const [row] = await db
    .update(table)
    .set(values as never)
    .where(eq(columnOf(table, 'id'), id))
    .returning();
  return (row as Row | undefined) ?? null;
}

/** Is a slug already used in this table? (for auto-slug uniqueness). */
export async function slugTaken(table: PgTable, slug: string): Promise<boolean> {
  const [row] = await db
    .select()
    .from(table)
    .where(eq(columnOf(table, 'slug'), slug))
    .limit(1);
  return Boolean(row);
}

export async function deleteRow(table: PgTable, id: string): Promise<Row | null> {
  const [row] = await db
    .delete(table)
    .where(eq(columnOf(table, 'id'), id))
    .returning();
  return (row as Row | undefined) ?? null;
}
