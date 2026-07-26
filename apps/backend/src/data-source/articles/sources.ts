/**
 * The 10 initial sources (BLUEPRINT 2.5) — the single definition shared by the
 * demo seed (ensures the source rows exist so articles can attach) and the live
 * RSS adapters (the feed URL + how to parse it). Chosen for spectrum: mainstream
 * bias contrast (IGN, Polygon), independent poles (Eurogamer, RPS), PC/hardware
 * (PC Gamer), industry/business (GamesIndustry.biz).
 *
 * RSS-first (BLUEPRINT "Aggregation legal safeguards"): every source below
 * publishes an RSS/Atom feed, which is far safer than scraping. The `rssUrl`
 * values are the publicly-advertised feed endpoints.
 * [[OWNER-TODO: confirm each RSS URL + each source's robots.txt/ToS permits feed
 * use before enabling live pulls in production (legal review, esp. EU)]]
 */
export interface SourceDef {
  slug: string;
  name: string;
  /** Lookup key in the `source_types` table (mainstream/independent/industry/blog). */
  typeKey: 'mainstream' | 'independent' | 'industry' | 'blog';
  websiteUrl: string;
  rssUrl: string;
  parentCompany?: string;
  /** Which live adapter parses this feed (all RSS in demo's 10). */
  adapterKey: string;
}

export const SOURCE_DEFS: SourceDef[] = [
  {
    slug: 'ign',
    name: 'IGN',
    typeKey: 'mainstream',
    websiteUrl: 'https://www.ign.com',
    rssUrl: 'https://feeds.ign.com/ign/games-all',
    parentCompany: 'Ziff Davis',
    adapterKey: 'rss-generic',
  },
  {
    slug: 'eurogamer',
    name: 'Eurogamer',
    typeKey: 'independent',
    websiteUrl: 'https://www.eurogamer.net',
    rssUrl: 'https://www.eurogamer.net/feed',
    parentCompany: 'IGN Entertainment',
    adapterKey: 'rss-generic',
  },
  {
    slug: 'gamespot',
    name: 'GameSpot',
    typeKey: 'mainstream',
    websiteUrl: 'https://www.gamespot.com',
    rssUrl: 'https://www.gamespot.com/feeds/news/',
    parentCompany: 'Fandom',
    adapterKey: 'rss-generic',
  },
  {
    slug: 'polygon',
    name: 'Polygon',
    typeKey: 'mainstream',
    websiteUrl: 'https://www.polygon.com',
    rssUrl: 'https://www.polygon.com/rss/index.xml',
    parentCompany: 'Vox Media',
    adapterKey: 'rss-generic',
  },
  {
    slug: 'pc-gamer',
    name: 'PC Gamer',
    typeKey: 'mainstream',
    websiteUrl: 'https://www.pcgamer.com',
    rssUrl: 'https://www.pcgamer.com/rss/',
    parentCompany: 'Future plc',
    adapterKey: 'rss-generic',
  },
  {
    slug: 'rock-paper-shotgun',
    name: 'Rock Paper Shotgun',
    typeKey: 'independent',
    websiteUrl: 'https://www.rockpapershotgun.com',
    rssUrl: 'https://www.rockpapershotgun.com/feed',
    parentCompany: 'IGN Entertainment',
    adapterKey: 'rss-generic',
  },
  {
    slug: 'kotaku',
    name: 'Kotaku',
    typeKey: 'mainstream',
    websiteUrl: 'https://kotaku.com',
    rssUrl: 'https://kotaku.com/rss',
    parentCompany: 'G/O Media',
    adapterKey: 'rss-generic',
  },
  {
    slug: 'vg247',
    name: 'VG247',
    typeKey: 'mainstream',
    websiteUrl: 'https://www.vg247.com',
    rssUrl: 'https://www.vg247.com/feed',
    parentCompany: 'IGN Entertainment',
    adapterKey: 'rss-generic',
  },
  {
    slug: 'gamesradar',
    name: 'GamesRadar+',
    typeKey: 'mainstream',
    websiteUrl: 'https://www.gamesradar.com',
    rssUrl: 'https://www.gamesradar.com/rss/',
    parentCompany: 'Future plc',
    adapterKey: 'rss-generic',
  },
  {
    slug: 'gamesindustry-biz',
    name: 'GamesIndustry.biz',
    typeKey: 'industry',
    websiteUrl: 'https://www.gamesindustry.biz',
    rssUrl: 'https://www.gamesindustry.biz/feed',
    parentCompany: 'IGN Entertainment',
    adapterKey: 'rss-generic',
  },
];

export const SOURCE_SLUGS: string[] = SOURCE_DEFS.map((s) => s.slug);
export const SOURCE_BY_SLUG = new Map(SOURCE_DEFS.map((s) => [s.slug, s]));
