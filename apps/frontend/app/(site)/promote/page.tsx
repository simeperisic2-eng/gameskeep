import type { Metadata } from 'next';
import { DocPage } from '../_components/DocPage';
import { PromoteForm } from '../_components/PromoteForm';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export const metadata: Metadata = {
  title: 'Promote your game',
  description:
    'Promote your game on GamesKeep. Placements are always clearly labeled “Promoted” — transparency is the brand. Get in touch to arrange one.',
  alternates: { canonical: `${siteUrl}/promote` },
  openGraph: {
    type: 'website',
    url: `${siteUrl}/promote`,
    title: 'Promote your game on GamesKeep',
    description: 'Paid placements, always clearly labeled. Arrange one by email.',
  },
  twitter: { card: 'summary_large_image', title: 'Promote your game on GamesKeep' },
};

export default function PromotePage(): React.JSX.Element {
  return (
    <DocPage
      eyebrow="Advertise with GamesKeep"
      title="Promote your game"
      lede="Reach players who come here to judge games for themselves. Every paid placement is clearly labeled — the same transparency we hold everyone else to."
      crumbLabel="Promote"
      crumbPath="/promote"
    >
      <h2>How it works</h2>
      <p>
        Tell us what you’d like to promote and we’ll arrange a placement — a slot on the site, or a{' '}
        <strong>Promoted</strong> flag on your game’s page. Payment is handled off-site (invoice or
        transfer); once it’s settled, we activate the placement. There’s no self-serve checkout — at
        our size a quick email is faster for everyone.
      </p>

      <h2>Always labeled — no exceptions</h2>
      <p>
        Whoever pays gets the promotion, but the reader always knows it’s paid: every placement
        carries a <strong>“Promoted” / “Sponsored”</strong> label as prominent as our bias flags. We
        flag other people’s undisclosed influence; we’re not going to hide our own. That’s
        non-negotiable — it’s what makes the rest of the site trustworthy.
      </p>

      <h2>Get in touch</h2>
      <p>Send us the details and we’ll take it from there.</p>
      <PromoteForm />

      <div className="gk-doc-note">
        Prefer to just email? Reach us at <a href="/contact">Contact</a>. A self-serve booking flow
        may come later; for now it’s personal and by arrangement.
      </div>
    </DocPage>
  );
}
