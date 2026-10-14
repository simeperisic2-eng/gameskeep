'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { fallbackSite, toClientSite, type ClientSite } from '@/lib/site-core';
import { setSiteLabels } from '@/lib/labels';

/**
 * The copy registry for CLIENT components (Phase P S3b): the brand, contact
 * details, labels, empty states, consent wording and layout knobs — never the
 * documents (those render on the server). The (site) layout provides it from
 * the same per-request read the server components use.
 */
const SiteContext = createContext<ClientSite | null>(null);

let fallback: ClientSite | null = null;

export function SiteProvider({
  value,
  children,
}: {
  value: ClientSite;
  children: ReactNode;
}): React.JSX.Element {
  // Global site labels (the same for every reader) — set before children render
  // so the small pure label helpers read the current values.
  setSiteLabels(value.text, value.display.excerpt, { merge: true });
  return <SiteContext.Provider value={value}>{children}</SiteContext.Provider>;
}

export function useSite(): ClientSite & { t: (key: string) => string } {
  const ctx = useContext(SiteContext) ?? (fallback ??= toClientSite(fallbackSite()));
  return { ...ctx, t: (key: string) => ctx.text[key] ?? '' };
}
