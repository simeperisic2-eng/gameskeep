'use client';

import { useState } from 'react';

/**
 * "Promote your game" enquiry (SPEC I8, Slice 2; BLUEPRINT §2.4). Deliberately
 * email-only — no backend submission/moderation (that's a later phase). The form
 * composes a mailto so the arrangement happens by email; an admin then creates +
 * manually activates a labeled Promoted placement once payment lands off-site.
 */
// [[OWNER-TODO: confirm the promotions contact address before launch — currently
// wrathsystems@gmail.com]]
const CONTACT = 'wrathsystems@gmail.com';

export function PromoteForm(): React.JSX.Element {
  const [game, setGame] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');

  function submit(e: React.FormEvent): void {
    e.preventDefault();
    const subject = encodeURIComponent(`Promote a game — ${game || '(game)'}`);
    const body = encodeURIComponent(
      `Game / studio: ${game}\nBest contact: ${email}\n\n${message}\n\n— Sent from the GamesKeep “Promote your game” page`,
    );
    window.location.href = `mailto:${CONTACT}?subject=${subject}&body=${body}`;
  }

  return (
    <form className="gk-promote-form" onSubmit={submit}>
      <label className="gk-promote-field">
        <span>Game or studio</span>
        <input value={game} onChange={(e) => setGame(e.target.value)} required maxLength={160} />
      </label>
      <label className="gk-promote-field">
        <span>Best contact email</span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          maxLength={200}
          autoComplete="email"
        />
      </label>
      <label className="gk-promote-field">
        <span>What you’d like to promote</span>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={4}
          maxLength={2000}
          placeholder="Launch window, where you’d like the placement, budget…"
        />
      </label>
      <button type="submit" className="gk-doc-cta">
        Email us your enquiry
      </button>
    </form>
  );
}
