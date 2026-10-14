import { Fragment, type ReactNode } from 'react';
import type { Block, Inline } from '@/lib/site-core';

/**
 * Renders copy-registry documents and inline texts (Phase P S3b). The input is
 * an already-parsed AST (headings, paragraphs, bold, italics, lists, links,
 * call-to-action buttons, notes, cards) — never HTML — so editor text can't
 * inject markup: every string is a React text node, every link was checked
 * against an allow-list (site path / https / mailto) when it was parsed, and
 * is re-checked here. No hooks: usable from server and client components.
 */
// Second line of defence (the backend already checked): no "//" or "/\" (another
// site), no backslash anywhere.
const SAFE_HREF = /^(?![^\\]*\\)(\/(?![/\\])|#|https?:\/\/|mailto:)/i;

function linkProps(href: string): { href: string; target?: string; rel?: string } {
  return /^https?:\/\//i.test(href)
    ? { href, target: '_blank', rel: 'noopener noreferrer' }
    : { href };
}

export function RichText({ nodes }: { nodes: Inline[] }): React.JSX.Element {
  return <>{nodes.map((n, i) => renderInline(n, i))}</>;
}

function renderInline(n: Inline, key: number): ReactNode {
  switch (n.t) {
    case 'text':
      return n.v;
    case 'strong':
      return (
        <strong key={key}>
          <RichText nodes={n.c} />
        </strong>
      );
    case 'em':
      return (
        <em key={key}>
          <RichText nodes={n.c} />
        </em>
      );
    case 'link':
      return SAFE_HREF.test(n.href) ? (
        <a key={key} {...linkProps(n.href)}>
          <RichText nodes={n.c} />
        </a>
      ) : (
        <RichText key={key} nodes={n.c} />
      );
  }
}

export interface DocContext {
  /** `::: when <condition>` blocks render only when their condition is true. */
  conditions?: Record<string, boolean>;
  /** `{{slot}}` blocks render the page's live component of that name. */
  slots?: Record<string, ReactNode>;
}

export function DocBody({
  blocks,
  ctx = {},
}: {
  blocks: Block[];
  ctx?: DocContext;
}): React.JSX.Element {
  return <>{blocks.map((b, i) => renderBlock(b, i, ctx))}</>;
}

function renderBlock(b: Block, key: number, ctx: DocContext): ReactNode {
  switch (b.t) {
    case 'h2':
      return (
        <h2 key={key}>
          <RichText nodes={b.c} />
        </h2>
      );
    case 'h3':
      return (
        <h3 key={key}>
          <RichText nodes={b.c} />
        </h3>
      );
    case 'p':
      return (
        <p key={key}>
          <RichText nodes={b.c} />
        </p>
      );
    case 'ul':
      return (
        <ul key={key}>
          {b.items.map((it, j) => (
            <li key={j}>
              <RichText nodes={it} />
            </li>
          ))}
        </ul>
      );
    case 'cta':
      return SAFE_HREF.test(b.href) ? (
        <p key={key}>
          <a className="gk-doc-cta" {...linkProps(b.href)}>
            <RichText nodes={b.c} />
          </a>
        </p>
      ) : (
        <p key={key}>
          <RichText nodes={b.c} />
        </p>
      );
    case 'slot':
      return ctx.slots?.[b.name] ? <Fragment key={key}>{ctx.slots[b.name]}</Fragment> : null;
    case 'note': {
      // A one-paragraph note renders its text directly in the box (the original
      // markup); longer notes keep their paragraphs.
      const only = b.blocks.length === 1 && b.blocks[0]?.t === 'p' ? b.blocks[0] : null;
      return (
        <div key={key} className={`gk-doc-note${b.tone === 'warn' ? ' is-warn' : ''}`}>
          {b.label ? <span className="gk-doc-note-label">{b.label}</span> : null}
          {only && only.t === 'p' ? (
            <RichText nodes={only.c} />
          ) : (
            <DocBody blocks={b.blocks} ctx={ctx} />
          )}
        </div>
      );
    }
    case 'cards':
      return (
        <div key={key} className="gk-doc-cards">
          {b.cards.map((c, j) => (
            <div key={j} className="gk-doc-card">
              {c.kicker ? <span className="gk-doc-card-kicker">{c.kicker}</span> : null}
              <DocBody blocks={c.blocks} ctx={ctx} />
            </div>
          ))}
        </div>
      );
    case 'when':
      return ctx.conditions?.[b.cond] ? <DocBody key={key} blocks={b.blocks} ctx={ctx} /> : null;
  }
}

/** Does the document place this slot anywhere (so the page can append it if not)? */
export function docHasSlot(blocks: Block[], name: string): boolean {
  return blocks.some(
    (b) =>
      (b.t === 'slot' && b.name === name) ||
      (b.t === 'note' && docHasSlot(b.blocks, name)) ||
      (b.t === 'when' && docHasSlot(b.blocks, name)) ||
      (b.t === 'cards' && b.cards.some((c) => docHasSlot(c.blocks, name))),
  );
}
