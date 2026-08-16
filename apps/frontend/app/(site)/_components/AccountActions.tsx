'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiPost, resetCsrf } from '@/lib/client';

/**
 * Account data controls (SPEC I6, Slice 8, GDPR): export your data as JSON and
 * delete your account. Delete RE-CONFIRMS the password (anti-hijack) and is
 * gated behind an explicit confirmation — the most destructive action gets
 * friction.
 */
export function AccountActions(): React.JSX.Element {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function exportData(): Promise<void> {
    const r = await fetch('/api/auth/export', { cache: 'no-store' });
    if (!r.ok) return;
    const blob = new Blob([JSON.stringify(await r.json(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'gameskeep-export.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function del(): Promise<void> {
    setBusy(true);
    setErr(null);
    const r = await apiPost('/api/auth/delete-account', { password });
    setBusy(false);
    if (r.ok) {
      resetCsrf();
      router.push('/');
      router.refresh();
    } else if (r.status === 403) {
      setErr('That password is incorrect.');
    } else {
      setErr('Could not delete the account — please retry.');
    }
  }

  return (
    <div className="gk-account-actions">
      <div className="gk-account-action">
        <div>
          <h3>Export your data</h3>
          <p>
            Download everything we hold about you — profile, ratings, votes, comments, follows,
            consents — as JSON.
          </p>
        </div>
        <button className="gk-btn-ghost" type="button" onClick={exportData}>
          Download JSON
        </button>
      </div>

      <div className="gk-account-action gk-account-danger">
        <div>
          <h3>Delete your account</h3>
          <p>
            Your personal data is erased and your email is freed. Your ratings and votes stay (now
            anonymous) so the community scores stay honest; your comments become “[deleted]”.
          </p>
        </div>
        {confirming ? (
          <div className="gk-delete-confirm">
            {err ? <p className="gk-form-error">{err}</p> : null}
            <input
              className="gk-input"
              type="password"
              placeholder="Confirm your password"
              value={password}
              autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
            />
            <div className="gk-delete-confirm-row">
              <button className="gk-btn-ghost" type="button" onClick={() => setConfirming(false)}>
                Cancel
              </button>
              <button
                className="gk-btn-danger"
                type="button"
                onClick={del}
                disabled={busy || !password}
              >
                {busy ? 'Deleting…' : 'Permanently delete'}
              </button>
            </div>
          </div>
        ) : (
          <button className="gk-btn-danger" type="button" onClick={() => setConfirming(true)}>
            Delete account
          </button>
        )}
      </div>
    </div>
  );
}
