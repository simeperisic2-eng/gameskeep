import type { Metadata } from 'next';
import { getUpcoming, type UpcomingDlcEntry } from '@/lib/public-api';
import { JsonLd } from '@/lib/jsonld';
import { breadcrumbLd, gameCollectionLd } from '@/lib/schema';
import { Breadcrumbs } from '../_components/Breadcrumbs';
import { UpcomingCard } from '../_components/UpcomingCard';
import { SuggestGameForm } from '../_components/SuggestGameForm';
import { AdSlot } from '../_components/AdSlot';

// Countdowns are computed at render — force-dynamic so they're always current
// (and crawlers get the full slate as real HTML).
export const dynamic = 'force-dynamic';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export const metadata: Metadata = {
  title: 'Upcoming games',
  description:
    'The upcoming games slate on GamesKeep — release dates, live countdowns and status, plus upcoming DLC & expansions and just-released titles. Suggest a missing game.',
  alternates: { canonical: `${siteUrl}/upcoming` },
  openGraph: {
    type: 'website',
    url: `${siteUrl}/upcoming`,
    title: 'Upcoming games',
    description:
      'Release dates, countdowns and status for games on the horizon — plus upcoming DLC & expansions and just-released titles.',
  },
  twitter: { card: 'summary_large_image', title: 'Upcoming games' },
};

type SP = Promise<{ genre?: string; platform?: string; indie?: string }>;

/** Build an /upcoming URL with a filter changed (A1-style; omits empty params). */
function filterUrl(
  base: { genre: string | null; platform: string | null; indie: boolean },
  change: Partial<{ genre: string | null; platform: string | null; indie: boolean }>,
): string {
  const next = { ...base, ...change };
  const qs = new URLSearchParams();
  if (next.genre) qs.set('genre', next.genre);
  if (next.platform) qs.set('platform', next.platform);
  if (next.indie) qs.set('indie', '1');
  const s = qs.toString();
  return s ? `/upcoming?${s}` : '/upcoming';
}

function dlcDate(iso: string | null): string {
  if (!iso) return 'Date TBA';
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(d.getTime())
    ? d.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'UTC',
      })
    : iso;
}

function DlcRow({ dlc }: { dlc: UpcomingDlcEntry }): React.JSX.Element {
  const price =
    dlc.priceCents == null
      ? null
      : dlc.priceCents === 0
        ? 'Free'
        : new Intl.NumberFormat('en-US', { style: 'currency', currency: dlc.currency }).format(
            dlc.priceCents / 100,
          );
  return (
    <li className="gk-dlc-row">
      <div className="gk-dlc-main">
        <span className="gk-dlc-name">{dlc.name}</span>
        <span className="gk-dlc-parent">
          for <a href={`/games/${dlc.parentSlug}`}>{dlc.parentName}</a>
        </span>
      </div>
      <div className="gk-dlc-meta">
        {price ? <span className="gk-dlc-price">{price}</span> : null}
        <span className="gk-dlc-date">{dlcDate(dlc.releaseDate)}</span>
      </div>
    </li>
  );
}

