import type { Metadata } from 'next';
import { getAwardsArchive, getAwardsCurrent } from '@/lib/public-api';
import { JsonLd } from '@/lib/jsonld';
import { breadcrumbLd } from '@/lib/schema';
import { Breadcrumbs } from '../_components/Breadcrumbs';
import { AwardsSubscribe } from '../_components/AwardsSubscribe';
import { AwardBallot } from '../_components/AwardBallot';
import { AwardCategoryResults } from '../_components/AwardCategoryResults';
import { AdSlot } from '../_components/AdSlot';

export const dynamic = 'force-dynamic';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export const metadata: Metadata = {
  title: 'Awards',
  description:
    'The GamesKeep Awards — an annual program where every nominee shows our deeper analytics (three separated scores + the critic–community disconnect) so voters can actually decide. Critics’ Choice and Community Choice, side by side.',
  alternates: { canonical: `${siteUrl}/awards` },
  openGraph: {
    type: 'website',
    url: `${siteUrl}/awards`,
    title: 'GamesKeep Awards — Critics’ Choice and Community Choice',
    description:
      'An annual awards program with real analytics behind every nominee. Vote in the Community Choice; see it beside the Critics’ Choice.',
  },
  twitter: { card: 'summary_large_image', title: 'GamesKeep Awards' },
};

const fmtDate = (iso: string): string =>
  new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(iso));

export default async function AwardsPage(): Promise<React.JSX.Element> {
  const [view, archive] = await Promise.all([getAwardsCurrent(), getAwardsArchive()]);

  const crumbs = [
    { name: 'Home', url: `${siteUrl}/` },
    { name: 'Awards', url: `${siteUrl}/awards` },
  ];
  const jsonLd = [breadcrumbLd(crumbs)];

  const edition = view?.edition ?? null;
  const isVoting = edition?.phase === 'voting' && !edition.comingSoon;
  const isResults =
    !!edition && !edition.comingSoon && (edition.phase === 'reveal' || edition.phase === 'archive');
  const archiveOthers = archive.filter((a) => !edition || a.year !== edition.year);

  return (
    <>
      <JsonLd data={jsonLd} />

      <div className="gk-container gk-aw">
        <Breadcrumbs
          items={crumbs.map((c) => ({ name: c.name, url: c.url.replace(siteUrl, '') || '/' }))}
        />

        <header className="gk-aw-hero">
          <span className="gk-eyebrow">GamesKeep Awards</span>
          <h1 className="gk-aw-title">
            {edition ? edition.name : 'The GamesKeep Awards'}
            {edition ? null : ''}
          </h1>
          <p className="gk-aw-lede">
            An annual program where every nominee carries <strong>our deeper analytics</strong> —
            three separated scores and the critic–community disconnect — so you can actually decide.{' '}
            <strong>Critics’ Choice</strong> and <strong>Community Choice</strong>, side by side,
            never merged.
          </p>
          {isVoting && edition?.votingClosesAt ? (
            <p className="gk-aw-status is-live">
              <span className="gk-aw-live-dot" aria-hidden="true" /> Voting is open — closes{' '}
              {fmtDate(edition.votingClosesAt)}
            </p>
          ) : null}
        </header>

        {/* ── Coming Soon (default public view; nominees stay hidden until voting) ─
            Honest timing: the year names the GAMES' year, voting follows early the
            next year (the Game Awards / BAFTA / DICE convention). */}
        {!edition || edition.comingSoon ? (
          <section className="gk-aw-soon">
            <div className="gk-aw-soon-card">
              <span className="gk-aw-soon-badge">Coming soon</span>
              <h2 className="gk-aw-soon-title">The first GamesKeep Awards are coming</h2>
              <p className="gk-aw-soon-body">
                {/* [[OWNER-TODO: launch-timing copy. Default = "the best games of
                    {year}" + "voting opens in early {year+1}" (year names the games'
                    year; voting follows the next year). Refine the exact wording/date
                    once the schedule is locked, or wire it to votingOpensAt.]] */}
                {edition
                  ? `They celebrate the best games of ${edition.year}. Voting opens in early ${edition.year + 1}, and the winners — Critics’ Choice and Community Choice — are revealed once voting closes.`
                  : 'Voting opens once the program goes live, with the winners — Critics’ Choice and Community Choice — revealed once voting closes.'}
              </p>
              <div className="gk-aw-soon-sub">
                <h3 className="gk-aw-soon-subtitle">Get notified when it goes live</h3>
                <AwardsSubscribe />
              </div>
              <p className="gk-aw-soon-contact">
                Questions or partnership interest? <a href="/contact">Get in touch</a>.
              </p>
            </div>
          </section>
        ) : null}

        {/* ── Voting (live ballots per category) ───────────────────────────────── */}
        {isVoting && view ? (
          <section className="gk-aw-cats">
            {view.categories.length === 0 ? (
              <p className="gk-section-sub">Categories are being finalised — check back shortly.</p>
            ) : (
              view.categories.map((cat) => (
                <section key={cat.editionCategoryId} className="gk-aw-cat">
                  <div className="gk-aw-cat-head">
                    <h2 className="gk-aw-cat-title">{cat.label}</h2>
                    {cat.sponsor ? (
                      <span className="gk-aw-sponsor">
                        {cat.sponsor.sold ? cat.sponsor.label : 'Sponsor slot'}
                      </span>
                    ) : null}
                  </div>
                  <AwardBallot editionCategoryId={cat.editionCategoryId} nominees={cat.nominees} />
                </section>
              ))
            )}
          </section>
        ) : null}

        {/* ── Results (reveal / archive) ───────────────────────────────────────── */}
        {isResults && view ? (
          <section className="gk-aw-cats">
            {view.categories.map((cat) => (
              <AwardCategoryResults key={cat.editionCategoryId} category={cat} />
            ))}
          </section>
        ) : null}

        {/* ── Archive index (past editions) ────────────────────────────────────── */}
        {archiveOthers.length > 0 ? (
          <section className="gk-aw-archive">
            <h2 className="gk-aw-archive-title">Past winners</h2>
            <ul className="gk-aw-archive-list">
              {archiveOthers.map((a) => (
                <li key={a.year}>
                  <a href={`/awards/${a.year}`}>{a.name}</a>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <div className="gk-aw-foot">
          <AdSlot />
        </div>
      </div>
    </>
  );
}
