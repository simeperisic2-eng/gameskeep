import { XMLParser } from 'fast-xml-parser';
import { isProduction } from '../../config/env';
import type { ArticlePullOptions, ArticleSourceProvider, RawFeedItem } from './types';
import { SOURCE_BY_SLUG, SOURCE_DEFS, type SourceDef } from './sources';

/**
 * LiveFeedProvider — the PRODUCTION article source: per-source **RSS-first**
 * adapters (BLUEPRINT 2.5 + "Aggregation legal safeguards"). It is FULLY WIRED
 * but DORMANT in demo: the seam only returns it when APP_MODE=production, and
 * every public method first asserts production mode, throwing a clear error
 * instead of touching the network. So in demo it never fetches (SPEC I3 §1;
 * proven by the hermetic test that calls it in demo and expects a throw).
 *
 * RSS-first rationale: when a source publishes a feed it invites feed use — far
 * safer than scraping. We fetch the feed, parse it (RSS 2.0 or Atom), and map to
 * the one RawFeedItem shape; excerpt-only, with attribution + link preserved.
 * Adding a source = one SourceDef entry (or one adapter), nothing else changes.
 *
 * Rate-limit awareness: requests are throttled to a minimum spacing per host and
 * retried with exponential backoff on 429/5xx — never hammer a publisher.
 * [[OWNER-TODO: before enabling live pulls, confirm each source's robots.txt/ToS
 * permits feed use and complete the legal review (esp. EU) — BLUEPRINT safeguards]]
 */

const MIN_INTERVAL_MS = 1000; // gentle: ≤ 1 feed fetch/sec
const MAX_RETRIES = 4;
const USER_AGENT = 'GamesKeepBot/1.0 (+https://gameskeep.com/bot)';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface RawRssItem {
  title?: unknown;
  link?: unknown;
  guid?: unknown;
  description?: unknown;
  summary?: unknown;
  content?: unknown;
  pubDate?: unknown;
  published?: unknown;
  updated?: unknown;
  author?: unknown;
  'dc:creator'?: unknown;
  'media:thumbnail'?: unknown;
  'media:content'?: unknown;
  enclosure?: unknown;
}

/** Pull a plain string out of the many shapes feeds use (string, {#text}, {@_href}, arrays). */
function text(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return text(value[0]);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return text(obj['#text'] ?? obj['@_href'] ?? obj['@_url'] ?? obj['url']);
  }
  return undefined;
}

/** Strip tags/entities from an HTML excerpt and clamp it (excerpt-only, copyright). */
function toExcerpt(html: string | undefined): string | undefined {
  if (!html) return undefined;
  const stripped = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!stripped) return undefined;
  return stripped.slice(0, 600);
}

export class LiveFeedProvider implements ArticleSourceProvider {
  readonly name = 'live' as const;

  private lastCallAt = 0;
  private readonly parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    trimValues: true,
  });

  /** Belt-and-suspenders: demo must never reach the network through this class. */
  private assertLive(): void {
    if (!isProduction()) {
      throw new Error(
        'LiveFeedProvider is dormant in demo: the article feed is the bundled mock ' +
          'dataset and makes no network calls. Set APP_MODE=production to enable live ' +
          'RSS pulls (and complete the robots.txt/ToS review first).',
      );
    }
  }

  listSourceSlugs(): string[] {
    return SOURCE_DEFS.map((s) => s.slug);
  }

  private async fetchFeed(url: string): Promise<string> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      const since = Date.now() - this.lastCallAt;
      if (since < MIN_INTERVAL_MS) await sleep(MIN_INTERVAL_MS - since);
      this.lastCallAt = Date.now();
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/rss+xml, application/xml' },
      });
      if (res.ok) return res.text();
      if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
        await sleep(2 ** attempt * 500);
        continue;
      }
      throw new Error(`RSS fetch failed for ${url}: HTTP ${res.status}`);
    }
    throw new Error(`RSS fetch failed for ${url} after ${MAX_RETRIES} retries`);
  }

  /** Map one parsed feed entry → RawFeedItem (handles RSS 2.0 + Atom shapes). */
  private mapItem(raw: RawRssItem, source: SourceDef): RawFeedItem | null {
    const title = text(raw.title);
    if (!title) return null;
    const link =
      text(raw.link) ?? text((raw as Record<string, unknown>)['@_href']) ?? text(raw.guid);
    const guidText = text(raw.guid) ?? link ?? `${source.slug}:${title}`;
    const excerpt = toExcerpt(text(raw.description) ?? text(raw.summary) ?? text(raw.content));
    const publishedAt = text(raw.pubDate) ?? text(raw.published) ?? text(raw.updated);
    const thumb = text(raw['media:thumbnail']) ?? text(raw['media:content']) ?? text(raw.enclosure);
    const author = text(raw.author) ?? text(raw['dc:creator']);
    return {
      guid: `${source.slug}:${guidText}`.slice(0, 400),
      sourceSlug: source.slug,
      title,
      author,
      url: link,
      thumbnailUrl: thumb,
      excerpt,
      publishedAt: publishedAt ? new Date(publishedAt).toISOString() : undefined,
      // Game refs + factual signals are derived downstream (articles/signals.ts);
      // the live feed rarely tags them explicitly.
      gameRefs: [],
    };
  }

  async pullSource(sourceSlug: string, opts: ArticlePullOptions = {}): Promise<RawFeedItem[]> {
    this.assertLive();
    const source = SOURCE_BY_SLUG.get(sourceSlug);
    if (!source) throw new Error(`Unknown source slug: ${sourceSlug}`);
    const xml = await this.fetchFeed(source.rssUrl);
    const parsed = this.parser.parse(xml) as Record<string, unknown>;

    // RSS 2.0: rss.channel.item[]   |   Atom: feed.entry[]
    const channel = (parsed.rss as { channel?: { item?: unknown } } | undefined)?.channel;
    const atom = parsed.feed as { entry?: unknown } | undefined;
    const rawItems = channel?.item ?? atom?.entry ?? [];
    const list = (Array.isArray(rawItems) ? rawItems : [rawItems]) as RawRssItem[];

    const out: RawFeedItem[] = [];
    for (const raw of list) {
      const item = this.mapItem(raw, source);
      if (item) out.push(item);
      if (typeof opts.limit === 'number' && out.length >= opts.limit) break;
    }
    return out;
  }

  async pullRecent(opts: ArticlePullOptions = {}): Promise<RawFeedItem[]> {
    this.assertLive();
    const out: RawFeedItem[] = [];
    for (const source of SOURCE_DEFS) {
      // One slow/broken feed must not abort the whole pull (anti-bug rule).
      try {
        out.push(...(await this.pullSource(source.slug, opts)));
      } catch {
        // Swallow per-source failures; the pipeline still ingests the rest.
      }
    }
    return out;
  }
}

export const liveFeedProvider = new LiveFeedProvider();
