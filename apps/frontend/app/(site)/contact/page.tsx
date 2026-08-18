import type { Metadata } from 'next';
import { DocPage } from '../_components/DocPage';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

// [[OWNER-TODO: confirm the public contact address before launch — currently
// wrathsystems@gmail.com; a real writer-submission form with moderation comes in a
// later phase, so this page is deliberately email-only for now]]
const CONTACT_EMAIL = 'wrathsystems@gmail.com';

export const metadata: Metadata = {
  title: 'Contact & Join',
  description:
    'Reach the GamesKeep team, or pitch to write for us. We are looking for critics and writers who care about transparency in games coverage.',
  alternates: { canonical: `${siteUrl}/contact` },
  openGraph: {
    type: 'website',
    url: `${siteUrl}/contact`,
    title: 'Contact & Join GamesKeep',
    description:
      'Get in touch, or pitch to write for a platform built on transparency, not authority.',
  },
  twitter: { card: 'summary_large_image', title: 'Contact & Join GamesKeep' },
};

export default function ContactPage(): React.JSX.Element {
  const writeSubject = encodeURIComponent('Writing for GamesKeep');
  const writeBody = encodeURIComponent(
    'Hi GamesKeep team,\n\nI would like to write / contribute. A little about me:\n\n- Who I am:\n- Where I have written before (links):\n- What I would want to cover:\n\nThanks,',
  );

  return (
    <DocPage
      eyebrow="Get in touch"
      title="Contact & join"
      lede="Questions, corrections, partnership ideas — or you want to write for us? There is one door, and it is open."
      crumbLabel="Contact"
      crumbPath="/contact"
    >
      <h2>Reach us</h2>
      <p>
        The fastest way to reach the GamesKeep team is email. Whether you have spotted an error in
        our coverage, want to challenge a bias signal or a score, have a partnership in mind, or
        just want to talk — write to us and a human will read it.
      </p>
      <p>
        <a className="gk-doc-cta" href={`mailto:${CONTACT_EMAIL}`}>
          Email {CONTACT_EMAIL}
        </a>
      </p>
      <div className="gk-doc-note">
        Found a factual error, or think an automated call is wrong? Please say so — being
        correctable in the open is the whole point. Include a link to the story or game and what you
        think we got wrong, and we will take a look.
      </div>

      <h2>Write for GamesKeep</h2>
      <p>
        We are always interested in <strong>critics and writers</strong> who care about the same
        thing we do: treating readers as people who can judge for themselves. If you want to review
        games, dig into media influence, or report with a transparency-first mindset, we would love
        to hear from you.
      </p>
      <p>Tell us:</p>
      <ul>
        <li>
          <strong>Who you are</strong> — and where you have written before, if anywhere (links
          help).
        </li>
        <li>
          <strong>What you would want to cover</strong> — the beat, angle or games that pull you.
        </li>
        <li>
          <strong>Why transparency</strong> — a line on why our &ldquo;tool, not authority&rdquo;
          stance resonates with you.
        </li>
      </ul>
      <p>
        <a
          className="gk-doc-cta"
          href={`mailto:${CONTACT_EMAIL}?subject=${writeSubject}&body=${writeBody}`}
        >
          Pitch to write
        </a>
      </p>
      <div className="gk-doc-note">
        <strong>No sign-up form yet — on purpose.</strong> A proper contributor application and
        submission system, with editorial review and moderation, comes in a later phase. Until then
        we keep it simple and personal: email us directly and we will reply.
      </div>
    </DocPage>
  );
}
