import type {
  GameDlcEntry,
  GamePriceEntry,
  GameSysReqEntry,
  GameVideoEntry,
} from '@/lib/public-api';
import { CoverArt } from './CoverArt';

/**
 * Videos / where-to-buy / system requirements / DLC (BLUEPRINT 2.3; enriched A2).
 * Each block renders ONLY where the data exists (the "never an empty/unknown
 * field" rule — never an empty buy box). Everything here is LINK OUT, never
 * embedded content: video thumbnails link to YouTube (no iframes — embedded
 * players are heavy for Core Web Vitals and set tracking cookies pre-consent);
 * store rows link to Steam/Epic/GOG (attribution + utility, never scraped).
 */
function formatPrice(cents: number, currency: string): string {
  const sym = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '';
  const amount = (cents / 100).toFixed(2).replace(/\.00$/, '');
  return sym ? `${sym}${amount}` : `${amount} ${currency}`;
}

/** A2: thumbnail cards that LINK OUT to YouTube — deliberately NOT embeds. */
function Videos({
  videos,
  gameName,
}: {
  videos: GameVideoEntry[];
  gameName: string;
}): React.JSX.Element {
  return (
    <div className="gk-media-block gk-media-videos">
      <h3 className="gk-media-title">Videos</h3>
      <div className="gk-vidgrid">
        {videos.map((v, i) => (
          <a
            key={i}
            className="gk-vidcard"
            href={v.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
          >
            <span className="gk-vidcard-thumb">
              {v.thumbnailUrl ? (
                // External provider thumbnail — a plain lazy <img> keeps it out
                // of the Next optimizer (we never proxy/ingest their asset).
                <img src={v.thumbnailUrl} alt="" loading="lazy" />
              ) : (
                <CoverArt label={v.channel ?? gameName} variant="thumb" />
              )}
              <span className="gk-vidcard-play" aria-hidden>
                ▶
              </span>
              <span className="gk-vidcard-kind">{v.isLive ? 'LIVE' : v.kind.toUpperCase()}</span>
            </span>
            <span className="gk-vidcard-title">{v.title ?? v.url}</span>
            {v.channel ? <span className="gk-vidcard-channel">{v.channel}</span> : null}
          </a>
        ))}
      </div>
      <p className="gk-media-note">
        Top YouTube results, curated by our editors — opens on YouTube (no autoplay, no embedded
        trackers).
      </p>
    </div>
  );
}

/** A2 "Where to buy": outbound store links + price + amber discount badge. */
function WhereToBuy({ prices }: { prices: GamePriceEntry[] }): React.JSX.Element {
  return (
    <div className="gk-media-block">
      <h3 className="gk-media-title">Where to buy</h3>
      <ul className="gk-media-list">
        {prices.map((p, i) => {
          const label = (
            <>
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
            </>
          );
          return (
            <li key={i}>
              {p.url ? (
                <a
                  className="gk-buy-link"
                  href={p.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                >
                  {label}
                  <span className="gk-out-arrow" aria-hidden>
                    ↗
                  </span>
                </a>
              ) : (
                label
              )}
            </li>
          );
        })}
      </ul>
      <p className="gk-media-note">Official store pages — prices are the stores&apos;, not ours.</p>
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
            {d.url ? (
              <a
                className="gk-buy-link"
                href={d.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
              >
                <span className="gk-media-label">{d.name}</span>
                {d.priceCents != null ? (
                  <span className="gk-price">{formatPrice(d.priceCents, d.currency)}</span>
                ) : null}
                <span className="gk-out-arrow" aria-hidden>
                  ↗
                </span>
              </a>
            ) : (
              <>
                <span className="gk-media-label">{d.name}</span>
                {d.priceCents != null ? (
                  <span className="gk-price">{formatPrice(d.priceCents, d.currency)}</span>
                ) : null}
              </>
            )}
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
  gameName,
}: {
  videos: GameVideoEntry[];
  prices: GamePriceEntry[];
  sysReqs: GameSysReqEntry[];
  dlc: GameDlcEntry[];
  gameName: string;
}): React.JSX.Element | null {
  if (videos.length === 0 && prices.length === 0 && sysReqs.length === 0 && dlc.length === 0) {
    return null;
  }
  return (
    <section className="gk-panel gk-media" aria-label="Videos, prices and requirements">
      <div className="gk-panel-head">
        <h2 className="gk-panel-title">Videos, prices &amp; requirements</h2>
      </div>
      {videos.length > 0 ? <Videos videos={videos} gameName={gameName} /> : null}
      <div className="gk-media-grid">
        {prices.length > 0 ? <WhereToBuy prices={prices} /> : null}
        {sysReqs.length > 0 ? <SysReqs sysReqs={sysReqs} /> : null}
        {dlc.length > 0 ? <Dlc dlc={dlc} /> : null}
      </div>
    </section>
  );
}
