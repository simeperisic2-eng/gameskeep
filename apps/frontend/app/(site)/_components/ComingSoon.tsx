/**
 * Graceful in-chrome placeholder for sections that arrive in a later phase
 * (Games/Upcoming/Sources = I5b, Awards = I7, auth/account = I6, static pages
 * later). Keeps every nav link alive and on-brand instead of dead-ending in a
 * 404, without pretending the feature exists.
 */
export function ComingSoon({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body: string;
}): React.JSX.Element {
  return (
    <section className="gk-container" style={{ paddingBlock: 'var(--gk-section-y)' }}>
      <div
        style={{
          maxWidth: 620,
          margin: '0 auto',
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          alignItems: 'center',
        }}
      >
        <span className="gk-eyebrow">{eyebrow}</span>
        <h1 className="gk-section-title" style={{ fontSize: 'clamp(28px, 4vw, 40px)' }}>
          {title}
        </h1>
        <p className="gk-section-sub" style={{ fontSize: 16 }}>
          {body}
        </p>
        <a className="gk-signin" href="/" style={{ marginTop: 8 }}>
          Back to the homepage
        </a>
      </div>
    </section>
  );
}
