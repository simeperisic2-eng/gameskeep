/**
 * Deterministic slugify — lowercase, ASCII-folded, hyphen-separated, capped at
 * the DB column length (subjects.slug varchar(160)). Shared so the admin
 * registry, the catalog importer and the resolve path all derive the SAME slug
 * for a given name, which is what makes catalog upserts idempotent.
 *
 * NFKD decomposes accented letters into a base char + combining mark; the
 * non-alphanumeric replace then drops the marks, so "Pokémon" → "pokemon".
 */
export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160);
  return slug || 'item';
}
