import { Suspense } from 'react';
import type { Metadata } from 'next';
import { ResetPassword } from '../_components/AuthForms';

export const metadata: Metadata = { title: 'Reset your password', robots: { index: false } };

export default function ResetPasswordPage(): React.JSX.Element {
  return (
    <main className="gk-container gk-authpage">
      <section className="gk-panel gk-authcard">
        <h1 className="gk-auth-title">Reset your password</h1>
        <Suspense fallback={<p className="gk-form-quiet">Loading…</p>}>
          <ResetPassword />
        </Suspense>
      </section>
    </main>
  );
}
