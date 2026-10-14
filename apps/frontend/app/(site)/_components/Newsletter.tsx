'use client';

import { useState } from 'react';
import { apiPost } from '@/lib/client';
import { RichText } from './DocBody';
import { useSite } from './SiteProvider';

/**
 * Newsletter sign-up (Phase P S2): the SAME explicit-opt-in path as the Awards
 * sign-up (I8) — the consent box is unticked by default and the submit is blocked
 * until it's ticked; the backend also rejects a consent-less subscribe and
 * records the consent version + a coarsened IP. Double opt-in arrives in S8 for
 * both forms. Title is the section's (admin-editable).
 */
export function Newsletter({
  title = 'The briefing, by email',
}: {
  title?: string;
}): React.JSX.Element {
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
    const r = await apiPost('/api/awards/subscribe', { email, consent, source: 'homepage' });
    if (r.ok) {
      setState('done');
      setMsg('You’re subscribed — you can unsubscribe from any email.');
    } else {
      setState('error');
      setMsg(r.message ?? 'Something went wrong — please retry.');
    }
  }

  return (
    <section className="gk-newsletter" aria-label="Newsletter signup">
      <span className="gk-eyebrow">{site.t('home.newsletter.eyebrow')}</span>
      <h3>{title}</h3>
      <p>{site.t('home.newsletter.sub')}</p>
      {state === 'done' ? (
        <p className="gk-news-done" role="status">
          ✓ {msg}
        </p>
      ) : (
        <form className="gk-news-form-wrap" onSubmit={submit} noValidate>
          <div className="gk-news-form">
            <input
              type="email"
              name="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              aria-label="Email address"
              autoComplete="email"
            />
            <button className="gk-btn-amber" type="submit" disabled={state === 'sending'}>
              {state === 'sending' ? 'Subscribing…' : 'Subscribe'}
            </button>
          </div>
          <label className="gk-news-consent">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            {/* Locked consent wording (legally required) — the brand fills in. */}
            <span>
              <RichText nodes={site.rich['consent.newsletter'] ?? []} />
            </span>
          </label>
          {state === 'error' ? (
            <p className="gk-news-err" role="alert">
              {msg}
            </p>
          ) : null}
        </form>
      )}
    </section>
  );
}
