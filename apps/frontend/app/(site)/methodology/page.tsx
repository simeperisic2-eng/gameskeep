import type { Metadata } from 'next';
import { getDisplay } from '@/lib/public-api';
import { NO_SIGNALS_LABEL } from '@/lib/bias';
import { DocPage } from '../_components/DocPage';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

// [[OWNER-TODO: review the Methodology framing before public launch — it must stay
// transparent about the APPROACH without ever publishing exact formulas, weights
// or thresholds (publishing the recipe lets coverage and scores be gamed)]]
export const metadata: Metadata = {
  title: 'Methodology',
  description:
    'How GamesKeep computes bias, ratings and the critic–community disconnect — the approach explained transparently, without the exact formulas that would let the system be gamed.',
  alternates: { canonical: `${siteUrl}/methodology` },
  openGraph: {
    type: 'website',
    url: `${siteUrl}/methodology`,
    title: 'Methodology — how GamesKeep measures bias and ratings',
    description:
      'Influence signals shown with their evidence, three separate rating layers kept apart on purpose, the disconnect shown with context, and manipulation-aware community weighting — the approach, in plain language.',
  },
  twitter: { card: 'summary_large_image', title: 'GamesKeep Methodology' },
};

export default async function MethodologyPage(): Promise<React.JSX.Element> {
  // What the site currently SHOWS (Phase P S1 admin switches) — the copy below
  // never describes a display the reader can't see.
  const display = await getDisplay();
  return (
    <DocPage
      eyebrow="How it works"
      title="Our methodology"
      lede="Trust is earned by showing your work. Here is exactly how we think about bias, ratings and the gap between critics and players — enough to judge whether we are being fair, without the precise recipe that would let the system be gamed."
      crumbLabel="Methodology"
      crumbPath="/methodology"
    >
      <p>
        Every number on GamesKeep is produced by real engines running in the background and stored
        for you to read instantly. This page explains what those engines are measuring and why. What
        it deliberately does <strong>not</strong> give you is the exact set of weights, thresholds
        and formulas behind each figure — for the same reason we hide the precise formula behind
        account levels. Publish the recipe and you invite people to cook to it: outlets tuning
        coverage to dodge a signal, campaigns engineered to move a score. The approach is public.
        The dials are not.
      </p>

      <h2>Reading the news: what the coverage carries</h2>
      <p>
        We never reduce a piece of coverage to a single &ldquo;bias score.&rdquo; We look for
        concrete, checkable <strong>signals</strong> and show the ones we find — on reviews and on
        coverage carrying a sponsored signal, where they matter most.
      </p>
      <div className="gk-doc-cards">
        <div className="gk-doc-card">
          <span className="gk-doc-card-kicker">Influence signals</span>
          <h3>What we look for</h3>
          <p>
            Self-disclosed <strong>sponsored</strong> content, <strong>affiliate</strong> links,
            publisher-provided <strong>review copies</strong>, and an outlet&rsquo;s own{' '}
            <strong>opinion</strong> framing. On reviews we also look for an{' '}
            <strong>embargo</strong> and a <strong>sponsored event or press trip</strong>. Each is a
            fact about how the piece was produced — a label, not a verdict on its quality.
          </p>
        </div>
        <div className="gk-doc-card">
          <span className="gk-doc-card-kicker">Evidence</span>
          <h3>Shown with its source</h3>
          <p>
            A review-integrity signal appears only with its evidence: a short quote from the source
            article (linked) or an editor&rsquo;s note, with a date. Editors confirm what the
            automation finds before it is shown, and can add what it missed.
          </p>
        </div>
      </div>
      <p>
        Where we find none of these signals we say exactly that:{' '}
        <strong>&ldquo;{NO_SIGNALS_LABEL}.&rdquo;</strong>{' '}
        <span>
          We can show what we found; we cannot prove what isn&rsquo;t there — so we never label
          coverage as clean.
        </span>
      </p>
      {display.showQuality ? (
        <>
          <h3>Quality, separately</h3>
          <p>
            A read of the craft of the reporting placed on a <strong>scale</strong> — depth,
            sourcing, transparency, care — separate from whether we agree with its conclusions. It
            is kept apart from the influence signals on purpose: &ldquo;is this well made?&rdquo;
            and &ldquo;what is shaping it?&rdquo; are different questions.
          </p>
        </>
      ) : null}

      <h2>Rating games: three layers, never merged</h2>
      <p>
        A game is not one audience. Critics, our own editors, and the playing community routinely
        reach different conclusions — and each of those conclusions is legitimate on its own terms.
        So we keep <strong>three separate rating layers</strong> and present them as three, always.
        We never blend them into one headline average, because that average would hide the single
        most interesting thing on the page: where they disagree.
      </p>
      <div className="gk-doc-cards">
        <div className="gk-doc-card">
          <span className="gk-doc-card-kicker">Layer one</span>
          <h3>Critics</h3>
          <p>
            Aggregated professional reviews from the outlets we track — the established critical
            read, with the outlet count shown so you know how much it rests on.
          </p>
        </div>
        <div className="gk-doc-card">
          <span className="gk-doc-card-kicker">Layer two</span>
          <h3>GamesKeep</h3>
          <p>
            Our own editorial verdict, published only where we have actually reviewed a game — one
            voice, clearly ours, never dressed up as consensus.
          </p>
        </div>
        <div className="gk-doc-card">
          <span className="gk-doc-card-kicker">Layer three</span>
          <h3>Community</h3>
          <p>
            The players&rsquo; score — credibility-weighted and manipulation-aware (below), so it
            reflects the community rather than whoever showed up to brigade.
          </p>
        </div>
      </div>

      <h2>The disconnect — shown, with context</h2>
      <p>
        When the critic and community layers pull apart, that gap is a story in itself, and we treat
        it as one. Rather than burying it, we surface the disconnect and give it{' '}
        <strong>context</strong>: how large the gap is, how much weight sits on each side, and —
        where our editors can add it — why the split may be happening. A beloved-by-critics,
        divisive-with-players game and a quietly-adored-by-players, coldly-reviewed one are
        different situations, and the page should let you feel that difference instead of flattening
        it into a number.
      </p>
      <p>
        We are describing the gap, not adjudicating it. The context is there to help you interpret
        the disagreement, never to tell you which side is &ldquo;right.&rdquo;
      </p>

      <h2>Keeping the community score honest</h2>
      <p>
        A raw average of user ratings is trivial to manipulate — review bombs, boosting campaigns,
        throwaway accounts. So the community layer is <strong>credibility-weighted</strong>: not
        every rating counts the same, and how much a rating counts depends on signals of good-faith,
        established participation rather than on agreeing with anyone. On top of that sits{' '}
        <strong>manipulation-aware</strong> handling designed to blunt coordinated, inorganic
        activity so it cannot swamp the genuine signal.
      </p>
      <p>
        We keep the specific signals, weights and detection thresholds private — for the obvious
        reason that publishing them is publishing the instructions to evade them. What we will
        commit to in the open is the principle: the community score is built to represent the
        community, and to resist being captured by whoever is loudest or most organised on a given
        day.
      </p>

      <div className="gk-doc-note is-warn">
        <span className="gk-doc-note-label">Why we hold the numbers back</span>
        Transparency about the <strong>approach</strong> earns trust. Transparency about the exact{' '}
        <strong>weights and thresholds</strong>{' '}
        <span>
          would hand a playbook to anyone wanting to game coverage or scores — the opposite of what
          this platform is for. Where we draw that line is itself part of the method: we frame how
          we measure, we do not publish the ruler&rsquo;s markings.
        </span>
      </div>

      <h2>Automated, always correctable</h2>
      <p>
        Clustering, bias signals and scores run automatically, without waiting on a human. But every
        automated result can be reviewed and overridden by our editors, and every override is logged
        — who changed what, when, and from what to what. Automation gives us speed and consistency;
        human correction keeps it honest; the audit trail keeps <em>us</em> honest.
      </p>
      <p>
        Questions about any of this, or think we got a specific call wrong? Tell us on the{' '}
        <a href="/contact">Contact</a> page — being challenged on our own methodology is exactly the
        accountability we are asking everyone else to accept.
      </p>
    </DocPage>
  );
}
