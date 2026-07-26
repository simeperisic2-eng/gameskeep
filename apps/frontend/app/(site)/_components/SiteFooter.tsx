/**
 * Global footer (BLUEPRINT 3): About, Methodology, Contact, Privacy/GDPR, Terms,
 * social links. Static-page CONTENT is a later phase — these are the links/slots
 * (graceful placeholders for now). The footer pixel easter-egg is an explicitly
 * later/edge touch (out of scope here) — room is left, it is not built.
 */
const COLUMNS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: 'GamesKeep',
    links: [
      { label: 'About', href: '/about' },
      { label: 'Methodology', href: '/methodology' },
      { label: 'Contact', href: '/contact' },
    ],
  },
  {
    title: 'Explore',
    links: [
      { label: 'Topics', href: '/topics' },
      { label: 'Games', href: '/games' },
      { label: 'Upcoming', href: '/upcoming' },
      { label: 'Sources', href: '/sources' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { label: 'Privacy / GDPR', href: '/privacy' },
      { label: 'Terms', href: '/terms' },
    ],
  },
];

export function SiteFooter(): React.JSX.Element {
  const year = new Date().getFullYear();
  return (
    <footer className="gk-footer">
      <div className="gk-container">
        <div className="gk-footer-grid">
          <div className="gk-footer-brand">
            <a className="gk-brand" href="/" aria-label="GamesKeep home">
              <img
                className="gk-logo-img"
                src="/assets/logo.svg"
                alt="GamesKeep"
                width={99}
                height={54}
              />
              <span>GamesKeep</span>
            </a>
            <p>
              A tool to judge games coverage for yourself — news with a bias lens, ratings with
              honest context. Transparency, not authority.
            </p>
          </div>
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <h4>{col.title}</h4>
              <ul>
                {col.links.map((l) => (
                  <li key={l.href}>
                    <a href={l.href}>{l.label}</a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="gk-footer-legal">
          <span>© {year} GamesKeep. Demo build — mock data, real engines.</span>
          <span>
            Excerpts &amp; summaries link to each source. Full text stays with the publisher.
          </span>
        </div>
      </div>
    </footer>
  );
}
