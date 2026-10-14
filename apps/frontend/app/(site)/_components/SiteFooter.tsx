/**
 * Global footer (BLUEPRINT 3): About, Methodology, Contact, Privacy/GDPR, Terms,
 * social links. Static-page CONTENT is a later phase — these are the links/slots
 * (graceful placeholders for now). The footer pixel easter-egg is an explicitly
 * later/edge touch (out of scope here) — room is left, it is not built.
 */
import { siteText, type PublicSite } from '@/lib/site';

const columns = (brand: string): { title: string; links: { label: string; href: string }[] }[] => [
  {
    title: brand,
    links: [
      { label: 'About', href: '/about' },
      { label: 'Methodology', href: '/methodology' },
      { label: 'Contact', href: '/contact' },
      { label: 'Promote your game', href: '/promote' },
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

export function SiteFooter({ site }: { site: PublicSite }): React.JSX.Element {
  return (
    <footer className="gk-footer">
      <div className="gk-container">
        <div className="gk-footer-grid">
          <div className="gk-footer-brand">
            <a className="gk-brand" href="/" aria-label={`${site.brand} home`}>
              <img
                className="gk-logo-img"
                src="/assets/logo.svg"
                alt={site.brand}
                width={99}
                height={54}
              />
              <span>{site.brand}</span>
            </a>
            <p>{siteText(site, 'footer.blurb')}</p>
          </div>
          {columns(site.brand).map((col) => (
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
          <span>{siteText(site, 'footer.legal')}</span>
          <span>{siteText(site, 'footer.attribution')}</span>
        </div>
      </div>
    </footer>
  );
}
