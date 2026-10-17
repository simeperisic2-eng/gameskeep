import type { Metadata } from 'next';
import { getBriefingOverride, getCommunityKnobs, getReputationKnobs, getRulesConfig } from '../lib';
import { RulesManager } from '../_components/RulesManager';
import { CommunityKnobsCard } from '../_components/CommunityKnobsCard';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Rules & limits · Control Panel',
  robots: { index: false },
};

export default async function RulesPage(): Promise<React.JSX.Element> {
  const [initial, briefing, community, reputation] = await Promise.all([
    getRulesConfig(),
    getBriefingOverride(),
    getCommunityKnobs(),
    getReputationKnobs(),
  ]);
  return (
    <>
      <RulesManager initial={initial} briefing={briefing} />
      {/* Phase P S5: the community + reputation knobs (database-only until S5). */}
      <div className="gk-cp-page" style={{ paddingTop: 0 }}>
        <CommunityKnobsCard community={community} reputation={reputation} />
      </div>
    </>
  );
}
