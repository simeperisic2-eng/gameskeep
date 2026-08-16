import { NavLinks } from './NavLinks';
import { HeaderAuth } from './HeaderAuth';

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
export function SiteHeader(): React.JSX.Element {
  return (
    <header className="gk-header">
      <div className="gk-container gk-header-inner">
        <a className="gk-brand" href="/" aria-label="GamesKeep home">
          {/* Owner-provided emblem (reference/gklogo.svg → public/assets/logo.svg). */}
          <img
            className="gk-logo-img"
            src="/assets/logo.svg"
            alt="GamesKeep"
            width={110}
            height={60}
          />
          <span>
            GamesKeep
            <br />
            <span className="gk-brand-sub">News · Bias · Ratings</span>
          </span>
        </a>

        <NavLinks />

        <div className="gk-header-right">
          <label className="gk-search" aria-label="Search games, stories and sources">
            <SearchIcon />
            <input type="search" placeholder="Search…" name="q" autoComplete="off" />
          </label>
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
