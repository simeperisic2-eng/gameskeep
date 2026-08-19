'use client';

import { useState } from 'react';
import { apiPost, resetCsrf } from '@/lib/client';

/** Sign out of the Control Panel (session cookie revoked server-side), then to login. */
export function AdminSignOut(): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  async function signOut(): Promise<void> {
    setBusy(true);
    await apiPost('/api/auth/logout');
    resetCsrf();
    window.location.href = '/login';
  }
  return (
    <button type="button" className="gk-cp-signout" onClick={signOut} disabled={busy}>
      {busy ? '…' : 'Sign out'}
    </button>
  );
}
