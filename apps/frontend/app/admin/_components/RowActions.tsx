'use client';

import { useState } from 'react';
import { adminFetch } from '../_lib/adminFetch';

interface Props {
  resource: string;
  id: string;
}

export default function RowActions({ resource, id }: Props) {
  const [busy, setBusy] = useState(false);

  async function onDelete() {
    if (!confirm('Delete this row? This cannot be undone.')) return;
    setBusy(true);
    try {
      const res = await adminFetch(`/admin/api/${resource}/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const json: unknown = await res.json().catch(() => ({}));
        const msg =
          json && typeof json === 'object'
            ? ((json as { message?: string }).message ?? 'Delete failed')
            : 'Delete failed';
        alert(msg);
        setBusy(false);
        return;
      }
      window.location.reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <span className="gk-row-actions">
      <a className="gk-btn gk-btn-sm" href={`/admin/${resource}/${id}`}>
        Edit
      </a>
      <button
        type="button"
        className="gk-btn gk-btn-sm gk-btn-danger"
        onClick={onDelete}
        disabled={busy}
      >
        {busy ? '…' : 'Delete'}
      </button>
    </span>
  );
}
