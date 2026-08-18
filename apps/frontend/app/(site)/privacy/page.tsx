import type { Metadata } from 'next';
import { DocPage } from '../_components/DocPage';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

// [[OWNER-TODO: LEGAL REVIEW REQUIRED — this Privacy / GDPR text is an AI-drafted
// PLACEHOLDER and must be reviewed and rewritten by a qualified lawyer (GDPR / EU)
// before any public launch. Do not ship as-is. Confirm the contact/DPO address.]]
const CONTACT_EMAIL = 'wrathsystems@gmail.com';

export const metadata: Metadata = {
  title: 'Privacy & GDPR',
  description:
    'How GamesKeep handles your data: what we collect, why, and the rights you have — including access, export and deletion. Draft pending legal review.',
  alternates: { canonical: `${siteUrl}/privacy` },
  // Draft legal text should not be indexed as authoritative until reviewed.
  robots: { index: false, follow: true },
  openGraph: {
    type: 'website',
    url: `${siteUrl}/privacy`,
    title: 'Privacy & GDPR — GamesKeep',
    description: 'What we collect, why, and your rights over your data.',
  },
  twitter: { card: 'summary', title: 'Privacy & GDPR — GamesKeep' },
};

export default function PrivacyPage(): React.JSX.Element {
  return (
    <DocPage
      eyebrow="Your data"
      title="Privacy & GDPR"
      lede="Plain-language summary of what GamesKeep collects, why we collect it, and the control you have over it. We aim to collect as little as possible and to make your rights easy to exercise."
      crumbLabel="Privacy / GDPR"
      crumbPath="/privacy"
      meta="Draft — pending legal review"
    >
      <div className="gk-doc-note is-warn">
        <span className="gk-doc-note-label">Draft — not yet legally reviewed</span>
        This Privacy &amp; GDPR notice is an <strong>early draft</strong> written to describe our
        intended practices. It has <strong>not</strong> been reviewed by a lawyer, it is{' '}
        <strong>not legal advice</strong>, and it is not the final policy. It will be reviewed and
        rewritten by qualified counsel before GamesKeep launches publicly. Please treat it as a
        statement of intent, not a binding document.
      </div>

      <h2>What we collect</h2>
      <p>We try to collect the minimum needed to run the platform. Broadly, that means:</p>
      <ul>
        <li>
          <strong>Account details</strong> you give us — such as a username, email address and a
          securely hashed password. We never store your password in readable form.
        </li>
        <li>
          <strong>Content you create</strong> — ratings, comments and profile information you choose
          to add.
        </li>
        <li>
          <strong>Essential technical data</strong> — session cookies that keep you logged in and
          protect against cross-site request forgery, plus basic security logs.
        </li>
        <li>
          <strong>Aggregated, anonymous analytics</strong> — we look at usage in aggregate only.
          Where we consider geography it is coarse and anonymised; we do not build advertising
          profiles of individuals.
        </li>
      </ul>

      <h2>How we use it</h2>
      <p>
        Your data is used to provide and secure the service: to sign you in, to attribute the
        ratings and comments you post, to keep the community score honest and resistant to
        manipulation, to prevent abuse, and to understand in aggregate how the platform is used so
        we can improve it. We do not sell your personal data.
      </p>

      <h2>Cookies &amp; sessions</h2>
      <p>
        We use a small number of <strong>essential cookies</strong> to keep you signed in and to
        protect requests you make while logged in. These are necessary for the site to function. If
        and when we introduce any non-essential cookies, we will ask for your consent first.
      </p>

      <h2>Your rights</h2>
      <p>
        Under the GDPR and similar regimes you have strong rights over your personal data, and we
        build the tools to honour them directly into your account:
      </p>
      <ul>
        <li>
          <strong>Access &amp; portability</strong> — you can request and download an export of the
          personal data associated with your account.
        </li>
        <li>
          <strong>Erasure</strong> — you can delete your account. We anonymise your personal data
          and detach it from your public contributions rather than leaving identifying traces
          behind.
        </li>
        <li>
          <strong>Rectification</strong> — you can correct your account and profile information at
          any time.
        </li>
        <li>
          <strong>Consent</strong> — where we rely on your consent, it is versioned and you can
          review or withdraw it.
        </li>
      </ul>
      <p>
        Many of these are available from your <a href="/account">account settings</a>. For anything
        you cannot do there, contact us and we will help.
      </p>

      <h2>Data retention</h2>
      <p>
        We keep personal data only as long as needed for the purposes above or as required by law.
        When you delete your account, identifying data is anonymised promptly; some security and
        audit records may be retained for a limited period to protect the platform and other users.
      </p>

      <h2>Third parties</h2>
      <p>
        Where we rely on service providers (for example infrastructure or email delivery), we share
        only what is necessary and expect them to protect it. The public version of this policy will
        name the categories of providers we use once finalised.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about your data, or want to exercise a right? Email{' '}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> or use the{' '}
        <a href="/contact">Contact</a> page. The public policy will list a formal data-protection
        contact once legal review is complete.
      </p>

      <div className="gk-doc-note">
        <strong>Reminder:</strong> the section above is placeholder wording pending legal review and
        may change substantially before launch.
      </div>
    </DocPage>
  );
}
