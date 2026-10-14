'use client';

import { useMemo, useState } from 'react';
import { adminFetch } from '../_lib/adminFetch';
import type { CopyConfig, CopyDefView } from '../lib';

/**
 * Copy (Phase P S3b) — the public texts we publish ourselves, with today's text
 * as each default. Placeholders ({brand}, {domain}, {email.contact}, …) fill in
 * from Brand & contact, so a rename is one change here. Locked texts are
 * legally required: shown for reference, never editable. Saves send only the
 * changed keys; every change is audited old → new.
 */
const DOC_HELP =
  'Markdown-lite: ## heading · ### subheading · blank line = new paragraph · **bold** · *italic* · - list item · [text](/path or https://… or mailto:…) · -> [button](link) · ::: note … ::: · ::: warn Label … ::: · ::: card Kicker … ::: · ::: when quality … ::: · {{promote-form}}';

export function CopyManager({ initial }: { initial: CopyConfig }): React.JSX.Element {
  const [values, setValues] = useState<Record<string, string>>(initial.values);
  const [saved, setSaved] = useState<Record<string, string>>(initial.values);
  const [stored, setStored] = useState<Record<string, string>>(initial.stored);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [open, setOpen] = useState<string>('identity');

  const byGroup = useMemo(() => {
    const m = new Map<string, CopyDefView[]>();
    for (const d of initial.defs) m.set(d.group, [...(m.get(d.group) ?? []), d]);
    return m;
  }, [initial.defs]);

  const changed = initial.defs.filter(
    (d) => !d.locked && (values[d.key] ?? '') !== (saved[d.key] ?? ''),
  );

  async function send(patch: Record<string, string | null>): Promise<void> {
    setBusy(true);
    setMsg(null);
    try {
      const res = await adminFetch('/admin/api/copy', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ values: patch }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        data?: { stored: Record<string, string>; values: Record<string, string> };
        changed?: string[];
        message?: string;
      };
      if (res.ok && body.data) {
        setSaved(body.data.values);
        setValues(body.data.values);
        setStored(body.data.stored);
        setMsg(
          body.changed?.length
            ? `Saved: ${body.changed.join(', ')}. Public pages show it within a few seconds.`
            : 'Nothing changed.',
        );
      } else {
        setMsg(`Save failed: ${body.message ?? res.status}`);
      }
    } finally {
      setBusy(false);
    }
  }

  const saveChanges = (): Promise<void> =>
    send(Object.fromEntries(changed.map((d) => [d.key, values[d.key] ?? ''])));

  return (
    <div className="gk-cp-page">
      <header className="gk-cp-page-head">
        <h1 className="gk-cp-page-title">Copy</h1>
        <p className="gk-cp-page-sub">
          Every text we publish ourselves, with today&apos;s text as its default. Placeholders fill
          in automatically: {initial.tokens.map((t) => `{${t}}`).join(' ')}. The domain is display
          text only — page addresses follow the deployment.
        </p>
      </header>

      {msg && <div className="gk-cp-note gk-cp-flash">{msg}</div>}

      <div className="gk-nl-actions" style={{ position: 'sticky', top: 0, zIndex: 2 }}>
        <button
          type="button"
          className="gk-cp-btn is-primary"
          disabled={busy || changed.length === 0}
          onClick={saveChanges}
        >
          {busy
            ? 'Saving…'
            : `Save ${changed.length || ''} change${changed.length === 1 ? '' : 's'}`}
        </button>
        {changed.length > 0 ? (
          <button type="button" className="gk-cp-btn" onClick={() => setValues(saved)}>
            Discard
          </button>
        ) : null}
      </div>

      {initial.groups.map((g) => {
        const defs = byGroup.get(g.key) ?? [];
        if (defs.length === 0 && g.key !== 'locked') return null;
        const isOpen = open === g.key;
        return (
          <section key={g.key} className="gk-cp-card" data-copy-group={g.key}>
            <button
              type="button"
              className="gk-cp-card-title gk-copy-toggle"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? '' : g.key)}
              style={{
                background: 'none',
                border: 0,
                padding: 0,
                cursor: 'pointer',
                color: 'inherit',
                textAlign: 'left',
              }}
            >
              {isOpen ? '▾' : '▸'} {g.label} <span className="gk-cp-dim">· {defs.length}</span>
            </button>
            {isOpen ? (
              <div className="gk-nl-form">
                {g.key === 'identity' && !initial.canEditIdentity ? (
                  <p className="gk-cp-dim gk-nl-field-wide">
                    Only the owner can change the brand and contact details.
                  </p>
                ) : null}
                {g.key === 'docs' ? <p className="gk-cp-dim gk-nl-field-wide">{DOC_HELP}</p> : null}
                {defs.map((d) => {
                  const readOnly = Boolean(d.locked) || (d.ownerOnly && !initial.canEditIdentity);
                  const v = d.locked ? d.default : (values[d.key] ?? d.default);
                  const overridden = d.key in stored;
                  const multi = d.kind === 'doc' || d.kind === 'longtext' || d.kind === 'rich';
                  return (
                    <label
                      key={d.key}
                      className="gk-nl-field gk-nl-field-wide"
                      data-copy-key={d.key}
                    >
                      <span>
                        {d.label}{' '}
                        <span className="gk-cp-dim">
                          · {d.key}
                          {d.locked
                            ? ' · locked (legally required)'
                            : overridden
                              ? ' · edited'
                              : ' · default'}
                        </span>
                      </span>
                      {multi ? (
                        <textarea
                          rows={d.kind === 'doc' ? 18 : 3}
                          maxLength={d.max}
                          readOnly={readOnly}
                          value={v}
                          onChange={(e) => setValues((x) => ({ ...x, [d.key]: e.target.value }))}
                          style={
                            d.kind === 'doc'
                              ? { fontFamily: 'var(--gk-font-mono, monospace)', fontSize: 13 }
                              : undefined
                          }
                        />
                      ) : (
                        <input
                          maxLength={d.max}
                          readOnly={readOnly}
                          value={v}
                          onChange={(e) => setValues((x) => ({ ...x, [d.key]: e.target.value }))}
                        />
                      )}
                      {!readOnly && overridden ? (
                        <span>
                          <button
                            type="button"
                            className="gk-cp-btn"
                            disabled={busy}
                            onClick={() => send({ [d.key]: null })}
                          >
                            Reset to default
                          </button>
                        </span>
                      ) : null}
                    </label>
                  );
                })}
                {g.key === 'locked'
                  ? initial.lockedPages.map((lp) => (
                      <p key={lp.path} className="gk-nl-field-wide">
                        <a className="gk-cp-link" href={lp.path} target="_blank" rel="noreferrer">
                          {lp.label}
                        </a>{' '}
                        <span className="gk-cp-dim">· locked page (legal review) — {lp.note}</span>
                      </p>
                    ))
                  : null}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
