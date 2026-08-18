import type { Metadata } from 'next';
import { DocPage } from '../_components/DocPage';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

// [[OWNER-TODO: review/refine the About copy in brand voice before public launch]]
export const metadata: Metadata = {
  title: 'About',
  description:
    'GamesKeep exists to make games coverage legible — surfacing bias, media influence and the gap between critics and players, so you can judge for yourself. Transparency, not authority.',
  alternates: { canonical: `${siteUrl}/about` },
  openGraph: {
    type: 'website',
    url: `${siteUrl}/about`,
    title: 'About GamesKeep — transparency, not authority',
    description:
      'Why GamesKeep exists: a tool to read games coverage with a bias lens and honest, separated ratings — not another site telling you what is good.',
  },
  twitter: { card: 'summary_large_image', title: 'About GamesKeep' },
};

export default function AboutPage(): React.JSX.Element {
  return (
    <DocPage
      eyebrow="Why we exist"
      title="Transparency, not authority"
      lede="GamesKeep is a tool to judge games coverage for yourself — not a judge. We surface bias, ownership and the gap between critics and players, then hand you the context and get out of the way."
      crumbLabel="About"
      crumbPath="/about"
    >
      <h2>The problem</h2>
      <p>
        Players increasingly distrust rating sites and games media — and often for good reason.
        Scores arrive with no visible reasoning. Outlets that share an owner run suspiciously
        similar takes. A game the critics adore lands at a fraction of the community score, and
        nobody explains the gap. The information is out there, scattered across a dozen sites, but
        the <strong>context</strong> — who is telling you this, what shapes their coverage, and
        where the consensus quietly breaks down — is missing.
      </p>
      <p>
        The usual answer is another loud verdict: one more number, one more site telling you what is
        good. That is not an answer. It is more of the same problem.
      </p>

      <h2>What GamesKeep does</h2>
      <p>
        We aggregate games news from across the industry and lay a <strong>bias lens</strong> over
        it — an influence signal (are there factual or conduct flags on the coverage?) and a quality
        read — so you can see the shape of the reporting, not just the headline. Alongside the news
        sits a <strong>rating system</strong> that keeps three perspectives{' '}
        <strong>separate on purpose</strong>: professional critics, our own editorial take, and the
        player community. When they disagree, we show the disagreement instead of blending it into a
        single misleading average.
      </p>
      <p>
        Everything you read is pre-computed and cached, drawn from real engines — clustering,
        scoring, bias signals — running in the background. The demo runs on realistic mock data with
        those engines fully live; only the data source is stand-in.
      </p>

      <h2>The principle</h2>
      <p>
        Our whole reason to exist is the answer to that distrust — so we hold ourselves to the same
        standard we apply to everyone else. Promoted or sponsored content is always labelled. Our
        methodology is public in plain language. Automated systems can always be corrected by a
        human, and every such correction is logged. We would rather show you a messy, honest picture
        than a clean, confident lie.
      </p>
      <p>
        If we ever become &ldquo;another site telling you what to think,&rdquo; we have failed. The
        goal is the opposite: give you the lens, show our work, and trust you to draw the line.
      </p>

      <h2>Read the details</h2>
      <p>
        Want to know exactly how we compute bias, scores and the critic–community disconnect? Our{' '}
        <a href="/methodology">Methodology</a> explains the approach in full — transparently,
        without the exact formulas that would let coverage be gamed. Want to reach us or write for
        us? The <a href="/contact">Contact</a> page is the door.
      </p>
    </DocPage>
  );
}
