/**
 * Server-side client for the GamesKeep backend API.
 *
 * The frontend is API-first: pages fetch from the backend during SSR rather
 * than reaching into the database directly. In demo and production this URL is
 * the only thing that changes (service name in Docker, localhost on the host).
 */
const backendUrl = process.env.BACKEND_INTERNAL_URL ?? 'http://localhost:4000';

export interface DependencyResult {
  ok: boolean;
  error?: string;
  vectorExtension?: boolean;
}

export interface HeartbeatStatus {
  ok: boolean;
  count?: number;
  lastRunAt?: string;
  note?: string;
}

export interface ReadinessStatus {
  status: string;
  mode: string;
  dataSource?: { mode: string; live: boolean; description: string };
  dependencies: {
    postgres: DependencyResult;
    redis: DependencyResult;
    aiService: DependencyResult;
  };
  backgroundJobs: { heartbeat: HeartbeatStatus };
}

export interface BackendStatus {
  reachable: boolean;
  readiness?: ReadinessStatus;
  error?: string;
}

/** Fetch backend readiness for SSR. Never throws — returns a typed result. */
export async function getBackendStatus(): Promise<BackendStatus> {
  try {
    const res = await fetch(`${backendUrl}/health/ready`, { cache: 'no-store' });
    const readiness = (await res.json()) as ReadinessStatus;
    return { reachable: true, readiness };
  } catch (err) {
    return { reachable: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Pure helper (unit-tested): are all critical dependencies healthy? */
export function isAllHealthy(status: BackendStatus): boolean {
  if (!status.reachable || !status.readiness) return false;
  const d = status.readiness.dependencies;
  return d.postgres.ok && d.redis.ok && d.aiService.ok;
}
