import { inArray } from 'drizzle-orm';
import {
  BIAS_DISPLAY_SCOPES,
  INTEGRITY_LEXICON_DEFAULTS,
  type BiasDisplayScope,
} from '@gameskeep/shared/constants';
import { db } from '../db/client';
import { appSettings } from '../db/schema';
import { diffRows, writeAudit, type AuditActor } from '../admin/audit';

/**
 * Public display switches (Phase P S1). Each lives in `app_settings` under the
 * namespace the spec names it by, with an admin control and an audit entry:
 *
 *   bias.displayScope          ('bias' key)       spec `bias.display_scope`
 *   bias.showQuality           ('bias' key)       spec `bias.show_quality`
 *   community.topicBiasVotes   ('community' key)  spec `community.topic_bias_votes`
 *   briefing.windowHours       ('briefing' key)   the "today" window
 *   integrity.autoPublish      ('integrity' key)  auto-detected signals public?
 *   integrity.lexicon          ('integrity' key)  the scan keywords + negations
 *
 * The engines compute everywhere regardless; these only decide what is SHOWN.
 * Same clamp-with-defaults posture as every other settings module: a missing or
 * malformed value falls back to the default, and the defaults are the
 * conservative (hidden) state.
 */
export interface IntegrityLexicon {
  reviewCopy: string[];
  embargo: string[];
  sponsoredEvent: string[];
  negations: string[];
}

export interface DisplaySettings {
  displayScope: BiasDisplayScope;
  showQuality: boolean;
  topicBiasVotes: boolean;
  briefingWindowHours: number;
  integrityAutoPublish: boolean;
  integrityLexicon: IntegrityLexicon;
}

/** The subset every public payload carries (never the lexicon). */
export interface PublicDisplay {
  scope: BiasDisplayScope;
  showQuality: boolean;
  topicBiasVotes: boolean;
}

const KEYS = { bias: 'bias', briefing: 'briefing', integrity: 'integrity', community: 'community' };

function lexiconDefaults(): IntegrityLexicon {
  return {
    reviewCopy: [...INTEGRITY_LEXICON_DEFAULTS.reviewCopy],
    embargo: [...INTEGRITY_LEXICON_DEFAULTS.embargo],
    sponsoredEvent: [...INTEGRITY_LEXICON_DEFAULTS.sponsoredEvent],
    negations: [...INTEGRITY_LEXICON_DEFAULTS.negations],
  };
}

export const DISPLAY_DEFAULTS: DisplaySettings = {
  displayScope: 'reviews_and_sponsored',
  showQuality: false,
  topicBiasVotes: false,
  briefingWindowHours: 24,
  integrityAutoPublish: false,
  integrityLexicon: lexiconDefaults(),
};

type Raw = Record<string, unknown>;

function obj(v: unknown): Raw {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {};
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function phraseList(v: unknown, fallback: readonly string[]): string[] {
  if (!Array.isArray(v)) return [...fallback];
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== 'string') continue;
    const s = item.trim().toLowerCase().replace(/\s+/g, ' ');
    if (s.length >= 2 && s.length <= 80 && !out.includes(s)) out.push(s);
    if (out.length >= 60) break;
  }
  return out;
}

function coerce(rows: Map<string, Raw>): DisplaySettings {
  const bias = rows.get(KEYS.bias) ?? {};
  const briefing = rows.get(KEYS.briefing) ?? {};
  const integrity = rows.get(KEYS.integrity) ?? {};
  const community = rows.get(KEYS.community) ?? {};
  const lex = obj(integrity.lexicon);
  const hours = briefing.windowHours;
  return {
    displayScope: (BIAS_DISPLAY_SCOPES as readonly unknown[]).includes(bias.displayScope)
      ? (bias.displayScope as BiasDisplayScope)
      : DISPLAY_DEFAULTS.displayScope,
    showQuality: bool(bias.showQuality, DISPLAY_DEFAULTS.showQuality),
    topicBiasVotes: bool(community.topicBiasVotes, DISPLAY_DEFAULTS.topicBiasVotes),
    briefingWindowHours:
      typeof hours === 'number' && Number.isInteger(hours) && hours >= 1 && hours <= 168
        ? hours
        : DISPLAY_DEFAULTS.briefingWindowHours,
    integrityAutoPublish: bool(integrity.autoPublish, DISPLAY_DEFAULTS.integrityAutoPublish),
    integrityLexicon: {
      reviewCopy: phraseList(lex.reviewCopy, INTEGRITY_LEXICON_DEFAULTS.reviewCopy),
      embargo: phraseList(lex.embargo, INTEGRITY_LEXICON_DEFAULTS.embargo),
      sponsoredEvent: phraseList(lex.sponsoredEvent, INTEGRITY_LEXICON_DEFAULTS.sponsoredEvent),
      negations: phraseList(lex.negations, INTEGRITY_LEXICON_DEFAULTS.negations),
    },
  };
}

