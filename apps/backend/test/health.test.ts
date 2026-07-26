import { describe, it, expect } from 'vitest';
import { buildServer } from '../src/server';

// These tests are hermetic: liveness and the root route touch no external
// dependencies, so they prove the server harness works without Postgres/Redis.
describe('backend foundation', () => {
  it('GET /health returns liveness ok', async () => {
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

  it('GET / returns the foundation-OK message', async () => {
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
