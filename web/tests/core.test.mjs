import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeTrades, coverageText, normalizeAggTrade, rebinWeekly } from '../core.js';

test('normalizeAggTrade preserves maker side semantics', () => {
  assert.deepEqual(normalizeAggTrade({ a: '1', T: '1000', p: '100.5', q: '2', m: true }), {
    id: 1, t: 1000, p: 100.5, q: 2, m: true,
  });
  assert.deepEqual(normalizeAggTrade({ a: '2', T: '1001', p: '100.6', q: '3', m: false }), {
    id: 2, t: 1001, p: 100.6, q: 3, m: false,
  });
});

test('existing price binning and delta logic are unchanged', () => {
  const a = analyzeTrades([
    { id: 1, t: 1000, p: 100.2, q: 2, m: false },
    { id: 2, t: 1100, p: 109.9, q: 1, m: true },
    { id: 3, t: 1200, p: 110.0, q: 4, m: false },
  ], 10, 1000);
  assert.equal(a.rows.length, 2);
  assert.deepEqual(a.rows[0], [100, { buy: 2, sell: 1 }]);
  assert.deepEqual(a.rows[1], [110, { buy: 4, sell: 0 }]);
  assert.equal(a.delta, 5);
  assert.equal(a.poc, 115);
});

test('weekly rebin keeps the existing floor-based behavior', () => {
  const rows = [[100, 1, 2], [109, 3, 4], [110, 5, 6]];
  assert.deepEqual(rebinWeekly(rows, 10), [
    [100, { buy: 4, sell: 6 }],
    [110, { buy: 5, sell: 6 }],
  ]);
});

test('coverage text reports actual captured interval and requested window', () => {
  const list = [{ t: 0 }, { t: 120000 }];
  const s = coverageText(list, 4 * 3600000, (ms) => `T${ms}`, (n) => String(n));
  assert.equal(s, 'Actual captured coverage: T0 to T120000 JST (2 min). Requested window: 4 h.');
  assert.equal(coverageText([], 4 * 3600000, String, String), 'No captured flow.');
});
