import { describe, it, expect } from 'vitest';
import { buildServer } from '../src/server';

// These tests are hermetic: liveness and the root route touch no external
// dependencies, so they prove the server harness works without Postgres/Redis.
// buildServer() is an I/O-heavy cold-start (plugin registration) that can exceed
// vitest's default 5s under parallel suite load on slower machines — the bumped
// timeout is for construction, not the assertions.
describe('backend foundation', () => {
  it('GET /health returns liveness ok', { timeout: 20_000 }, async () => {
    const app = await buildServer();
    try {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('ok');
      expect(body.service).toBe('backend');
      expect(body.mode).toBe('demo');
    } finally {
      await app.close();
    }
  });

  it('GET / returns the foundation-OK message', { timeout: 20_000 }, async () => {
    const app = await buildServer();
    try {
      const res = await app.inject({ method: 'GET', url: '/' });
      expect(res.statusCode).toBe(200);
      expect(res.json().message).toContain('foundation OK');
    } finally {
      await app.close();
    }
  });
});
