import type { PublicContentFlags } from '@/lib/public-api';

/**
 * Content Flags (BLUEPRINT 2.3) — factual, player-decision signals (AI-asset
 * disclosure, launch state, monetization, complexity). Informational, never a
 * judgment. Hard rule: a field renders ONLY where we have the data — an 'unknown'
 * value is nulled by the backend and never shown as empty clutter. If nothing is
 * known, the whole section is omitted (the caller checks too). Amber marks
 * "worth knowing"; red is never used here (reserved for the disconnect).
 */
const AI_LABEL: Record<string, string> = {
  no: 'None disclosed',
  partial: 'Partial',
  yes: 'Yes',
};
const LAUNCH_LABEL: Record<string, string> = {
  polished: 'Polished',
  mixed: 'Mixed',
  rough: 'Rough at launch',
};
const MONETIZATION: { key: keyof PublicContentFlags['monetization']; label: string }[] = [
  { key: 'microtransactions', label: 'Microtransactions' },
  { key: 'battlePass', label: 'Battle pass' },
  { key: 'lootBoxesOrGacha', label: 'Loot boxes / gacha' },
  { key: 'payToWinPredatory', label: 'Predatory monetization' },
];

/** True when a content-flags row carries at least one renderable value. */
export function hasContentFlagData(f: PublicContentFlags): boolean {
  return (
    f.aiAssets != null ||
    f.launchState != null ||
    f.hasMonetization ||
    f.complexity != null ||
    Boolean(f.notes)
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="gk-flagrow">
      <span className="gk-flagrow-label">{label}</span>
      <span className="gk-flagrow-value">{children}</span>
    </div>
  );
}

function Complexity({ level }: { level: number }): React.JSX.Element {
  return (
    <span className="gk-complexity" aria-label={`Complexity ${level} of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={`gk-complexity-dot${n <= level ? ' on' : ''}`} aria-hidden />
      ))}
      <span className="gk-complexity-cap">
        {level <= 2 ? 'Easy to pick up' : level >= 4 ? 'Deep / hardcore' : 'Moderate'}
      </span>
    </span>
  );
}

export function ContentFlags({ flags }: { flags: PublicContentFlags }): React.JSX.Element | null {
  if (!hasContentFlagData(flags)) return null;
  const aiTone = flags.aiAssets === 'no' ? 'good' : 'warn';
  const launchTone =
    flags.launchState === 'polished' ? 'good' : flags.launchState === 'rough' ? 'warn' : 'mixed';
  return (
    <section className="gk-panel" aria-label="Content flags">
      <div className="gk-panel-head">
        <h2 className="gk-panel-title">Content flags</h2>
        <span className="gk-section-sub" style={{ margin: 0 }}>
          Factual signals, where known
        </span>
      </div>
      <div className="gk-flagrows">
        {flags.aiAssets != null ? (
          <Row label="AI-generated assets">
            <span className={`gk-flagtag ${aiTone}`}>
              {AI_LABEL[flags.aiAssets] ?? flags.aiAssets}
            </span>
          </Row>
        ) : null}
        {flags.launchState != null ? (
          <Row label="Launch state">
            <span className={`gk-flagtag ${launchTone}`}>
              {LAUNCH_LABEL[flags.launchState] ?? flags.launchState}
            </span>
          </Row>
        ) : null}
        {flags.hasMonetization ? (
          <Row label="Monetization">
            <span className="gk-flagtags">
              {MONETIZATION.filter((m) => flags.monetization[m.key]).map((m) => (
                <span
                  key={m.key}
                  className={`gk-flagtag ${m.key === 'payToWinPredatory' ? 'warn' : 'neutral'}`}
                >
                  {m.label}
                </span>
              ))}
            </span>
          </Row>
        ) : null}
        {flags.complexity != null ? (
          <Row label="Complexity">
            <Complexity level={flags.complexity} />
          </Row>
        ) : null}
        {flags.notes ? <p className="gk-flag-notes">{flags.notes}</p> : null}
      </div>
    </section>
  );
}
