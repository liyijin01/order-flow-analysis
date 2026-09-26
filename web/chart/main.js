(function () {
  'use strict';

  const L = window.LightweightCharts;
  const T = window.OrderFlowChartTheme;
  const D = window.OrderFlowChartData;
  const E = window.OrderFlowChartExport;
  const SYMBOLS = window.ORDER_FLOW_SYMBOLS || {};

  const $ = (id) => document.getElementById(id);
  const container = $('chart');
  const status = $('status');
  const infoLine1 = $('infoLine1');
  const infoLine2 = $('infoLine2');
  const footerLocal = $('footerLocal');

  const state = {
    symbol: 'BTCUSDT',
    market: 'um',
    interval: '1h',
    candleStyle: 'mono',
    data: [],
    byTime: new Map(),
    chart: null,
    candles: null,
    volume: null,
    watermark: null,
    countdownLine: null,
    loadToken: 0,
    latestRefreshBusy: false,
  };

  function setStatus(message, isError) {
    status.textContent = message;
    status.className = isError ? 'status error' : 'status';
  }

  function symbolMeta() {
    return SYMBOLS[state.symbol] || { base: state.symbol.replace('USDT',''), name: state.symbol };
  }

  function displayCode() {
    return D.displayCode(state.symbol, state.market);
  }

  function priceDecimals(value) {
    if (value >= 1000) return 2;
    if (value >= 10) return 3;
    return 4;
  }

  function fmtPrice(value) {
    return Number(value).toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: priceDecimals(Number(value)),
    });
  }

  function fmtVolume(value) {
    return Number(value).toLocaleString(undefined, { maximumFractionDigits: 3 });
  }

  function formatInfo(candle) {
    if (!candle) return ['', ''];
    const change = candle.close - candle.open;
    const pct = candle.open ? change / candle.open * 100 : 0;
    const sign = change >= 0 ? '+' : '';
    const meta = symbolMeta();
    const local = D.formatLocalDateTime(candle.time, false);
    const line1 =
      displayCode() + ' · ' + meta.name + ' · ' + D.intervalLabel(state.interval) +
      ' · Binance · ' + local +
      '  开=' + fmtPrice(candle.open) +
      ' 高=' + fmtPrice(candle.high) +
      ' 低=' + fmtPrice(candle.low) +
      ' 收=' + fmtPrice(candle.close) +
      '  涨跌 ' + sign + fmtPrice(change) + ' (' + sign + pct.toFixed(2) + '%)' +
      '  成交量 ' + fmtVolume(candle.volume) + ' ' + meta.base;
    const line2 =
      'Volume (' + meta.base + ') ' + fmtVolume(candle.volume) +
      ' · Quote ' + Number(candle.quoteVolume).toLocaleString(undefined,{maximumFractionDigits:0}) + ' USDT' +
      ' · Local zone ' + D.localTimeZone();
    return [line1, line2];
  }

  function updateInfo(candle) {
    const lines = formatInfo(candle);
    infoLine1.textContent = lines[0];
    infoLine2.textContent = lines[1];
  }

  function candleOptions() {
    if (state.candleStyle === 'color') {
      return {
        upColor: T.colorUpFill,
        downColor: T.colorDownFill,
        borderVisible: true,
        borderUpColor: T.colorUpBorder,
        borderDownColor: T.colorDownBorder,
        wickUpColor: T.colorUpBorder,
        wickDownColor: T.colorDownBorder,
        lastValueVisible: true,
        priceLineVisible: true,
      };
    }
    return {
      upColor: T.upColor,
      downColor: T.downColor,
      borderVisible: true,
      borderUpColor: T.upBorder,
      borderDownColor: T.downBorder,
      wickUpColor: T.upWick,
      wickDownColor: T.downWick,
      lastValueVisible: true,
      priceLineVisible: true,
    };
  }

  function createChart() {
    if (!L) throw new Error('Lightweight Charts failed to load');
    const chart = L.createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: {
        background: { type: 'solid', color: T.background },
        textColor: T.text,
        attributionLogo: true,
        panes: {
          separatorColor: T.border,
          separatorHoverColor: 'rgba(255,255,255,0.22)',
          enableResize: true,
        },
      },
      grid: {
        vertLines: { color: T.grid },
        horzLines: { color: T.grid },
      },
      localization: {
        locale: navigator.language,
        timeFormatter: (time) => D.formatLocalDateTime(time, false),
      },
      rightPriceScale: {
        borderColor: T.border,
      },
      timeScale: {
        borderColor: T.border,
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (time) => D.formatLocalTick(time, state.interval),
      },
      crosshair: {
        mode: L.CrosshairMode.Normal,
      },
    });

    const candles = chart.addSeries(L.CandlestickSeries, candleOptions(), 0);
    const volume = chart.addSeries(L.HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceLineVisible: false,
      lastValueVisible: false,
    }, 1);

    const panes = chart.panes();
    if (panes[1]) panes[1].setHeight(Math.max(100, Math.round(container.clientHeight * 0.19)));

    const watermark = L.createTextWatermark(chart.panes()[0], {
      horzAlign: 'center',
      vertAlign: 'center',
      lines: [{
        text: displayCode() + ', ' + D.intervalLabel(state.interval),
        color: T.watermark,
        fontSize: 42,
        fontStyle: 'bold',
      }],
    });

    const observer = new ResizeObserver(() => {
      chart.resize(container.clientWidth, container.clientHeight);
      const currentPanes = chart.panes();
      if (currentPanes[1]) currentPanes[1].setHeight(Math.max(90, Math.round(container.clientHeight * 0.19)));
    });
    observer.observe(container);

    chart.subscribeCrosshairMove((param) => {
      if (!param || !param.time) {
        updateInfo(state.data[state.data.length - 1]);
        return;
      }
      const candle = state.byTime.get(Number(param.time));
      updateInfo(candle || state.data[state.data.length - 1]);
    });

    state.chart = chart;
    state.candles = candles;
    state.volume = volume;
    state.watermark = watermark;
  }

  function updateWatermark() {
    if (!state.watermark) return;
    state.watermark.applyOptions({
      lines: [{
        text: displayCode() + ', ' + D.intervalLabel(state.interval),
        color: T.watermark,
        fontSize: 42,
        fontStyle: 'bold',
      }],
    });
  }

  function seriesData(rows) {
    const candles = rows.map((c) => ({
      time: c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    const volumes = rows.map((c) => ({
      time: c.time,
      value: c.volume,
      color: c.close >= c.open ? T.volumeUp : T.volumeDown,
    }));
    return { candles, volumes };
  }

  function updateCountdown() {
    const last = state.data[state.data.length - 1];
    if (!last || !state.candles) return;
    const title = D.remainingText(last.closeTime, Date.now());
    if (!state.countdownLine) {
      state.countdownLine = state.candles.createPriceLine({
        price: last.close,
        color: T.white,
        lineVisible: false,
        axisLabelVisible: true,
        title,
      });
    } else {
      state.countdownLine.applyOptions({
        price: last.close,
        title,
        color: T.white,
        axisLabelVisible: true,
      });
    }
  }

  function applyUiState() {
    $('pageTitle').textContent = displayCode() + ' · ' + D.intervalLabel(state.interval);
    updateWatermark();
    if (state.chart) {
      state.chart.applyOptions({
        timeScale: {
          tickMarkFormatter: (time) => D.formatLocalTick(time, state.interval),
        },
        localization: {
          locale: navigator.language,
          timeFormatter: (time) => D.formatLocalDateTime(time, false),
        },
      });
    }
    if (state.candles) state.candles.applyOptions(candleOptions());
  }

  async function loadData() {
    const token = ++state.loadToken;
    setStatus('Loading ' + displayCode() + ' ' + state.interval + '…');
    try {
      const rows = await D.fetchKlines({
        market: state.market,
        symbol: state.symbol,
        interval: state.interval,
      });
      if (token !== state.loadToken) return;
      state.data = rows;
      state.byTime = new Map(rows.map((c) => [c.time, c]));
      const out = seriesData(rows);
      state.candles.setData(out.candles);
      state.volume.setData(out.volumes);
      state.chart.timeScale().fitContent();
      updateInfo(rows[rows.length - 1]);
      updateCountdown();
      const first = rows[0];
      const last = rows[rows.length - 1];
      setStatus(
        'Loaded ' + rows.length + ' candles · ' +
        D.formatLocalDateTime(first.time, false) + ' → ' +
        D.formatLocalDateTime(last.time, false) +
        ' · browser time zone: ' + D.localTimeZone()
      );
    } catch (error) {
      console.error(error);
      setStatus('Unable to load Binance candles: ' + error.message, true);
    }
  }

  async function refreshLatest() {
    if (state.latestRefreshBusy || !state.data.length) return;
    state.latestRefreshBusy = true;
    try {
      const rows = await D.fetchLatest({
        market: state.market,
        symbol: state.symbol,
        interval: state.interval,
      });
      if (!rows.length) return;
      for (const candle of rows) {
        state.byTime.set(candle.time, candle);
        const index = state.data.findIndex((x) => x.time === candle.time);
        if (index >= 0) state.data[index] = candle;
        else state.data.push(candle);
        state.candles.update({
          time: candle.time,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
        });
        state.volume.update({
          time: candle.time,
          value: candle.volume,
          color: candle.close >= candle.open ? T.volumeUp : T.volumeDown,
        });
      }
      state.data.sort((a,b) => a.time - b.time);
      updateInfo(state.data[state.data.length - 1]);
      updateCountdown();
    } catch (error) {
      console.warn('latest candle refresh failed', error);
    } finally {
      state.latestRefreshBusy = false;
    }
  }

  function syncFromControls() {
    state.symbol = $('symbol').value;
    state.market = $('market').value;
    state.interval = $('interval').value;
    state.candleStyle = $('candleStyle').value;
    applyUiState();
  }

  function syncControlsFromQuery() {
    const q = new URLSearchParams(location.search);
    const symbol = q.get('symbol');
    const market = q.get('market');
    const interval = q.get('interval');
    if (symbol && SYMBOLS[symbol]) $('symbol').value = symbol;
    if (market === 'um' || market === 'spot') $('market').value = market;
    if (['15m','30m','1h','2h','4h','1d'].includes(interval)) $('interval').value = interval;
  }

  function footerText() {
    return 'Generated ' + D.formatLocalDateTime(Math.floor(Date.now()/1000), false) +
      ' ' + D.localTimeZone() + ' · Data: Binance · order-flow-analysis';
  }

  async function exportCurrent() {
    const preset = $('exportSize').value;
    const previous = $('exportBtn').textContent;
    $('exportBtn').disabled = true;
    $('exportBtn').textContent = 'Exporting…';
    try {
      updateInfo(state.data[state.data.length - 1]);
      const result = await E.exportPng({
        chart: state.chart,
        container,
        preset,
        infoLines: [infoLine1.textContent, infoLine2.textContent],
        footer: footerText(),
        filenameBase: displayCode().replace('.','-') + '-' + state.interval,
      });
      setStatus('Exported ' + result.filename + ' · ' + result.width + '×' + result.height + ' px');
    } catch (error) {
      console.error(error);
      setStatus('PNG export failed: ' + error.message, true);
    } finally {
      $('exportBtn').disabled = false;
      $('exportBtn').textContent = previous;
    }
  }

  async function onSelectionChange() {
    syncFromControls();
    await loadData();
  }

  async function init() {
    if (!L) {
      setStatus('Lightweight Charts failed to load. Check CDN/SRI or network access.', true);
      return;
    }
    syncControlsFromQuery();
    state.symbol = $('symbol').value;
    state.market = $('market').value;
    state.interval = $('interval').value;
    state.candleStyle = $('candleStyle').value;

    createChart();
    applyUiState();

    $('symbol').addEventListener('change', onSelectionChange);
    $('market').addEventListener('change', onSelectionChange);
    $('interval').addEventListener('change', onSelectionChange);
    $('candleStyle').addEventListener('change', () => {
      state.candleStyle = $('candleStyle').value;
      state.candles.applyOptions(candleOptions());
    });
    $('exportBtn').addEventListener('click', exportCurrent);

    footerLocal.textContent = 'Display time: browser local · ' + D.localTimeZone();

    await loadData();
    setInterval(updateCountdown, 1000);
    setInterval(refreshLatest, 15000);
  }

  init();
})();
