export function normalizeAggTrade(x) {
  const id = Number(x.a);
  const t = Number(x.T);
  const p = Number(x.p);
  const q = Number(x.q);
  const m = Boolean(x.m);
  if (!Number.isSafeInteger(id) || !Number.isFinite(t) || !Number.isFinite(p) || !Number.isFinite(q) || q <= 0) return null;
  return { id, t, p, q, m };
}

export function selectTrades(trades, windowMs) {
  if (!trades.length) return [];
  const end = trades[trades.length - 1].t;
  const start = end - Number(windowMs);
  return trades.filter((x) => x.t >= start);
}

export function analyzeTrades(list, row, interval) {
  const bins = new Map();
  const cols = new Map();
  const cv = [];
  let sum = 0;

  for (const t of list) {
    const k = Math.floor(t.p / row) * row;
    const b = bins.get(k) || { buy: 0, sell: 0 };
    if (t.m) b.sell += t.q;
    else b.buy += t.q;
    bins.set(k, b);

    const c = Math.floor(t.t / interval) * interval;
    const cm = cols.get(c) || new Map();
    const cb = cm.get(k) || { buy: 0, sell: 0 };
    if (t.m) cb.sell += t.q;
    else cb.buy += t.q;
    cm.set(k, cb);
    cols.set(c, cm);

    sum += t.m ? -t.q : t.q;
    cv.push([t.t, sum]);
  }

  const rows = [...bins.entries()].sort((a, b) => a[0] - b[0]);
  let poc = null;
  let mx = -1;
  for (const r of rows) {
    const v = r[1].buy + r[1].sell;
    if (v > mx) {
      mx = v;
      poc = r[0] + row / 2;
    }
  }
  return { rows, cols, cv, poc, delta: sum };
}

export function rebinWeekly(rows, size) {
  const m = new Map();
  rows.forEach((r) => {
    const k = Math.floor(Number(r[0]) / size) * size;
    const b = m.get(k) || { buy: 0, sell: 0 };
    b.buy += Number(r[1]);
    b.sell += Number(r[2]);
    m.set(k, b);
  });
  return [...m.entries()].sort((a, b) => a[0] - b[0]);
}

export function coverageText(list, requestedWindowMs, formatTime, formatNumber) {
  if (!list.length) return 'No captured flow.';
  const first = list[0];
  const last = list[list.length - 1];
  return 'Actual captured coverage: ' + formatTime(first.t) + ' to ' + formatTime(last.t) +
    ' JST (' + formatNumber((last.t - first.t) / 60000, 2) + ' min). Requested window: ' +
    formatNumber(Number(requestedWindowMs) / 3600000, 2) + ' h.';
}
