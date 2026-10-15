'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { SearchGroup, SearchResult } from '@/lib/public-api';
import { useSite } from './SiteProvider';
import { distinctSubtitle } from '@/lib/format';

/**
 * The header search (Phase P S4). A real GET form to /search (works without
 * JavaScript), enhanced with a typeahead: an accessible combobox (arrow keys,
 * Enter, Escape) over the rate-limited /public/search/suggest endpoint (through
 * the public BFF). Every option is ONE link — nothing nested.
 */
const GROUP_LABEL: Record<SearchGroup, string> = {
  games: 'Games',
  stories: 'Stories',
  sources: 'Sources',
};
const hrefOf = (g: SearchGroup, slug: string): string =>
  g === 'games' ? `/games/${slug}` : g === 'stories' ? `/topics/${slug}` : `/sources/${slug}`;

function SearchIcon(): React.JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="M21 21l-4.3-4.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function HeaderSearch(): React.JSX.Element {
  const { layout } = useSite();
  const minChars = Math.max(2, layout.searchMinChars || 2);
  const [q, setQ] = useState('');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [notice, setNotice] = useState<string | null>(null);
  const boxRef = useRef<HTMLFormElement>(null);

  const options = useMemo(() => {
    if (!result || result.tooShort) return [];
    return (Object.keys(GROUP_LABEL) as SearchGroup[]).flatMap((g) =>
      result.groups[g].map((h) => ({ group: g, hit: h, href: hrefOf(g, h.slug) })),
    );
  }, [result]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < minChars) {
      setResult(null);
      setNotice(null);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/public/search/suggest?q=${encodeURIComponent(term)}`, {
          signal: ctrl.signal,
        });
        if (res.status === 429) {
          setNotice('Too many searches — try again in a moment.');
          setResult(null);
          return;
        }
        if (!res.ok) return;
        const body = (await res.json()) as { data?: SearchResult };
        setNotice(null);
        setResult(body.data ?? null);
        setActive(-1);
        setOpen(true);
      } catch {
        /* aborted or offline — the form still submits to /search */
      }
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, minChars]);

  useEffect(() => {
    const close = (e: MouseEvent): void => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (!options.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % options.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i <= 0 ? options.length - 1 : i - 1));
    } else if (e.key === 'Enter' && open && active >= 0 && options[active]) {
      e.preventDefault();
      window.location.href = options[active]!.href;
    }
  }

  const listId = 'gk-search-list';
  const showPop = open && (options.length > 0 || notice || (result && !result.tooShort));
  let index = -1;

  return (
    <form ref={boxRef} className="gk-search" role="search" action="/search" method="get">
      <SearchIcon />
      <input
        type="search"
        name="q"
        placeholder="Search…"
        autoComplete="off"
        maxLength={200}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-label="Search games, stories and sources"
        aria-expanded={Boolean(showPop)}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
      />
      {showPop ? (
        <div className="gk-search-pop" id={listId} role="listbox" aria-label="Suggestions">
          {notice ? <p className="gk-search-note">{notice}</p> : null}
          {(Object.keys(GROUP_LABEL) as SearchGroup[]).map((g) => {
            const hits = result?.groups[g] ?? [];
            if (!hits.length) return null;
            return (
              <div key={g} role="group" aria-label={GROUP_LABEL[g]} className="gk-search-group">
                <span className="gk-search-group-label" aria-hidden>
                  {GROUP_LABEL[g]}
                </span>
                {hits.map((h) => {
                  index += 1;
                  const i = index;
                  return (
                    <a
                      key={`${g}:${h.slug}`}
                      id={`${listId}-${i}`}
                      role="option"
                      aria-selected={i === active}
                      className={`gk-search-option${i === active ? ' is-active' : ''}`}
                      href={hrefOf(g, h.slug)}
                    >
                      <span className="gk-search-title">{h.title}</span>
                      {h.category ? <span className="gk-chip">{h.category}</span> : null}
                      {distinctSubtitle(h.title, h.subtitle) ? (
                        <span className="gk-search-sub">
                          {distinctSubtitle(h.title, h.subtitle)}
                        </span>
                      ) : null}
                    </a>
                  );
                })}
              </div>
            );
          })}
          {result && !result.tooShort && options.length === 0 && !notice ? (
            <p className="gk-search-note">Nothing matched.</p>
          ) : null}
          {result && !result.tooShort ? (
            <a className="gk-search-all" href={`/search?q=${encodeURIComponent(q.trim())}`}>
              All results for “{q.trim()}” →
            </a>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
