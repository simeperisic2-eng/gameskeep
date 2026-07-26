import type {
  GameDlcEntry,
  GamePriceEntry,
  GameSysReqEntry,
  GameVideoEntry,
} from '@/lib/public-api';

/**
 * Videos / prices / system requirements / DLC (BLUEPRINT 2.3). Each block renders
 * ONLY where the data exists (the "never an empty/unknown field" rule) — in the
 * offline demo most of these are empty, so the whole section is omitted; the slots
 * are wired so production (YouTube / Steam pulls) fills them with no layout change.
 */
function formatPrice(cents: number, currency: string): string {
  const sym = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '';
  const amount = (cents / 100).toFixed(2).replace(/\.00$/, '');
  return sym ? `${sym}${amount}` : `${amount} ${currency}`;
}

function Videos({ videos }: { videos: GameVideoEntry[] }): React.JSX.Element {
  return (
    <div className="gk-media-block">
      <h3 className="gk-media-title">Videos</h3>
      <ul className="gk-media-list">
        {videos.map((v, i) => (
          <li key={i}>
            <a href={v.url} target="_blank" rel="noopener noreferrer nofollow">
              <span className="gk-media-kind">{v.isLive ? 'LIVE' : v.kind}</span>
              <span className="gk-media-label">{v.title ?? v.url}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Prices({ prices }: { prices: GamePriceEntry[] }): React.JSX.Element {
  return (
    <div className="gk-media-block">
      <h3 className="gk-media-title">Prices</h3>
      <ul className="gk-media-list">
        {prices.map((p, i) => (
          <li key={i}>
            <span className="gk-media-label">
              {p.store}
              {p.platform ? ` · ${p.platform}` : ''}
            </span>
            <span className="gk-price">
              {p.isOnSale && p.discountPct > 0 ? (
                <span className="gk-price-disc">−{p.discountPct}%</span>
              ) : null}
              {formatPrice(p.priceCents, p.currency)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SysReqs({ sysReqs }: { sysReqs: GameSysReqEntry[] }): React.JSX.Element {
  return (
    <div className="gk-media-block">
      <h3 className="gk-media-title">System requirements</h3>
      <div className="gk-sysreqs">
        {sysReqs.map((s, i) => (
          <div key={i} className="gk-sysreq">
            <span className="gk-sysreq-kind">
              {s.kind} · {s.platform}
            </span>
            <dl>
              {s.os ? (
                <>
                  <dt>OS</dt>
                  <dd>{s.os}</dd>
                </>
              ) : null}
              {s.cpu ? (
                <>
                  <dt>CPU</dt>
                  <dd>{s.cpu}</dd>
                </>
              ) : null}
              {s.gpu ? (
                <>
                  <dt>GPU</dt>
                  <dd>{s.gpu}</dd>
                </>
              ) : null}
              {s.ramGb ? (
                <>
                  <dt>RAM</dt>
                  <dd>{s.ramGb} GB</dd>
                </>
              ) : null}
              {s.storageGb ? (
                <>
                  <dt>Storage</dt>
                  <dd>{s.storageGb} GB</dd>
                </>
              ) : null}
            </dl>
          </div>
        ))}
      </div>
    </div>
  );
}

function Dlc({ dlc }: { dlc: GameDlcEntry[] }): React.JSX.Element {
  return (
    <div className="gk-media-block">
      <h3 className="gk-media-title">DLC</h3>
      <ul className="gk-media-list">
        {dlc.map((d, i) => (
          <li key={i}>
            <span className="gk-media-label">{d.name}</span>
            {d.priceCents != null ? (
              <span className="gk-price">{formatPrice(d.priceCents, d.currency)}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function GameMedia({
  videos,
  prices,
  sysReqs,
  dlc,
}: {
  videos: GameVideoEntry[];
  prices: GamePriceEntry[];
  sysReqs: GameSysReqEntry[];
  dlc: GameDlcEntry[];
}): React.JSX.Element | null {
  if (videos.length === 0 && prices.length === 0 && sysReqs.length === 0 && dlc.length === 0) {
    return null;
  }
  return (
    <section className="gk-panel gk-media" aria-label="Videos, prices and requirements">
      <div className="gk-panel-head">
        <h2 className="gk-panel-title">Videos, prices &amp; requirements</h2>
      </div>
      <div className="gk-media-grid">
        {videos.length > 0 ? <Videos videos={videos} /> : null}
        {prices.length > 0 ? <Prices prices={prices} /> : null}
        {sysReqs.length > 0 ? <SysReqs sysReqs={sysReqs} /> : null}
        {dlc.length > 0 ? <Dlc dlc={dlc} /> : null}
      </div>
    </section>
  );
}
