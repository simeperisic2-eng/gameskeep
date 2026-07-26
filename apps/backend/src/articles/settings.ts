import { eq } from 'drizzle-orm';
import {
  CLUSTERING_DEFAULTS,
  CLUSTER_GATE_DEFAULTS,
  EVENT_KIND_LEXICON_DEFAULTS,
} from '@gameskeep/shared/constants';
import { db } from '../db/client';
import { appSettings } from '../db/schema';
import { writeAudit, type AuditActor } from '../admin/audit';

/**
 * Clustering settings store (SPEC I3 §3/§4 + I4a §7: "everything configurable
 * from admin; no hardcoded thresholds"). Persisted in the generic `app_settings`
 * table under the `clustering` key, with shared defaults as the fallback so the
 * engine works before anything is saved. Every change is audit-logged.
 *
 * I4a adds two tunable groups here: the secondary `gate` parameters and the
 * `eventKindLexicon` (owner directive: the lexicon is admin-editable, not a code
 * change, because it directly affects merge decisions).
 */
export const CLUSTERING_SETTINGS_KEY = 'clustering';

export interface ClusterGateSettings {
  enabled: boolean;
  minEventGapDays: number;
  requireDifferentEventKind: boolean;
}

export interface ClusterSettings {
  similarityThreshold: number;
  timeWindowDays: number;
  gate: ClusterGateSettings;
  eventKindLexicon: Record<string, string[]>;
}

export type ClusterSettingsPatch = {
  similarityThreshold?: number;
  timeWindowDays?: number;
  gate?: Partial<ClusterGateSettings>;
  eventKindLexicon?: Record<string, string[]>;
};

function coerceGate(raw: unknown): ClusterGateSettings {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const gap = obj.minEventGapDays;
  return {
    enabled: typeof obj.enabled === 'boolean' ? obj.enabled : CLUSTER_GATE_DEFAULTS.enabled,
    minEventGapDays:
      typeof gap === 'number' && Number.isFinite(gap) && gap >= 0 && gap <= 365
        ? gap
        : CLUSTER_GATE_DEFAULTS.minEventGapDays,
    requireDifferentEventKind:
      typeof obj.requireDifferentEventKind === 'boolean'
        ? obj.requireDifferentEventKind
        : CLUSTER_GATE_DEFAULTS.requireDifferentEventKind,
  };
}

/** Keep only well-formed `{ kind: string[] }` entries; fall back to the defaults. */
function coerceLexicon(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== 'object') return { ...EVENT_KIND_LEXICON_DEFAULTS };
  const out: Record<string, string[]> = { ...EVENT_KIND_LEXICON_DEFAULTS };
  for (const [kind, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    const words = value
      .filter((w): w is string => typeof w === 'string')
      .map((w) => w.trim().toLowerCase())
      .filter((w) => w.length > 0)
      .slice(0, 200);
    out[kind] = words;
  }
  return out;
}

function coerce(raw: unknown): ClusterSettings {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const threshold = obj.similarityThreshold;
  const window = obj.timeWindowDays;
  return {
    similarityThreshold:
      typeof threshold === 'number' && threshold >= 0 && threshold <= 1
        ? threshold
        : CLUSTERING_DEFAULTS.similarityThreshold,
    timeWindowDays:
      typeof window === 'number' && Number.isInteger(window) && window >= 1 && window <= 365
        ? window
        : CLUSTERING_DEFAULTS.timeWindowDays,
    gate: coerceGate(obj.gate),
    eventKindLexicon: coerceLexicon(obj.eventKindLexicon),
  };
}

export async function getClusterSettings(): Promise<ClusterSettings> {
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, CLUSTERING_SETTINGS_KEY))
    .limit(1);
  return coerce(row?.value);
}

/** Patch the settings (only provided fields change) and audit the old→new diff. */
export async function setClusterSettings(
  patch: ClusterSettingsPatch,
  actor: AuditActor,
): Promise<ClusterSettings> {
  const current = await getClusterSettings();
  // Merge the event-kind lexicon key-by-key so an admin can retune one kind's
  // keywords without resending the whole lexicon.
  const lexicon = patch.eventKindLexicon
    ? coerceLexicon({ ...current.eventKindLexicon, ...patch.eventKindLexicon })
    : current.eventKindLexicon;
  const next: ClusterSettings = {
    similarityThreshold: patch.similarityThreshold ?? current.similarityThreshold,
    timeWindowDays: patch.timeWindowDays ?? current.timeWindowDays,
    gate: coerceGate({ ...current.gate, ...(patch.gate ?? {}) }),
    eventKindLexicon: lexicon,
  };
  const value = next as unknown as Record<string, unknown>;
  await db
    .insert(appSettings)
    .values({ key: CLUSTERING_SETTINGS_KEY, value })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedAt: new Date() },
    });
  await writeAudit({
    action: 'update',
    entityType: 'app-settings',
    entityId: CLUSTERING_SETTINGS_KEY,
    changes: {
      similarityThreshold: { from: current.similarityThreshold, to: next.similarityThreshold },
      timeWindowDays: { from: current.timeWindowDays, to: next.timeWindowDays },
      gate: { from: current.gate, to: next.gate },
      eventKindLexicon: patch.eventKindLexicon
        ? { updated: Object.keys(patch.eventKindLexicon) }
        : undefined,
    },
    summary: `updated clustering settings (threshold ${next.similarityThreshold}, window ${next.timeWindowDays}d, gate ${next.gate.enabled ? 'on' : 'off'}/${next.gate.minEventGapDays}d)`,
    actor,
  });
  return next;
}
