import type { Metadata } from 'next';
import { ComingSoon } from '../_components/ComingSoon';

export const metadata: Metadata = { title: 'Awards', robots: { index: false } };

export default function AwardsPage(): React.JSX.Element {
  return (
    <ComingSoon
      eyebrow="GamesKeep Awards"
      title="The Awards are coming soon"
      body="An annual program where every nominee shows our deeper analytics — three scores, the disconnect, player trends — so voters can actually decide. Critics' Choice and Community Choice, side by side."
    />
  );
}
