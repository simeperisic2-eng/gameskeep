import { env } from '../config/env';

/**
 * The swappable data-source seam (CLAUDE.md: "data-source layer must be
 * swappable to live with minimal change").
 *
 * In DEMO mode every external data source — articles, game metadata, player
 * counts — is served from local mock fixtures and NO live network calls are
 * made. In PRODUCTION these are replaced by live adapters (RSS feeds,
 * IGDB/RAWG, Steam) WITHOUT changing the engines (clustering, scoring, bias)
 * that consume them.
 *
 * I0 only establishes the seam and the mode flag. Concrete adapters and
 * fixtures arrive in I2 (games) and I3 (articles).
 */
export type DataSourceMode = 'demo' | 'production';

export function getDataSourceMode(): DataSourceMode {
  return env.APP_MODE;
}

export interface DataSourceStatus {
  mode: DataSourceMode;
  live: boolean;
  description: string;
}

export function describeDataSource(): DataSourceStatus {
  const mode = getDataSourceMode();
  return {
    mode,
    live: mode === 'production',
    description:
      mode === 'demo'
        ? 'Mock data sources — no live external calls (demo).'
        : 'Live data adapters (production).',
  };
}
