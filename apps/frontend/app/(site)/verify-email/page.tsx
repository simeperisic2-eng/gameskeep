import { Suspense } from 'react';
import type { Metadata } from 'next';
import { VerifyEmail } from '../_components/AuthForms';

export const metadata: Metadata = { title: 'Verify your email', robots: { index: false } };

export default function VerifyEmailPage(): React.JSX.Element {
  return (
    <main className="gk-container gk-authpage">
      <section className="gk-panel gk-authcard">
        <h1 className="gk-auth-title">Verify your email</h1>
        <Suspense fallback={<p className="gk-form-quiet">Loading…</p>}>
          <VerifyEmail />
        </Suspense>
      </section>
    </main>
  );
}
