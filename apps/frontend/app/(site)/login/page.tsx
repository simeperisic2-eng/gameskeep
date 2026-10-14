import type { Metadata } from 'next';
import { LoginForm } from '../_components/AuthForms';
import { getSite } from '@/lib/site';

export const metadata: Metadata = { title: 'Sign in', robots: { index: false } };

export default async function LoginPage(): Promise<React.JSX.Element> {
  const site = await getSite();
  return (
    <main className="gk-container gk-authpage">
      <section className="gk-panel gk-authcard">
        <h1 className="gk-auth-title">Sign in</h1>
        <p className="gk-auth-sub">Welcome back to {site.brand}.</p>
        {/* LoginForm has no useSearchParams → it SSRs; the fields paint immediately. */}
        <LoginForm />
      </section>
    </main>
  );
}
