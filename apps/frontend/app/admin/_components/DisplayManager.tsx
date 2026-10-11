'use client';

import { useState } from 'react';
import { adminFetch } from '../_lib/adminFetch';
import type { DisplayConfig, IntegrityLexicon } from '../lib';

/**
 * Public display switches (Phase P S1). What the public site SHOWS — the engines
 * compute everywhere regardless. Each save writes only the changed app_settings
 * keys and is audited (old → new). A keyword-list change re-scans the feed.
 */
type LexKey = keyof IntegrityLexicon;

const LEX_FIELDS: { key: LexKey; label: string; hint: string }[] = [
  { key: 'reviewCopy', label: 'Review copy', hint: 'phrases that evidence a publisher copy' },
  { key: 'embargo', label: 'Embargo', hint: 'phrases that evidence a review embargo' },
  {
    key: 'sponsoredEvent',
    label: 'Sponsored event / press trip',
    hint: 'paid travel, hosted events',
  },
  {
    key: 'negations',
    label: 'Negations',
    hint: 'a clause containing one of these is NOT a signal',
  },
];

const toLines = (list: string[]): string => list.join('\n');
const fromLines = (text: string): string[] =>
  text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

export function DisplayManager({ initial }: { initial: DisplayConfig }): React.JSX.Element {
  const [cfg, setCfg] = useState(initial);
  const [lex, setLex] = useState<Record<LexKey, string>>({
    reviewCopy: toLines(initial.integrityLexicon.reviewCopy),
    embargo: toLines(initial.integrityLexicon.embargo),
    sponsoredEvent: toLines(initial.integrityLexicon.sponsoredEvent),
    negations: toLines(initial.integrityLexicon.negations),
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save(): Promise<void> {
    setBusy(true);
    setMsg(null);
    try {
      const lexicon: IntegrityLexicon = {
        reviewCopy: fromLines(lex.reviewCopy),
        embargo: fromLines(lex.embargo),
        sponsoredEvent: fromLines(lex.sponsoredEvent),
        negations: fromLines(lex.negations),
      };
      const lexChanged = JSON.stringify(lexicon) !== JSON.stringify(cfg.integrityLexicon);
      const res = await adminFetch('/admin/api/display/config', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          displayScope: cfg.displayScope,
          showQuality: cfg.showQuality,
          topicBiasVotes: cfg.topicBiasVotes,
          briefingWindowHours: cfg.briefingWindowHours,
          integrityAutoPublish: cfg.integrityAutoPublish,
          ...(lexChanged ? { integrityLexicon: lexicon } : {}),
        }),
      });
      if (res.ok) {
        const body = (await res.json()) as { data: DisplayConfig; rescanJobId: string | null };
        setCfg(body.data);
        // Show the stored (normalized) lists, so the next save compares like for like.
        setLex({
          reviewCopy: toLines(body.data.integrityLexicon.reviewCopy),
          embargo: toLines(body.data.integrityLexicon.embargo),
          sponsoredEvent: toLines(body.data.integrityLexicon.sponsoredEvent),
          negations: toLines(body.data.integrityLexicon.negations),
        });
        setMsg(
          body.rescanJobId
            ? 'Saved. The feed is being re-scanned with the new keywords.'
            : 'Saved. Public pages use this on their next render.',
        );
      } else {
        const j = (await res.json().catch(() => ({}))) as { message?: string };
        setMsg(`Save failed: ${j.message ?? res.status}`);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="gk-cp-page">
      <header className="gk-cp-page-head">
        <h1 className="gk-cp-page-title">Display &amp; bias</h1>
        <p className="gk-cp-page-sub">
          What the public site shows. The bias engine still scores every article — these switches
          only decide where signals render. Every change is audited.
        </p>
      </header>

      {msg && <div className="gk-cp-note gk-cp-flash">{msg}</div>}

      <section className="gk-cp-card">
        <h2 className="gk-cp-card-title">Bias display</h2>
        <div className="gk-nl-form">
          <label className="gk-nl-field gk-nl-field-wide">
            <span>
              Display scope <span className="gk-cp-dim">· bias.display_scope</span>
            </span>
            <select
              value={cfg.displayScope}
              onChange={(e) =>
                setCfg((c) => ({
                  ...c,
                  displayScope: e.target.value as DisplayConfig['displayScope'],
                }))
              }
            >
              <option value="reviews_and_sponsored">
                Reviews + sponsored only (others: a Sponsored chip at most)
              </option>
              <option value="all">Everywhere</option>
            </select>
          </label>
          <label className="gk-nl-check gk-nl-field-wide">
            <input
              type="checkbox"
              checked={cfg.showQuality}
              onChange={(e) => setCfg((c) => ({ ...c, showQuality: e.target.checked }))}
            />
            <span>
              Show the <b>quality</b> axis{' '}
              <span className="gk-cp-dim">
                · bias.show_quality — also the outlet Reputation stat
              </span>
            </span>
          </label>
          <label className="gk-nl-check gk-nl-field-wide">
            <input
              type="checkbox"
              checked={cfg.topicBiasVotes}
              onChange={(e) => setCfg((c) => ({ ...c, topicBiasVotes: e.target.checked }))}
            />
            <span>
              Reader <b>bias votes on topics</b>{' '}
              <span className="gk-cp-dim">
                · community.topic_bias_votes — when off the widget is hidden and the vote endpoint
                rejects; existing votes are kept
              </span>
            </span>
          </label>
          <label className="gk-nl-field">
            <span>
              Briefing window (hours) <span className="gk-cp-dim">· the “today” counts</span>
            </span>
            <input
              type="number"
              min={1}
              max={168}
              value={String(cfg.briefingWindowHours)}
              onChange={(e) =>
                setCfg((c) => ({ ...c, briefingWindowHours: Number(e.target.value) }))
              }
            />
          </label>
        </div>
      </section>

      <section className="gk-cp-card">
        <h2 className="gk-cp-card-title">Review integrity</h2>
        <div className="gk-nl-form">
          <label className="gk-nl-check gk-nl-field-wide">
            <input
              type="checkbox"
              checked={cfg.integrityAutoPublish}
              onChange={(e) => setCfg((c) => ({ ...c, integrityAutoPublish: e.target.checked }))}
            />
            <span>
              <b>Auto-publish</b> detected signals{' '}
              <span className="gk-cp-dim">
                · integrity.autoPublish — off: a moderator must confirm each one in{' '}
                <a className="gk-cp-link" href="/admin/integrity">
                  Review integrity
                </a>{' '}
                before it shows
              </span>
            </span>
          </label>
          {LEX_FIELDS.map((f) => (
            <label key={f.key} className="gk-nl-field">
              <span>
                {f.label} <span className="gk-cp-dim">· {f.hint} (one per line)</span>
              </span>
              <textarea
                rows={5}
                value={lex[f.key]}
                onChange={(e) => setLex((l) => ({ ...l, [f.key]: e.target.value }))}
              />
            </label>
          ))}
          <div className="gk-nl-actions">
            <button className="gk-cp-btn is-primary" type="button" disabled={busy} onClick={save}>
              Save display settings
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
