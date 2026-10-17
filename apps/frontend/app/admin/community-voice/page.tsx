import type { Metadata } from 'next';
import { getCommunityVoiceData } from '../lib';
import { CommunityVoiceManager } from '../_components/CommunityVoiceManager';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Community voice · Control Panel',
  robots: { index: false },
};

export default async function CommunityVoicePage(): Promise<React.JSX.Element> {
  return <CommunityVoiceManager initial={await getCommunityVoiceData()} />;
}
