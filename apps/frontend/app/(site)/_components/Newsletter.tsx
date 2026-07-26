/**
 * Newsletter subscribe block (BLUEPRINT 2.8 / 3.1) — PLACEHOLDER capture only.
 * The real compose/schedule/segment/send system (and GDPR consent + double
 * opt-in) is I8; here we reserve the layout slot so I8 doesn't reflow the page.
 * The form intentionally does nothing yet.
 */
export function Newsletter(): React.JSX.Element {
  return (
    <section className="gk-newsletter" aria-label="Newsletter signup">
      <span className="gk-eyebrow">Daily briefing</span>
      <h3>Gaming news, with a bias lens — in your inbox.</h3>
      <p>
        One short daily email: the day&apos;s biggest stories, our AI summaries, and the influence
        and quality read on the coverage. No hype, no spam.
      </p>
      {/* [[OWNER-TODO: wire to the real newsletter provider in I8 — this is inert]] */}
      <div className="gk-news-form">
        <input type="email" name="email" placeholder="you@example.com" aria-label="Email address" />
        <button className="gk-btn-amber" type="button">
          Subscribe
        </button>
      </div>
      <p className="gk-news-note">
        Subscriptions go live with accounts &amp; email (I8). GDPR-compliant.
      </p>
    </section>
  );
}
