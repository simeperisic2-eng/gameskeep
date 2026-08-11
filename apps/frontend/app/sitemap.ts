import type { MetadataRoute } from 'next';
import { getSitemapGames, getSitemapSources, getSitemapTopics } from '@/lib/public-api';

/**
 * Auto-generated sitemap.xml (SPEC I5a/I5b SEO). Content changes constantly, so
 * this is rendered per request from the live topic + game + source sets (the
 * pages that actually exist), plus the stable catalog/upcoming/sources hubs. Only
 * real, indexable routes are listed; remaining "coming soon" placeholders are
 * omitted until they ship. robots.txt points crawlers here.
 */
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [topics, games, sources] = await Promise.all([
    getSitemapTopics(),
    getSitemapGames(),
    getSitemapSources(),
  ]);
  const now = new Date();

  const entries: MetadataRoute.Sitemap = [
    { url: `${siteUrl}/`, lastModified: now, changeFrequency: 'hourly', priority: 1 },
    // Stable browse hubs (discovery, the paginated catalog, upcoming, sources).
    { url: `${siteUrl}/games`, lastModified: now, changeFrequency: 'daily', priority: 0.8 },
    { url: `${siteUrl}/games/browse`, lastModified: now, changeFrequency: 'daily', priority: 0.7 },
    { url: `${siteUrl}/upcoming`, lastModified: now, changeFrequency: 'daily', priority: 0.7 },
    { url: `${siteUrl}/sources`, lastModified: now, changeFrequency: 'weekly', priority: 0.6 },
  ];
  for (const t of topics) {
    entries.push({
      url: `${siteUrl}/topics/${t.slug}`,
      lastModified: t.lastModified ? new Date(t.lastModified) : now,
      changeFrequency: 'daily',
      priority: 0.7,
    });
  }
  for (const g of games) {
    entries.push({
      url: `${siteUrl}/games/${g.slug}`,
      lastModified: g.lastModified ? new Date(g.lastModified) : now,
      changeFrequency: 'weekly',
      priority: 0.6,
    });
  }
  for (const s of sources) {
    entries.push({
      url: `${siteUrl}/sources/${s.slug}`,
      lastModified: s.lastModified ? new Date(s.lastModified) : now,
      changeFrequency: 'weekly',
      priority: 0.5,
    });
  }
  return entries;
}
