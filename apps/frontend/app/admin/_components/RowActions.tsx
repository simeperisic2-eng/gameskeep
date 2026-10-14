'use client';

import { useState } from 'react';
import { adminFetch } from '../_lib/adminFetch';

interface Props {
  resource: string;
  id: string;
  /**
   * Phase P S3b: third-party data — deleting it needs an import-error reason
   * (the backend enforces it; this picks one).
   */
  reasons?: { value: string; label: string }[];
}

function errorText(json: unknown, fallback: string): string {
  if (!json || typeof json !== 'object') return fallback;
  const j = json as { message?: string; issues?: { message?: string }[] };
  return j.issues?.[0]?.message ?? j.message ?? fallback;
}

export default function RowActions({ resource, id, reasons }: Props) {
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');

  async function onDelete() {
    if (!confirm('Delete this row? This cannot be undone.')) return;
    setBusy(true);
    try {
      const q = reason ? `?reason=${encodeURIComponent(reason)}` : '';
      const res = await adminFetch(`/admin/api/${resource}/${id}${q}`, { method: 'DELETE' });
      if (!res.ok) {
        alert(errorText(await res.json().catch(() => ({})), 'Delete failed'));
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
      {reasons?.length ? (
        <select
          className="gk-btn-sm"
          aria-label="Reason for deleting third-party data"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        >
          <option value="">Import-error reason…</option>
          {reasons.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      ) : null}
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
