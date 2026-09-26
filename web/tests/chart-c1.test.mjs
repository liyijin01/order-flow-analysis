import test from 'node:test';
import assert from 'node:assert/strict';

await import('../chart/data.js');
const D = globalThis.OrderFlowChartData;

test('kline parser preserves UTC epoch seconds and OHLCV', () => {
  const row = [1700000000000,'10','12','9','11','5',1700003599999,'55','8','3','0','0'];
  const out = D.parseKlines([row])[0];
  assert.equal(out.time, 1700000000);
  assert.equal(out.open, 10);
  assert.equal(out.high, 12);
  assert.equal(out.low, 9);
  assert.equal(out.close, 11);
  assert.equal(out.volume, 5);
  assert.equal(out.closeTime, 1700003599999);
});

test('display code distinguishes perpetual and spot without altering symbol', () => {
  assert.equal(D.displayCode('BTCUSDT','um'), 'BTCUSDT.P');
  assert.equal(D.displayCode('BTCUSDT','spot'), 'BTCUSDT');
});

test('countdown formatter supports mm:ss and hh:mm:ss', () => {
  assert.equal(D.remainingText(125000, 0), '02:05');
  assert.equal(D.remainingText(3661000, 0), '01:01:01');
  assert.equal(D.remainingText(1000, 2000), '00:00');
});

test('browser-local formatter does not mutate the UTC timestamp', () => {
  const epoch = 1700000000;
  const before = epoch;
  const formatted = D.formatLocalDateTime(epoch, false);
  assert.equal(epoch, before);
  assert.ok(formatted.length > 0);
});
