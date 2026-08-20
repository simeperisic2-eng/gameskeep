'use client';

import { useState } from 'react';
import { apiPost } from '@/lib/client';

/**
 * "Suggest a missing game" (Upcoming enrichment, decision 3). A public, free
 * submission — works for anyone, no account needed. It files into the editor
 * review queue and NEVER publishes directly; the copy says so. Posts through the
 * same-origin BFF with a CSRF token; the backend validates + rate-limits + files
 * a pending row. Input is escaped by React on any echo.
 */
export function SuggestGameForm(): React.JSX.Element {
  const [name, setName] = useState('');
  const [platform, setPlatform] = useState('');
  const [note, setNote] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [msg, setMsg] = useState('');

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!name.trim()) {
      setState('error');
      setMsg('Please enter a game name.');
      return;
    }
    setState('sending');
    const r = await apiPost('/api/public/suggest-game', {
      name,
      platform: platform || undefined,
      note: note || undefined,
    });
    if (r.ok) {
      setState('done');
      setMsg('Thanks — an editor will review your suggestion before it’s added.');
    } else {
      setState('error');
      setMsg(r.message ?? 'Something went wrong — please retry.');
    }
  }

  if (state === 'done') {
    return (
      <div className="gk-suggest-done" role="status">
        ✓ {msg}
      </div>
    );
  }

  return (
    <form className="gk-suggest-form" onSubmit={submit} noValidate>
      <p className="gk-suggest-lede">
        Spotted a game we’re missing? Suggest it. Submissions go to our editors for review —
        <strong> nothing is published automatically</strong>.
      </p>
      <div className="gk-suggest-row">
        <label className="gk-suggest-field">
          <span>Game name</span>
          <input
            value={name}
            maxLength={200}
            required
            placeholder="e.g. Silksong"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="gk-suggest-field">
          <span>Platform (optional)</span>
          <input
            value={platform}
            maxLength={80}
            placeholder="PC, PS5…"
            onChange={(e) => setPlatform(e.target.value)}
          />
        </label>
      </div>
      <label className="gk-suggest-field">
        <span>Anything else (optional)</span>
        <textarea
          value={note}
          maxLength={1000}
          rows={2}
          placeholder="A link, the developer, the expected release…"
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <div className="gk-suggest-actions">
        <button type="submit" className="gk-doc-cta" disabled={state === 'sending'}>
          {state === 'sending' ? 'Sending…' : 'Suggest this game'}
        </button>
        {state === 'error' ? (
          <p className="gk-suggest-err" role="alert">
            {msg}
          </p>
        ) : null}
      </div>
    </form>
  );
}
