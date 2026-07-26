import { describe, it, expect } from 'vitest';
import { isAllHealthy, type BackendStatus } from '../lib/api';

function statusWith(overrides: Partial<BackendStatus['readiness']> = {}): BackendStatus {
  return {
    reachable: true,
    readiness: {
      status: 'ready',
      mode: 'demo',
      dependencies: {
        postgres: { ok: true, vectorExtension: true },
        redis: { ok: true },
        aiService: { ok: true },
      },
      backgroundJobs: { heartbeat: { ok: true, count: 1 } },
      ...overrides,
    },
  };
}

describe('isAllHealthy', () => {
  it('is false when the backend is unreachable', () => {
    expect(isAllHealthy({ reachable: false, error: 'ECONNREFUSED' })).toBe(false);
  });

  it('is true when every dependency reports ok', () => {
    expect(isAllHealthy(statusWith())).toBe(true);
  });

  it('is false when any dependency is down', () => {
    expect(
      isAllHealthy(
        statusWith({
          dependencies: {
            postgres: { ok: false, error: 'connection refused' },
            redis: { ok: true },
            aiService: { ok: true },
          },
        }),
      ),
    ).toBe(false);
  });
});
