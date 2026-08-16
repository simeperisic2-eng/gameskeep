import type { Metadata } from 'next';
import { RegisterForm } from '../_components/AuthForms';

export const metadata: Metadata = { title: 'Create your account', robots: { index: false } };

export default function RegisterPage(): React.JSX.Element {
  return (
    <main className="gk-container gk-authpage">
      <section className="gk-panel gk-authcard">
        <h1 className="gk-auth-title">Create your account</h1>
        <p className="gk-auth-sub">
          Rate games, trust-vote articles, comment and follow — credibility-weighted,
          manipulation-aware.
        </p>
        <RegisterForm />
      </section>
    </main>
  );
}
