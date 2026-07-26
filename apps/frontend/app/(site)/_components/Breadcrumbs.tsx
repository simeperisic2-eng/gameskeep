/**
 * Breadcrumb trail (SPEC I5a — user + SEO). The matching BreadcrumbList JSON-LD
 * is emitted by the page from the same `items`, so the visible trail and the
 * structured data never drift. The last crumb is the current page (no link).
 */
export function Breadcrumbs({
  items,
}: {
  items: { name: string; url: string }[];
}): React.JSX.Element {
  return (
    <nav className="gk-crumbs" aria-label="Breadcrumb">
      <ol>
        {items.map((it, i) => {
          const last = i === items.length - 1;
          return (
            <li key={it.url}>
              {last ? <span aria-current="page">{it.name}</span> : <a href={it.url}>{it.name}</a>}
              {!last ? (
                <span className="gk-crumb-sep" aria-hidden>
                  ›
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
