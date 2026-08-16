'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiPost, resetCsrf } from '@/lib/client';
import { safeNext } from '@/lib/nav';

/** Auth forms (SPEC I6, Slice 8) — thin clients over the same-origin auth BFF. */

function Field(props: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  name: string;
}): React.JSX.Element {
  return (
    <label className="gk-field">
      <span>{props.label}</span>
      <input
        className="gk-input"
        type={props.type}
        name={props.name}
        value={props.value}
        autoComplete={props.autoComplete}
        onChange={(e) => props.onChange(e.target.value)}
        required
      />
    </label>
  );
}

export function LoginForm(): React.JSX.Element {
  const router = useRouter();
  const [identifier, setId] = useState('');
  const [password, setPw] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const r = await apiPost('/api/auth/login', { identifier, password });
    setBusy(false);
    if (r.ok) {
      resetCsrf();
      // Read ?next at submit-time (client) so this form has NO useSearchParams and
      // renders server-side immediately — no "Loading…" flash on first paint.
      // safeNext() rejects off-site targets (open-redirect guard, review #3).
      const next = safeNext(new URLSearchParams(window.location.search).get('next'));
      router.push(next);
      router.refresh();
    } else if (r.status === 429) {
      setErr('Too many attempts — please wait a bit and try again.');
    } else {
      setErr('Invalid username/email or password.');
    }
  }

  return (
    <form className="gk-authform" onSubmit={submit}>
      {err ? <p className="gk-form-error">{err}</p> : null}
      <Field
        label="Username or email"
        type="text"
        name="identifier"
        value={identifier}
        onChange={setId}
        autoComplete="username"
      />
      <Field
        label="Password"
        type="password"
        name="password"
        value={password}
        onChange={setPw}
        autoComplete="current-password"
      />
      <button className="gk-btn-amber gk-btn-block" type="submit" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
      <p className="gk-form-alt">
        New here? <a href="/register">Create an account</a> ·{' '}
        <a href="/reset-password">Forgot password?</a>
      </p>
    </form>
  );
}

export function RegisterForm(): React.JSX.Element {
  const [username, setU] = useState('');
  const [email, setE] = useState('');
  const [password, setPw] = useState('');
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const r = await apiPost('/api/auth/register', { username, email, password });
    setBusy(false);
    // Enumeration-safe: a valid request is 202; only a taken public username 409s.
    if (r.status === 202) setDone(true);
    else if (r.status === 409) setErr('That username is taken — try another.');
    else if (r.status === 400)
      setErr('Check your details: username 3–32 chars, valid email, password ≥ 8.');
    else setErr('Something went wrong — please retry.');
  }

  if (done) {
    return (
      <div className="gk-auth-done">
        <h2>Check your inbox</h2>
        <p>
          If those details are valid, a verification link is on its way. In the demo, the email
          lands in the dev outbox (no real mail is sent).
        </p>
        <a className="gk-btn-ghost" href="/login">
          Back to sign in
        </a>
      </div>
    );
  }

  return (
    <form className="gk-authform" onSubmit={submit}>
      {err ? <p className="gk-form-error">{err}</p> : null}
      <Field
        label="Username"
        type="text"
        name="username"
        value={username}
        onChange={setU}
        autoComplete="username"
      />
      <Field
        label="Email"
        type="email"
        name="email"
        value={email}
        onChange={setE}
        autoComplete="email"
      />
      <Field
        label="Password"
        type="password"
        name="password"
        value={password}
        onChange={setPw}
        autoComplete="new-password"
      />
      <button className="gk-btn-amber gk-btn-block" type="submit" disabled={busy}>
        {busy ? 'Creating…' : 'Create account'}
      </button>
      <p className="gk-form-alt">
        Already have an account? <a href="/login">Sign in</a>
      </p>
    </form>
  );
}

export function VerifyEmail(): React.JSX.Element {
  const token = useSearchParams().get('token') || '';
  const router = useRouter();
  const [state, setState] = useState<'working' | 'ok' | 'bad'>('working');

  useEffect(() => {
    if (!/^[a-f0-9]{64}$/.test(token)) {
      setState('bad');
      return;
    }
    apiPost('/api/auth/verify-email', { token }).then((r) => {
      setState(r.ok ? 'ok' : 'bad');
      if (r.ok) resetCsrf();
    });
  }, [token]);

  if (state === 'working') return <p className="gk-form-quiet">Verifying your email…</p>;
  if (state === 'ok') {
    return (
      <div className="gk-auth-done">
        <h2>Email verified ✓</h2>
        <p>You’re signed in. You can now rate games, vote and comment.</p>
        <button
          className="gk-btn-amber"
          type="button"
          onClick={() => {
            router.push('/feed');
            router.refresh();
          }}
        >
          Go to Your Feed
        </button>
      </div>
    );
  }
  return (
    <div className="gk-auth-done">
      <h2>That link didn’t work</h2>
      <p>The verification link is invalid or has expired. Request a fresh one from your account.</p>
      <a className="gk-btn-ghost" href="/login">
        Sign in
      </a>
    </div>
  );
}

export function ResetPassword(): React.JSX.Element {
  const token = useSearchParams().get('token') || '';
  const isConfirm = /^[a-f0-9]{64}$/.test(token);
  const router = useRouter();
  const [email, setE] = useState('');
  const [password, setPw] = useState('');
  const [sent, setSent] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function requestReset(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    await apiPost('/api/auth/request-password-reset', { email });
    setBusy(false);
    setSent(true); // enumeration-safe: always the same response
  }
  async function confirmReset(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const r = await apiPost('/api/auth/reset-password', { token, password });
    setBusy(false);
    if (r.ok) setDone(true);
    else setErr('That reset link is invalid or has expired, or the password is too short.');
  }

  if (done) {
    return (
      <div className="gk-auth-done">
        <h2>Password updated ✓</h2>
        <p>All your other sessions were signed out. Sign in with your new password.</p>
        <button className="gk-btn-amber" type="button" onClick={() => router.push('/login')}>
          Sign in
        </button>
      </div>
    );
  }

  if (isConfirm) {
    return (
      <form className="gk-authform" onSubmit={confirmReset}>
        {err ? <p className="gk-form-error">{err}</p> : null}
        <Field
          label="New password"
          type="password"
          name="password"
          value={password}
          onChange={setPw}
          autoComplete="new-password"
        />
        <button className="gk-btn-amber gk-btn-block" type="submit" disabled={busy}>
          {busy ? 'Updating…' : 'Set new password'}
        </button>
      </form>
    );
  }

  if (sent) {
    return (
      <div className="gk-auth-done">
        <h2>Check your inbox</h2>
        <p>
          If an account exists for that email, a reset link is on its way (dev outbox in the demo).
        </p>
        <a className="gk-btn-ghost" href="/login">
          Back to sign in
        </a>
      </div>
    );
  }

  return (
    <form className="gk-authform" onSubmit={requestReset}>
      <Field
        label="Email"
        type="email"
        name="email"
        value={email}
        onChange={setE}
        autoComplete="email"
      />
      <button className="gk-btn-amber gk-btn-block" type="submit" disabled={busy}>
        {busy ? 'Sending…' : 'Send reset link'}
      </button>
      <p className="gk-form-alt">
        Remembered it? <a href="/login">Sign in</a>
      </p>
    </form>
  );
}
