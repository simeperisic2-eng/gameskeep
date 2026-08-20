'use client';

import { useState } from 'react';

/**
 * Login-free unsubscribe confirm (SPEC I8, Slice 3). The email links here with a
 * capability token; we DON'T auto-unsubscribe on load (an inbox link-prefetch
 * must not opt someone out) — the user confirms with a click, which POSTs the
 * token to the BFF → backend. Enumeration-safe: the success copy is the same
 * whether or not the token matched a live subscription.
 */
export function UnsubscribeConfirm({ token }: { token: string }): React.JSX.Element {
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');

  if (!token) {
    return (
      <p className="gk-unsub-msg">
        This unsubscribe link is missing its token. Please use the link from your email, or contact
        us if it isn’t working.
      </p>
    );
  }

  if (state === 'done') {
    return (
      <p className="gk-unsub-msg">
        You’ve been unsubscribed. You won’t receive further GamesKeep emails. You can re-subscribe
        any time from the site.
      </p>
    );
  }

  async function confirm(): Promise<void> {
    setState('busy');
    try {
      await fetch('/api/newsletter/unsubscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      });
    } catch {
      /* generic outcome either way */
    }
    setState('done');
  }

  return (
    <div className="gk-unsub">
      <p className="gk-unsub-msg">
        Unsubscribe this email address from GamesKeep updates? You can re-subscribe any time.
      </p>
      <button className="gk-doc-cta" type="button" disabled={state === 'busy'} onClick={confirm}>
        {state === 'busy' ? 'Unsubscribing…' : 'Confirm unsubscribe'}
      </button>
    </div>
  );
}
