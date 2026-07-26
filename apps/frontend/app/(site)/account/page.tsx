import type { Metadata } from 'next';
import { ComingSoon } from '../_components/ComingSoon';

export const metadata: Metadata = { title: 'Sign in', robots: { index: false } };

export default function AccountPage(): React.JSX.Element {
  return (
    <ComingSoon
      eyebrow="Accounts"
      title="Sign-in arrives with user accounts"
      body="Rate games, trust-vote articles, follow games and topics, and earn a level — all coming with the accounts phase (I6). For now, browse freely; nothing here needs an account."
    />
  );
}
