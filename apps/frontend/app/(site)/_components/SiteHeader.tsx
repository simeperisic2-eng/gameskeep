import { NavLinks } from './NavLinks';
import { HeaderAuth } from './HeaderAuth';
import { HeaderSearch } from './HeaderSearch';
import { siteText, type PublicSite } from '@/lib/site';

function SearchIcon(): React.JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="M21 21l-4.3-4.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Global site header (BLUEPRINT 3): logo placeholder, primary nav, an animated
 * search affordance (baseline micro-interaction, search itself is later), and a
 * sign-in placeholder (auth is I6). Sticky + translucent so the gradient shows
 * through it.
 */
export function SiteHeader({ site }: { site: PublicSite }): React.JSX.Element {
  return (
    <header className="gk-header">
      <div className="gk-container gk-header-inner">
        <a className="gk-brand" href="/" aria-label={`${site.brand} home`}>
          {/* Owner-provided emblem (reference/gklogo.svg → public/assets/logo.svg). */}
          <img
            className="gk-logo-img"
            src="/assets/logo.svg"
            alt={site.brand}
            width={110}
            height={60}
          />
          <span>
            {site.brand}
            <br />
            <span className="gk-brand-sub">{siteText(site, 'header.sub')}</span>
          </span>
        </a>

        <NavLinks />

        <div className="gk-header-right">
          <HeaderSearch />
          {/* Phones: the box is hidden — a plain link to the search page. */}
          <a className="gk-search-mobile" href="/search" aria-label="Search">
            <SearchIcon />
          </a>
          <HeaderAuth />
          <button className="gk-burger" type="button" aria-label="Open menu">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M4 7h16M4 12h16M4 17h16"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
}
