(function (global) {
  'use strict';

  const C = global.OrderFlowCore;
  const REST_BASES = ['https://fapi.binance.com', 'https://fapi1.binance.com', 'https://fapi2.binance.com'];

  class RequestLimiter {
    constructor(limit, windowMs) {
      this.limit = limit;
      this.windowMs = windowMs;
      this.times = [];
      this.head = 0;
    }
    async take() {
      for (;;) {
        const now = Date.now();
        while (this.head < this.times.length && now - this.times[this.head] >= this.windowMs) this.head += 1;
        if (this.head > 64 && this.head > this.times.length / 2) { this.times = this.times.slice(this.head); this.head = 0; }
        if (this.times.length - this.head < this.limit) {
          this.times.push(now);
          return;
        }
        const waitMs = Math.max(25, this.windowMs - (now - this.times[this.head]) + 10);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
  }

  async function fetchJson(url, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs || 12000);
    try {
      const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  class LiveFeed {
    constructor(options) {
      this.maxItems = Number(options.maxItems) || 1000000;
      this.onDirty = options.onDirty || function () {};
      this.onStatus = options.onStatus || function () {};
      this.onConnection = options.onConnection || function () {};
      this.store = new C.TradeBuffer(this.maxItems);
      this.symbol = 'BTCUSDT';
      this.ws = null;
      this.pending = [];
      this.initializing = false;
      this.repairing = false;
      this.unresolvedGaps = [];
      this.manualDisconnect = true;
      this.reconnectAttempt = 0;
      this.reconnectTimer = null;
      this.rotateTimer = null;
      this.generation = 0;
      this.limiter = new RequestLimiter(60, 60000);
    }

    snapshot() {
      return {
        trades: this.store.values(),
        truncated: this.store.truncated,
        gaps: this.unresolvedGaps.slice(),
        symbol: this.symbol,
      };
    }

    async start(symbol) {
      this.stop();
      this.symbol = symbol;
      this.store = new C.TradeBuffer(this.maxItems);
      this.pending = [];
      this.unresolvedGaps = [];
      this.manualDisconnect = false;
      this.initializing = true;
      this.reconnectAttempt = 0;
      this.onConnection('CONNECTING');
      this._openSocket();
      try {
        const seed = await this._seedRecent();
        const buffered = this.pending.splice(0);
        this.store.replace(C.mergeUniqueById(seed, buffered));
        this._pruneWindow();
        await this._repairUntilStable();
        this.onStatus('Seeded recent aggregate trades and synchronized WebSocket sequence.');
      } catch (error) {
        this.onStatus('REST seed failed: ' + error.message + '. Live WebSocket capture continues.');
        const buffered = this.pending.splice(0);
        this.store.replace(C.mergeUniqueById(buffered));
      } finally {
        this.initializing = false;
        this._recomputeGaps();
        this.onDirty();
      }
    }

    stop() {
      this.manualDisconnect = true;
      this.initializing = false;
      this.repairing = false;
      clearTimeout(this.reconnectTimer);
      clearTimeout(this.rotateTimer);
      this.reconnectTimer = null;
      this.rotateTimer = null;
      this.generation += 1;
      if (this.ws) {
        const socket = this.ws;
        this.ws = null;
        try { socket.close(); } catch (_) {}
      }
      this.onConnection('DISCONNECTED');
    }

    _openSocket() {
      if (this.manualDisconnect) return;
      const generation = ++this.generation;
      const url = 'wss://fstream.binance.com/ws/' + this.symbol.toLowerCase() + '@aggTrade';
      let socket;
      try {
        socket = new WebSocket(url);
      } catch (error) {
        this.onStatus('WebSocket creation failed: ' + error.message);
        this._scheduleReconnect();
        return;
      }
      this.ws = socket;
      socket.onopen = () => {
        if (generation !== this.generation || this.manualDisconnect) return;
        this.reconnectAttempt = 0;
        this.onConnection('LIVE');
        clearTimeout(this.rotateTimer);
        this.rotateTimer = setTimeout(() => {
          if (this.ws === socket && !this.manualDisconnect) {
            this.onStatus('Rotating WebSocket before Binance 24h connection limit.');
            try { socket.close(); } catch (_) {}
          }
        }, 23 * 60 * 60 * 1000);
      };
      socket.onmessage = (event) => {
        if (generation !== this.generation || this.manualDisconnect) return;
        let trade;
        try { trade = C.normalizeAggTrade(JSON.parse(event.data)); } catch (_) { return; }
        if (!trade) return;
        if (this.initializing || this.repairing) {
          this.pending.push(trade);
          return;
        }
        this._ingestLive(trade);
      };
      socket.onerror = () => {
        if (generation === this.generation && !this.manualDisconnect) {
          this.onConnection('WS ERROR');
          try { socket.close(); } catch (_) { this._scheduleReconnect(); }
        }
      };
      socket.onclose = () => {
        if (generation !== this.generation || this.manualDisconnect) return;
        clearTimeout(this.rotateTimer);
        this.onConnection('RECONNECTING');
        this._scheduleReconnect();
      };
    }

    _scheduleReconnect() {
      if (this.manualDisconnect || this.reconnectTimer) return;
      const delay = Math.min(30000, 1000 * (2 ** this.reconnectAttempt));
      this.reconnectAttempt += 1;
      this.onStatus('WebSocket disconnected. Reconnecting in ' + Math.round(delay / 1000) + 's.');
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this._openSocket();
      }, delay);
    }

    async _seedRecent() {
      let lastError = null;
      for (const base of REST_BASES) {
        try {
          await this.limiter.take();
          const rows = await fetchJson(base + '/fapi/v1/aggTrades?symbol=' + encodeURIComponent(this.symbol) + '&limit=1000', 12000);
          return rows.map(C.normalizeAggTrade).filter(Boolean);
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError || new Error('No Binance REST endpoint reachable');
    }

    _ingestLive(trade) {
      const last = this.store.last();
      if (!last) {
        this.store.append(trade);
        this.onDirty();
        return;
      }
      if (trade.id === last.id + 1) {
        this.store.append(trade);
        this._pruneWindow();
        this.onDirty();
        return;
      }
      if (trade.id <= last.id) return;
      this.pending.push(trade);
      this._repairUntilStable().catch((error) => {
        this.onStatus('Gap repair failed: ' + error.message);
      });
    }

    async _repairUntilStable() {
      if (this.repairing) return;
      this.repairing = true;
      try {
        let passes = 0;
        while (passes < 6) {
          passes += 1;
          const pending = this.pending.splice(0);
          let merged = C.mergeUniqueById(this.store.values(), pending);
          const gaps = C.detectGaps(merged);
          if (!gaps.length) {
            this.store.replace(merged);
            this._pruneWindow();
            this.unresolvedGaps = [];
            break;
          }
          let changed = false;
          const unresolved = [];
          for (const gap of gaps) {
            const repaired = await this._repairRange(gap.fromId, gap.toId);
            if (repaired.complete) {
              merged = C.mergeUniqueById(merged, repaired.events);
              changed = true;
            } else {
              unresolved.push(gap);
            }
          }
          this.store.replace(merged);
          this._pruneWindow();
          this.unresolvedGaps = unresolved.length ? unresolved : C.detectGaps(this.store.values());
          if (!changed && !this.pending.length) break;
        }
        if (this.pending.length) {
          const merged = C.mergeUniqueById(this.store.values(), this.pending.splice(0));
          this.store.replace(merged);
          this._pruneWindow();
          this._recomputeGaps();
        }
      } finally {
        this.repairing = false;
        this.onDirty();
      }
    }

    async _repairRange(fromId, toId) {
      const events = [];
      let cursor = fromId;
      let guard = 0;
      while (cursor <= toId && guard < 10000) {
        guard += 1;
        await this.limiter.take();
        let rows = null;
        let error = null;
        for (const base of REST_BASES) {
          try {
            rows = await fetchJson(base + '/fapi/v1/aggTrades?symbol=' + encodeURIComponent(this.symbol) + '&fromId=' + cursor + '&limit=1000', 12000);
            error = null;
            break;
          } catch (e) { error = e; }
        }
        if (!rows) {
          this.onStatus('Unable to repair aggTrade IDs ' + cursor + '-' + toId + ': ' + (error ? error.message : 'unknown error'));
          return { events, complete: false };
        }
        const normalized = rows.map(C.normalizeAggTrade).filter(Boolean).filter((x) => x.id >= cursor && x.id <= toId);
        if (!normalized.length || normalized[0].id !== cursor) return { events, complete: false };
        for (const item of normalized) events.push(item);
        const next = normalized[normalized.length - 1].id + 1;
        if (next <= cursor) return { events, complete: false };
        cursor = next;
      }
      const merged = C.mergeUniqueById(events);
      const complete = merged.length === (toId - fromId + 1) && !C.detectGaps(merged).length && merged[0].id === fromId && merged[merged.length - 1].id === toId;
      return { events: merged, complete };
    }

    _pruneWindow() {
      this.store.pruneBefore(Date.now() - 12 * 60 * 60 * 1000);
    }

    _recomputeGaps() {
      this.unresolvedGaps = C.detectGaps(this.store.values());
    }
  }

  global.OrderFlowLive = { LiveFeed, RequestLimiter, fetchJson };
})(typeof globalThis !== 'undefined' ? globalThis : window);
