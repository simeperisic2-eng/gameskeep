import type { Metadata } from 'next';
import { LoginForm } from '../_components/AuthForms';

export const metadata: Metadata = { title: 'Sign in', robots: { index: false } };

export default function LoginPage(): React.JSX.Element {
  return (
    <main className="gk-container gk-authpage">
      <section className="gk-panel gk-authcard">
        <h1 className="gk-auth-title">Sign in</h1>
        <p className="gk-auth-sub">Welcome back to GamesKeep.</p>
        {/* LoginForm has no useSearchParams → it SSRs; the fields paint immediately. */}
        <LoginForm />
      </section>
    </main>
  );
}
