(function (global) {
  'use strict';

  function normalizeAggTrade(x) {
    const id = Number(x.a);
    const t = Number(x.T);
    const p = Number(x.p);
    const q = Number(x.q);
    const m = Boolean(x.m);
    if (!Number.isSafeInteger(id) || !Number.isFinite(t) || !Number.isFinite(p) || !Number.isFinite(q) || q <= 0) return null;
    return { id, t, p, q, m };
  }

  function minMax(values) {
    if (!values || values.length === 0) return { min: null, max: null };
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < values.length; i += 1) {
      const v = values[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return { min, max };
  }

  function maxValue(values) {
    let max = -Infinity;
    for (let i = 0; i < values.length; i += 1) if (values[i] > max) max = values[i];
    return max;
  }

  function selectTrades(trades, windowMs) {
    if (!trades.length) return [];
    const end = trades[trades.length - 1].t;
    const start = end - Number(windowMs);
    let lo = 0;
    while (lo < trades.length && trades[lo].t < start) lo += 1;
    return trades.slice(lo);
  }

  function analyzeTrades(list, row, interval) {
    const bins = new Map();
    const cols = new Map();
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
    return { rows, cols, poc, delta: sum };
  }

  function detectGaps(events) {
    const gaps = [];
    for (let i = 1; i < events.length; i += 1) {
      const prev = events[i - 1];
      const cur = events[i];
      if (cur.id > prev.id + 1) {
        gaps.push({ fromId: prev.id + 1, toId: cur.id - 1, afterT: prev.t, beforeT: cur.t });
      }
    }
    return gaps;
  }

  function mergeUniqueById() {
    const all = [];
    for (let a = 0; a < arguments.length; a += 1) {
      const arr = arguments[a] || [];
      for (let i = 0; i < arr.length; i += 1) all.push(arr[i]);
    }
    all.sort((x, y) => x.id - y.id || x.t - y.t);
    const out = [];
    let last = null;
    for (let i = 0; i < all.length; i += 1) {
      const item = all[i];
      if (last !== item.id) {
        out.push(item);
        last = item.id;
      }
    }
    return out;
  }

  function bucketCvd(events, bucketMs, maxPoints) {
    if (!events.length) return [];
    const hardMax = Math.max(1, Number(maxPoints) || 5000);
    const naturalBuckets = [];
    let cumulative = 0;
    let current = null;
    let prevId = null;
    for (let i = 0; i < events.length; i += 1) {
      const e = events[i];
      const delta = e.m ? -e.q : e.q;
      const gapBefore = prevId !== null && e.id > prevId + 1;
      const key = Math.floor(e.t / bucketMs) * bucketMs;
      if (!current || current.t !== key) {
        if (current) naturalBuckets.push(current);
        current = { t: key, open: cumulative, high: cumulative, low: cumulative, close: cumulative, brokenBefore: gapBefore };
      } else if (gapBefore) {
        current.brokenBefore = true;
      }
      cumulative += delta;
      if (cumulative > current.high) current.high = cumulative;
      if (cumulative < current.low) current.low = cumulative;
      current.close = cumulative;
      prevId = e.id;
    }
    if (current) naturalBuckets.push(current);
    if (naturalBuckets.length <= hardMax) return naturalBuckets;

    const stride = Math.ceil(naturalBuckets.length / hardMax);
    const compact = [];
    for (let i = 0; i < naturalBuckets.length; i += stride) {
      const group = naturalBuckets.slice(i, i + stride);
      let high = group[0].high;
      let low = group[0].low;
      let brokenBefore = group[0].brokenBefore;
      for (let j = 1; j < group.length; j += 1) {
        if (group[j].high > high) high = group[j].high;
        if (group[j].low < low) low = group[j].low;
        if (group[j].brokenBefore) brokenBefore = true;
      }
      compact.push({
        t: group[0].t,
        open: group[0].open,
        high,
        low,
        close: group[group.length - 1].close,
        brokenBefore,
      });
    }
    return compact;
  }

  function clipFootprintPrices(prices, latestPrice, limit) {
    const sorted = [...new Set(prices)].sort((a, b) => b - a);
    const n = Number(limit) || 80;
    if (sorted.length <= n) return sorted;
    let nearest = 0;
    let best = Infinity;
    for (let i = 0; i < sorted.length; i += 1) {
      const d = Math.abs(sorted[i] - latestPrice);
      if (d < best) { best = d; nearest = i; }
    }
    let start = nearest - Math.floor(n / 2);
    if (start < 0) start = 0;
    if (start + n > sorted.length) start = sorted.length - n;
    return sorted.slice(start, start + n);
  }

  function decimalParts(value) {
    let s = String(value).trim();
    if (!/^[-+]?\d+(\.\d+)?$/.test(s)) throw new Error('invalid decimal: ' + value);
    let sign = 1n;
    if (s[0] === '-') { sign = -1n; s = s.slice(1); }
    else if (s[0] === '+') s = s.slice(1);
    const parts = s.split('.');
    const frac = parts[1] || '';
    const scale = 10n ** BigInt(frac.length);
    const n = sign * BigInt((parts[0] || '0') + frac);
    return { n, scale };
  }

  function rebinIndex(binIndex, binSize, rowSize) {
    const b = decimalParts(binSize);
    const r = decimalParts(rowSize);
    const numerator = BigInt(binIndex) * b.n * r.scale;
    const denominator = b.scale * r.n;
    if (denominator <= 0n) throw new Error('rowSize must be positive');
    return Number(numerator / denominator);
  }

  function binPrice(binIndex, binSize, offset) {
    const i = Number(binIndex) + Number(offset || 0);
    return i * Number(binSize);
  }

  function rebinLadderRows(rows, binSize, rowSize) {
    const m = new Map();
    rows.forEach((r) => {
      const idx = rebinIndex(r[0], binSize, rowSize);
      const b = m.get(idx) || { buy: 0, sell: 0 };
      b.buy += Number(r[1]);
      b.sell += Number(r[2]);
      m.set(idx, b);
    });
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }

  function coverageText(list, requestedWindowMs, formatTime, formatNumber, options) {
    const opts = options || {};
    if (!list.length) return 'No captured flow.';
    const first = list[0];
    const last = list[list.length - 1];
    let s = 'Actual captured coverage: ' + formatTime(first.t) + ' to ' + formatTime(last.t) +
      ' JST (' + formatNumber((last.t - first.t) / 60000, 2) + ' min). Requested window: ' +
      formatNumber(Number(requestedWindowMs) / 3600000, 2) + ' h.';
    if (opts.truncated) s += ' Memory limit reached: older captured trades were truncated.';
    const gaps = opts.gaps || [];
    if (gaps.length) {
      s += ' Unresolved aggTrade gaps: ' + gaps.map((g) => g.fromId + '-' + g.toId).join(', ') + '.';
    }
    return s;
  }

  class TradeBuffer {
    constructor(maxItems) {
      this.maxItems = Math.max(1000, Number(maxItems) || 1000000);
      this.items = [];
      this.head = 0;
      this.truncated = false;
    }
    length() { return this.items.length - this.head; }
    values() { return this.items.slice(this.head); }
    last() { return this.length() ? this.items[this.items.length - 1] : null; }
    replace(events) {
      this.items = events.slice();
      this.head = 0;
      this.truncated = false;
      this._enforceMax();
    }
    append(event) {
      const last = this.last();
      if (last && event.id <= last.id) return false;
      this.items.push(event);
      this._enforceMax();
      return true;
    }
    pruneBefore(cutoff) {
      while (this.head < this.items.length && this.items[this.head].t < cutoff) this.head += 1;
      this._compactMaybe();
    }
    _enforceMax() {
      const overflow = this.length() - this.maxItems;
      if (overflow > 0) {
        this.head += overflow;
        this.truncated = true;
        this._compactMaybe();
      }
    }
    _compactMaybe() {
      if (this.head > 65536 && this.head > this.items.length / 3) {
        this.items = this.items.slice(this.head);
        this.head = 0;
      }
    }
  }

  global.OrderFlowCore = {
    normalizeAggTrade,
    minMax,
    maxValue,
    selectTrades,
    analyzeTrades,
    detectGaps,
    mergeUniqueById,
    bucketCvd,
    clipFootprintPrices,
    rebinIndex,
    binPrice,
    rebinLadderRows,
    coverageText,
    TradeBuffer,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
