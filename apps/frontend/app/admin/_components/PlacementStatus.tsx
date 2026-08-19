'use client';

import { useState } from 'react';
import { adminFetch } from '../_lib/adminFetch';

const STATUSES = ['draft', 'scheduled', 'active', 'ended'] as const;

/**
 * Manual activation switch for an ad placement (SPEC I8, Slice 2). No payment
 * gateway — an admin sets the status by hand after off-site payment; `active`
 * lights the labeled Promoted flag. Audited server-side.
 */
export function PlacementStatus({
  id,
  status: initial,
}: {
  id: string;
  status: string;
}): React.JSX.Element {
  const [status, setStatus] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function change(next: string): Promise<void> {
    setBusy(true);
    const res = await adminFetch(`/admin/api/ads/placements/${id}/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: next }),
    });
    setBusy(false);
    if (res.ok) setStatus(next);
    else alert('Could not change the placement status.');
  }

  return (
    <select
      className={`gk-adstatus is-${status}`}
      value={status}
      disabled={busy}
      onChange={(e) => change(e.target.value)}
      aria-label="Placement status"
    >
      {STATUSES.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
}