export default async function UpcomingPage({
  searchParams,
}: {
  searchParams: SP;
}): Promise<React.JSX.Element> {
  const sp = await searchParams;
  const indieOn = sp.indie === '1' || sp.indie === 'true';
  const data = await getUpcoming({ genre: sp.genre, platform: sp.platform, indie: indieOn });
  const { games, dlc, newReleases, genres, platforms, newWindowDays, filters } = data;
  const dated = games.filter((g) => g.releaseDate).length;
  const filtersActive = Boolean(filters.genre || filters.platform || filters.indie);

  const crumbs = [
    { name: 'Home', url: `${siteUrl}/` },
    { name: 'Upcoming', url: `${siteUrl}/upcoming` },
  ];
  const jsonLd: Record<string, unknown>[] = [
    breadcrumbLd(crumbs),
    gameCollectionLd(games, { name: 'Upcoming games', url: `${siteUrl}/upcoming`, siteUrl }),
  ];

  return (
    <>
      <JsonLd data={jsonLd} />

      <div className="gk-container gk-catalog">
        <Breadcrumbs
          items={crumbs.map((c) => ({ name: c.name, url: c.url.replace(siteUrl, '') || '/' }))}
        />

        <header className="gk-catalog-head">
          <div>
            <span className="gk-eyebrow">What&apos;s next</span>
            <h1 className="gk-catalog-title">Upcoming games</h1>
            <p className="gk-section-sub">
              The slate on the horizon — release dates, live countdowns and status. Plus upcoming
              DLC &amp; expansions and what just landed. Hype voting arrives with accounts.
            </p>
          </div>
          <span className="gk-catalog-count">
            <b>{games.length}</b> {games.length === 1 ? 'title' : 'titles'}
            {dated > 0 ? <span className="gk-catalog-count-of"> · {dated} dated</span> : null}
          </span>
        </header>

        {/* Filters — reuse the A1 filter model (genre / platform) + indie. */}
        {(genres.length > 0 || platforms.length > 0) && (
          <div className="gk-upfilters" aria-label="Filter upcoming games">
            <div className="gk-upfilter-group">
              <span className="gk-upfilter-label">Genre</span>
              {genres.slice(0, 8).map((g) => {
                const on = filters.genre === g.toLowerCase();
                return (
                  <a
                    key={g}
                    className={`gk-chip gk-chip-link${on ? ' is-on' : ''}`}
                    href={filterUrl(filters, { genre: on ? null : g.toLowerCase() })}
                  >
                    {g}
                  </a>
                );
              })}
            </div>
            <div className="gk-upfilter-group">
              <span className="gk-upfilter-label">Platform</span>
              {platforms.slice(0, 6).map((p) => {
                const on = filters.platform === p.toLowerCase();
                return (
                  <a
                    key={p}
                    className={`gk-chip ghost gk-chip-link${on ? ' is-on' : ''}`}
                    href={filterUrl(filters, { platform: on ? null : p.toLowerCase() })}
                  >
                    {p}
                  </a>
                );
              })}
            </div>
            <div className="gk-upfilter-group">
              <a
                className={`gk-chip gk-chip-link gk-chip-indie${filters.indie ? ' is-on' : ''}`}
                href={filterUrl(filters, { indie: !filters.indie })}
              >
                Indie only
              </a>
              {filtersActive ? (
                <a className="gk-upfilter-clear" href="/upcoming">
                  Clear
                </a>
              ) : null}
            </div>
          </div>
        )}

        {/* ── Upcoming games ─────────────────────────────────────────────── */}
        <section className="gk-upsection">
          <h2 className="gk-upsection-title">Upcoming games</h2>
          {games.length > 0 ? (
            <div className="gk-upcoming-grid">
              {games.map((g) => (
                <UpcomingCard key={g.slug} game={g} />
              ))}
            </div>
          ) : (
            <div className="gk-catalog-empty">
              <p className="gk-section-sub" style={{ margin: 0 }}>
                {filtersActive
                  ? 'No upcoming titles match these filters. '
                  : 'No upcoming titles are lined up right now — check back as new games are announced.'}
                {filtersActive ? <a href="/upcoming">Clear filters</a> : null}
              </p>
            </div>
          )}
        </section>

        {/* ── Upcoming DLC & expansions ──────────────────────────────────── */}
        {dlc.length > 0 && (
          <section className="gk-upsection">
            <h2 className="gk-upsection-title">Upcoming DLC &amp; expansions</h2>
            <p className="gk-section-sub gk-upsection-sub">
              Add-ons and expansions coming to games already in the catalog.
            </p>
            <ul className="gk-dlc-list">
              {dlc.map((d) => (
                <DlcRow key={d.id} dlc={d} />
              ))}
            </ul>
          </section>
        )}

        {/* ── New (recently released) ────────────────────────────────────── */}
        {newReleases.length > 0 && (
          <section className="gk-upsection">
            <h2 className="gk-upsection-title">
              New{' '}
              <span className="gk-upsection-hint">· released in the last {newWindowDays} days</span>
            </h2>
            <div className="gk-upcoming-grid">
              {newReleases.map((g) => (
                <UpcomingCard key={g.slug} game={g} />
              ))}
            </div>
          </section>
        )}

        {/* ── Suggest a game (free) + Promote (paid) ─────────────────────── */}
        <section className="gk-upsection gk-upsuggest">
          <div className="gk-upsuggest-grid">
            <div className="gk-panel gk-upsuggest-card">
              <h2 className="gk-upsuggest-title">Suggest a missing game</h2>
              <SuggestGameForm />
            </div>
            <div className="gk-panel gk-upsuggest-card gk-upsuggest-promote">
              <h2 className="gk-upsuggest-title">Making a game?</h2>
              <p className="gk-section-sub" style={{ marginTop: 0 }}>
                We run clearly-labeled <strong>Promoted</strong> placements — the same transparency
                we hold everyone to. Arrange one by email; nothing is self-serve.
              </p>
              <a className="gk-doc-cta" href="/promote">
                Promote your game →
              </a>
            </div>
          </div>
        </section>

        <div className="gk-catalog-foot">
          <AdSlot slotKey="upcoming" />
        </div>
      </div>
    </>
  );
}
