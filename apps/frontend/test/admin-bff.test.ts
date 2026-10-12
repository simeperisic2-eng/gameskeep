import { describe, it, expect } from 'vitest';
import * as adminRelay from '../app/admin/api/[...path]/route';

// Phase P S2 follow-up: the Control Panel relay must forward every method the
// admin API uses — a missing export is a silent 405 in the browser ("Save order"
// sent PUT and failed while the backend itself was fine).
describe('admin BFF relay', () => {
  it('exports GET, POST, PATCH, PUT and DELETE', () => {
    for (const m of ['GET', 'POST', 'PATCH', 'PUT', 'DELETE']) {
      expect(typeof (adminRelay as Record<string, unknown>)[m]).toBe('function');
    }
  });
});
