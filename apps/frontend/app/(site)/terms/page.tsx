import type { Metadata } from 'next';
import { DocPage } from '../_components/DocPage';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

// [[OWNER-TODO: LEGAL REVIEW REQUIRED — these Terms of Service are AI-drafted
// PLACEHOLDER text and must be reviewed and rewritten by a qualified lawyer before
// any public launch. Do not ship as-is. Set the governing-law jurisdiction.]]
const CONTACT_EMAIL = 'wrathsystems@gmail.com';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description:
    'The terms for using GamesKeep: your account, acceptable use, the content you post, and our aggregation of excerpts that always link back to the source. Draft pending legal review.',
  alternates: { canonical: `${siteUrl}/terms` },
  // Draft legal text should not be indexed as authoritative until reviewed.
  robots: { index: false, follow: true },
  openGraph: {
    type: 'website',
    url: `${siteUrl}/terms`,
    title: 'Terms of Service — GamesKeep',
    description: 'The terms for using GamesKeep. Draft pending legal review.',
  },
  twitter: { card: 'summary', title: 'Terms of Service — GamesKeep' },
};

export default function TermsPage(): React.JSX.Element {
  return (
    <DocPage
      eyebrow="The rules"
      title="Terms of service"
      lede="The agreement between you and GamesKeep when you use the platform — written to be as plain and fair as terms can be."
      crumbLabel="Terms"
      crumbPath="/terms"
      meta="Draft — pending legal review"
    >
      <div className="gk-doc-note is-warn">
        <span className="gk-doc-note-label">Draft — not yet legally reviewed</span>
        These Terms of Service are an <strong>early draft</strong> describing our intended terms.
        They have <strong>not</strong> been reviewed by a lawyer, they are{' '}
        <strong>not legal advice</strong>, and they are not the final, binding agreement. They will
        be reviewed and rewritten by qualified counsel before GamesKeep launches publicly. Please
        treat them as a statement of intent.
      </div>

      <h2>Using GamesKeep</h2>
      <p>
        By accessing or using GamesKeep you agree to these terms. If you do not agree, please do not
        use the platform. You must be old enough to consent to these terms and to the processing of
        your data under the law that applies to you.
      </p>

      <h2>Your account</h2>
      <p>
        You are responsible for keeping your login credentials secure and for activity that happens
        under your account. Use a strong, unique password, and tell us promptly if you believe your
        account has been compromised. Do not impersonate others or create accounts to evade
        moderation.
      </p>

      <h2>Acceptable use</h2>
      <p>Keep it fair. In particular, do not:</p>
      <ul>
        <li>
          <strong>Manipulate ratings or signals</strong> — no review bombing, vote brigading, fake
          accounts, or coordinated campaigns to distort scores or the disconnect.
        </li>
        <li>
          <strong>Harass or abuse others</strong> — no threats, hate speech, or targeted harassment.
        </li>
        <li>
          <strong>Post illegal or infringing content</strong>, malware, spam, or content you do not
          have the right to share.
        </li>
        <li>
          <strong>Attack the platform</strong> — no attempts to breach security, scrape at abusive
          volume, or disrupt the service for others.
        </li>
      </ul>

      <h2>Content you post</h2>
      <p>
        You keep ownership of the ratings, comments and other content you create. By posting it, you
        grant GamesKeep a non-exclusive licence to host, display and distribute it as part of
        operating the platform. You are responsible for what you post, and you confirm you have the
        right to post it.
      </p>
      <p>
        We may moderate, remove, or restrict content that breaks these terms, and we may act on
        automated signals — but moderation decisions can always be reviewed by a human, and staff
        actions are logged.
      </p>

      <h2>Ratings &amp; community integrity</h2>
      <p>
        Scores, bias signals and the critic–community disconnect are analytical tools offered to
        help you form your own view — they are opinions and measurements, not statements of fact or
        professional advice. To keep them meaningful, the community score is credibility-weighted
        and manipulation-aware, as described in our <a href="/methodology">Methodology</a>.
      </p>

      <h2>Aggregation &amp; intellectual property</h2>
      <p>
        GamesKeep aggregates news by showing <strong>excerpts and summaries</strong> that always
        link back to the original source. Full articles remain with their publishers; we send
        readers to them, we do not replace them. The GamesKeep name, design and original content are
        ours or our licensors&rsquo;. Trademarks and game assets belong to their respective owners
        and are shown for identification and commentary.
      </p>

      <h2>Disclaimers</h2>
      <p>
        GamesKeep is currently a <strong>demo build</strong> and is provided &ldquo;as is,&rdquo;
        without warranties of any kind. We do not guarantee that scores, signals or aggregated data
        are complete, accurate or uninterrupted. You use the platform, and rely on its measurements,
        at your own discretion.
      </p>

      <h2>Limitation of liability</h2>
      <p>
        To the fullest extent permitted by law, GamesKeep is not liable for indirect, incidental or
        consequential damages arising from your use of the platform. The precise limits will be set
        out in the legally reviewed version of these terms.
      </p>

      <h2>Termination</h2>
      <p>
        You can stop using GamesKeep and delete your account at any time. We may suspend or
        terminate access that breaks these terms or harms the platform or its users.
      </p>

      <h2>Changes &amp; governing law</h2>
      <p>
        We may update these terms as the platform evolves; material changes will be communicated.
        The governing law and jurisdiction will be specified in the final, legally reviewed version.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about these terms? Email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>{' '}
        or use the <a href="/contact">Contact</a> page.
      </p>

      <div className="gk-doc-note">
        <strong>Reminder:</strong> the sections above are placeholder wording pending legal review
        and may change substantially before launch.
      </div>
    </DocPage>
  );
}
