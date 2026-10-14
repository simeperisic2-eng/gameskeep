import { cache } from 'react';
import { coerceSite, fallbackSite, type PublicSite } from './site-core';
import { setSiteLabels } from './labels';

export * from './site-core';

const backendUrl = process.env.BACKEND_INTERNAL_URL ?? 'http://localhost:4000';

/**
 * The site copy for THIS request (server only; React-cached so the layout,
 * metadata and page share one fetch). Falls back to the registry defaults.
 */
export const getSite = cache(async (): Promise<PublicSite> => {
  let site: PublicSite | null = null;
  try {
    const res = await fetch(`${backendUrl}/public/site`, { cache: 'no-store' });
    if (res.ok) site = coerceSite(((await res.json()) as { data?: unknown }).data);
  } catch {
    site = null;
  }
  const out = site ?? fallbackSite();
  setSiteLabels(out.text, out.display.excerpt);
  return out;
});
