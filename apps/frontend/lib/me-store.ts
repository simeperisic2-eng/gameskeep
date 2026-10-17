'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { apiPost, fetchMe, resetCsrf, type MeUser } from './client';

/**
 * The signed-in visitor, shared by every header island (the sign-in pill and the
 * phone menu): ONE `/api/auth/me` request per page load, and a sign-in / sign-out
 * anywhere updates both. `undefined` = not known yet (before hydration).
 */
let me: MeUser | null | undefined;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}
function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Load the visitor (once); `force` re-reads it (after a sign-in). */
export function refreshMe(force = false): Promise<void> {
  if (inflight && !force) return inflight;
  inflight = fetchMe()
    .then((u) => {
      me = u;
    })
    .catch(() => {
      me = null;
    })
    .finally(emit);
  return inflight;
}

export async function signOutMe(): Promise<void> {
  await apiPost('/api/auth/logout');
  resetCsrf();
  me = null;
  emit();
}

export function useMe(): MeUser | null | undefined {
  const value = useSyncExternalStore(
    subscribe,
    () => me,
    () => undefined,
  );
  useEffect(() => {
    void refreshMe();
  }, []);
  return value;
}
