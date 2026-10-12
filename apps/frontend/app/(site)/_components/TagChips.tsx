import type { CardTag } from '@/lib/public-api';

/**
 * A card's tags (Phase P S3) — chips that link to the tag pages. Rendered as
 * SIBLING links inside a card container; on a card that is itself one link they
 * render as plain text (`asLinks={false}`) — never nested anchors. Issue tags
 * read as issues by shape, not colour (green/red stay reserved for bias + the
 * disconnect).
 */
function ChipBody({ t }: { t: CardTag }): React.JSX.Element {
  return (
    <>
      {t.family === 'issue' ? (
        <span className="gk-tagchip-mark" aria-hidden>
          !
        </span>
      ) : null}
      {t.name}
      {t.family === 'issue' ? <span className="gk-sr-only"> (reported issue)</span> : null}
    </>
  );
}

export function TagChips({
  tags,
  className = '',
  asLinks = true,
}: {
  tags: CardTag[];
  className?: string;
  /** false inside a card that is itself one link (no nested anchors). */
  asLinks?: boolean;
}): React.JSX.Element | null {
  if (tags.length === 0) return null;
  return (
    <ul className={`gk-tagchips ${className}`.trim()} aria-label="Tags">
      {tags.map((t) => {
        const cls = `gk-tagchip${t.family === 'issue' ? ' is-issue' : ''}`;
        return (
          <li key={`${t.family}:${t.slug}`}>
            {asLinks ? (
              <a className={cls} href={`/games/tag/${t.slug}`}>
                <ChipBody t={t} />
              </a>
            ) : (
              <span className={cls}>
                <ChipBody t={t} />
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