async function readRows(): Promise<Map<string, Raw>> {
  const rows = await db
    .select({ key: appSettings.key, value: appSettings.value })
    .from(appSettings)
    .where(inArray(appSettings.key, Object.values(KEYS)));
  return new Map(rows.map((r) => [r.key, obj(r.value)]));
}

export async function displaySettings(): Promise<DisplaySettings> {
  try {
    return coerce(await readRows());
  } catch {
    // A settings blip must never SHOW what the defaults hide.
    return { ...DISPLAY_DEFAULTS, integrityLexicon: lexiconDefaults() };
  }
}

export function publicDisplay(s: DisplaySettings): PublicDisplay {
  return { scope: s.displayScope, showQuality: s.showQuality, topicBiasVotes: s.topicBiasVotes };
}

export interface DisplaySettingsPatch {
  displayScope?: BiasDisplayScope;
  showQuality?: boolean;
  topicBiasVotes?: boolean;
  briefingWindowHours?: number;
  integrityAutoPublish?: boolean;
  integrityLexicon?: Partial<IntegrityLexicon>;
}

/**
 * Patch the switches (only provided fields change). Each app_settings key is
 * written separately and audited old→new; the `community` key keeps its existing
 * fields (rate limits, auto-hide) untouched.
 */
export async function setDisplaySettings(
  patch: DisplaySettingsPatch,
  actor: AuditActor,
): Promise<DisplaySettings> {
  const rows = await readRows();
  const current = coerce(rows);

  const writes: { key: string; value: Raw }[] = [];
  if (patch.displayScope !== undefined || patch.showQuality !== undefined) {
    writes.push({
      key: KEYS.bias,
      value: {
        ...(rows.get(KEYS.bias) ?? {}),
        displayScope: patch.displayScope ?? current.displayScope,
        showQuality: patch.showQuality ?? current.showQuality,
      },
    });
  }
  if (patch.topicBiasVotes !== undefined) {
    writes.push({
      key: KEYS.community,
      value: { ...(rows.get(KEYS.community) ?? {}), topicBiasVotes: patch.topicBiasVotes },
    });
  }
  if (patch.briefingWindowHours !== undefined) {
    writes.push({
      key: KEYS.briefing,
      value: { ...(rows.get(KEYS.briefing) ?? {}), windowHours: patch.briefingWindowHours },
    });
  }
  if (patch.integrityAutoPublish !== undefined || patch.integrityLexicon !== undefined) {
    const lex = patch.integrityLexicon ?? {};
    writes.push({
      key: KEYS.integrity,
      value: {
        ...(rows.get(KEYS.integrity) ?? {}),
        autoPublish: patch.integrityAutoPublish ?? current.integrityAutoPublish,
        lexicon: {
          reviewCopy: phraseList(lex.reviewCopy ?? current.integrityLexicon.reviewCopy, []),
          embargo: phraseList(lex.embargo ?? current.integrityLexicon.embargo, []),
          sponsoredEvent: phraseList(
            lex.sponsoredEvent ?? current.integrityLexicon.sponsoredEvent,
            [],
          ),
          negations: phraseList(lex.negations ?? current.integrityLexicon.negations, []),
        },
      },
    });
  }

  for (const w of writes) {
    const before = rows.get(w.key) ?? {};
    const changes = diffRows(before, w.value);
    if (Object.keys(changes).length === 0) continue;
    await db
      .insert(appSettings)
      .values({ key: w.key, value: w.value })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: w.value, updatedAt: new Date() },
      });
    await writeAudit({
      action: 'update',
      entityType: 'app-settings',
      entityId: w.key,
      changes,
      summary: `updated display settings (${w.key}: ${Object.keys(changes).join(', ')})`,
      actor,
    });
  }
  return displaySettings();
}
