'use client';

import { useState } from 'react';
import { apiPost } from '@/lib/client';
import { RichText } from './DocBody';
import { useSite } from './SiteProvider';

/**
 * Awards "notify me" (SPEC I7, Slice 3). Marketing is a SEPARATE, EXPLICIT
 * opt-in: the box is unchecked by default and the submit is blocked until it's
 * ticked (the backend also rejects a consent-less subscribe). Works for anyone —
 * anonymous or signed-in. Posts through the same-origin BFF with a CSRF token.
 */
export function AwardsSubscribe(): React.JSX.Element {
  const site = useSite();
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [msg, setMsg] = useState('');

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!consent) {
      setState('error');
      setMsg('Please tick the box to opt in.');
      return;
    }
    setState('sending');
    const r = await apiPost('/api/awards/subscribe', { email, consent });
    if (r.ok) {
      setState('done');
      setMsg('Thanks — we’ll email you when voting opens.');
    } else {
      setState('error');
      setMsg(r.message ?? 'Something went wrong — please retry.');
    }
  }

  if (state === 'done') {
    return (
      <div className="gk-aw-sub-done" role="status">
        ✓ {msg}
      </div>
    );
  }

  return (
    <form className="gk-aw-sub" onSubmit={submit} noValidate>
      <label className="gk-aw-sub-field">
        <span className="gk-aw-sub-label">Email address</span>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
        />
      </label>
      <label className="gk-aw-sub-consent">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        {/* Locked consent wording (legally required) — the brand fills in. */}
        <span>
          <RichText nodes={site.rich['consent.awards'] ?? []} />
        </span>
      </label>
      <button type="submit" className="gk-doc-cta" disabled={state === 'sending'}>
        {state === 'sending' ? 'Subscribing…' : 'Notify me'}
      </button>
      {state === 'error' ? (
        <p className="gk-aw-sub-err" role="alert">
          {msg}
        </p>
      ) : null}
    </form>
  );
}
