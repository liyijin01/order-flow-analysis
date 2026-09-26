(function () {
  'use strict';

  const container = document.getElementById('chart');
  const status = document.getElementById('status');

  function setStatus(message, isError) {
    status.textContent = message;
    status.className = isError ? 'status error' : 'status';
  }

  function toCandles(rows) {
    return rows.map((row) => ({
      time: Math.floor(Number(row[0]) / 1000),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
    }));
  }

  async function fetchKlines() {
    const bases = [
      'https://fapi.binance.com',
      'https://fapi1.binance.com',
      'https://fapi2.binance.com',
    ];
    let lastError = null;
    for (const base of bases) {
      try {
        const url = base + '/fapi/v1/klines?symbol=BTCUSDT&interval=1h&limit=500';
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const rows = await response.json();
        if (!Array.isArray(rows) || rows.length === 0) throw new Error('empty kline response');
        return rows;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('Binance kline request failed');
  }

  function createChart() {
    const chart = LightweightCharts.createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: {
        background: { type: 'solid', color: '#1b2130' },
        textColor: '#aeb7c8',
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.04)' },
        horzLines: { color: 'rgba(255,255,255,0.04)' },
      },
      rightPriceScale: {
        borderColor: 'rgba(255,255,255,0.14)',
      },
      timeScale: {
        borderColor: 'rgba(255,255,255,0.14)',
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
      },
    });

    const series = chart.addSeries(LightweightCharts.CandlestickSeries, {
      upColor: '#d9dde6',
      downColor: '#8791a4',
      borderUpColor: '#d9dde6',
      borderDownColor: '#8791a4',
      wickUpColor: '#d9dde6',
      wickDownColor: '#8791a4',
    });

    const observer = new ResizeObserver(() => {
      chart.resize(container.clientWidth, container.clientHeight);
    });
    observer.observe(container);

    return { chart, series };
  }

  async function main() {
    if (!window.LightweightCharts) {
      setStatus('Lightweight Charts failed to load. Check CDN/SRI or network access.', true);
      return;
    }

    const view = createChart();
    try {
      const rows = await fetchKlines();
      const candles = toCandles(rows);
      view.series.setData(candles);
      view.chart.timeScale().fitContent();
      const first = new Date(Number(rows[0][0])).toISOString();
      const last = new Date(Number(rows[rows.length - 1][0])).toISOString();
      setStatus('Loaded ' + candles.length + ' BTCUSDT perpetual 1h candles · ' + first + ' → ' + last + ' UTC');
    } catch (error) {
      console.error(error);
      setStatus('Unable to load Binance 1h candles: ' + error.message, true);
    }
  }

  main();
})();
