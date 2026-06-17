const request = require('supertest');
const app = require('../app');
const { connect, disconnect, clearDB } = require('./setup');
const { createUser, authHeader } = require('./helpers');

beforeAll(connect);
afterAll(disconnect);
afterEach(clearDB);

// Previously: page<=0 produced a negative skip -> 500, and a non-numeric page produced
// a NaN skip -> unpaginated results. parsePagination() now clamps both.
const ENDPOINTS = ['/api/programs', '/api/budgets', '/api/expenses', '/api/documents', '/api/liquidations', '/api/users'];
const BAD = ['page=0', 'page=-5', 'page=abc', 'limit=-10', 'limit=abc'];

describe('Pagination param hardening', () => {
  for (const ep of ENDPOINTS) {
    for (const q of BAD) {
      it(`${ep}?${q} returns 200 with clamped meta`, async () => {
        const { token } = await createUser({ role: 'super_admin' });
        const res = await request(app).get(`${ep}?${q}`).set(authHeader(token));
        expect(res.status).toBe(200);
        expect(res.body.meta.page).toBeGreaterThanOrEqual(1);
        expect(res.body.meta.limit).toBeGreaterThanOrEqual(1);
        expect(res.body.meta.limit).toBeLessThanOrEqual(100);
      });
    }
  }

  it('clamps an over-max limit down to 100', async () => {
    const { token } = await createUser({ role: 'super_admin' });
    const res = await request(app).get('/api/programs?limit=99999').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.meta.limit).toBe(100);
  });
});
