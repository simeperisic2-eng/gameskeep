'use client';

import { useState } from 'react';
import type { FieldSpec } from '../lib';

type Option = { id: string; label: string };
type FieldValue = string | boolean;

interface Props {
  resource: string;
  mode: 'create' | 'edit';
  id?: string;
  fields: FieldSpec[];
  initial: Record<string, unknown>;
  refOptions: Record<string, Option[]>;
}

function toFieldValue(field: FieldSpec, value: unknown): FieldValue {
  if (field.type === 'boolean') return Boolean(value);
  if (value === null || value === undefined) return '';
  if (field.type === 'json') return typeof value === 'string' ? value : JSON.stringify(value);
  return String(value);
}

function formatError(json: unknown): string {
  if (json && typeof json === 'object') {
    const j = json as {
      issues?: { path?: (string | number)[]; message?: string }[];
      message?: string;
      error?: string;
    };
    if (Array.isArray(j.issues) && j.issues.length > 0) {
      return j.issues
        .map((i) => `${(i.path ?? []).join('.') || '(field)'}: ${i.message ?? 'invalid'}`)
        .join('; ');
    }
    return j.message ?? j.error ?? 'Request failed';
  }
  return 'Request failed';
}

export default function ResourceForm({ resource, mode, id, fields, initial, refOptions }: Props) {
  const [state, setState] = useState<Record<string, FieldValue>>(() => {
    const init: Record<string, FieldValue> = {};
    for (const f of fields) init[f.name] = toFieldValue(f, initial[f.name]);
    return init;
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function set(name: string, value: FieldValue) {
    setState((s) => ({ ...s, [name]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const payload: Record<string, unknown> = {};
    for (const f of fields) {
      const v = state[f.name];
      if (f.type === 'boolean') {
        payload[f.name] = Boolean(v);
        continue;
      }
      const s = (v as string) ?? '';
      if (s === '') continue;
      if (f.type === 'number') {
        const n = Number(s);
        if (Number.isNaN(n)) {
          setError(`${f.name} must be a number`);
          return;
        }
        payload[f.name] = n;
      } else if (f.type === 'json') {
        try {
          payload[f.name] = JSON.parse(s);
        } catch {
          setError(`${f.name} is not valid JSON`);
          return;
        }
      } else {
        payload[f.name] = s;
      }
    }

    setBusy(true);
    try {
      const path = mode === 'create' ? `/admin/api/${resource}` : `/admin/api/${resource}/${id}`;
      const res = await fetch(path, {
        method: mode === 'create' ? 'POST' : 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(formatError(json));
        setBusy(false);
        return;
      }
      window.location.href = `/admin/${resource}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="gk-form">
      {fields.map((f) => (
        <label key={f.name} className="gk-field">
          <span className="gk-field-label">
            {f.name}
            {f.required ? <span className="gk-req"> *</span> : null}
            {f.help ? <span className="gk-field-help"> — {f.help}</span> : null}
          </span>

          {f.type === 'boolean' ? (
            <input
              type="checkbox"
              checked={Boolean(state[f.name])}
              onChange={(e) => set(f.name, e.target.checked)}
            />
          ) : f.type === 'enum' ? (
            <select
              value={String(state[f.name] ?? '')}
              onChange={(e) => set(f.name, e.target.value)}
            >
              <option value="">—</option>
              {(f.options ?? []).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ) : f.type === 'ref' ? (
            <select
              value={String(state[f.name] ?? '')}
              onChange={(e) => set(f.name, e.target.value)}
            >
              <option value="">—</option>
              {(refOptions[f.name] ?? []).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : f.type === 'textarea' || f.type === 'json' ? (
            <textarea
              rows={f.type === 'json' ? 2 : 4}
              value={String(state[f.name] ?? '')}
              onChange={(e) => set(f.name, e.target.value)}
            />
          ) : (
            <input
              type={f.type === 'number' ? 'number' : 'text'}
              step={f.type === 'number' ? 'any' : undefined}
              value={String(state[f.name] ?? '')}
              onChange={(e) => set(f.name, e.target.value)}
            />
          )}
        </label>
      ))}

      {error ? <p className="gk-form-error">{error}</p> : null}

      <div className="gk-form-actions">
        <button type="submit" className="gk-btn gk-btn-primary" disabled={busy}>
          {busy ? 'Saving…' : mode === 'create' ? 'Create' : 'Save changes'}
        </button>
        <a className="gk-btn" href={`/admin/${resource}`}>
          Cancel
        </a>
      </div>
    </form>
  );
}
