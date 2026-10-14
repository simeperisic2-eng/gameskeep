import type { Metadata } from 'next';
import { getBriefingOverride, getRulesConfig } from '../lib';
import { RulesManager } from '../_components/RulesManager';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Rules & limits · Control Panel',
  robots: { index: false },
};

export default async function RulesPage(): Promise<React.JSX.Element> {
  const [initial, briefing] = await Promise.all([getRulesConfig(), getBriefingOverride()]);
  return <RulesManager initial={initial} briefing={briefing} />;
}
