(function (global) {
  'use strict';

  const T = global.OrderFlowChartTheme;

  function nextPaint() {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  function downloadCanvas(canvas, filename) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('PNG encoding failed'));
          return;
        }
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        resolve();
      }, 'image/png');
    });
  }

  function presetSize(name, container) {
    if (name === '1920x1080') return { width: 1920, height: 1080 };
    if (name === '2400x960') return { width: 2400, height: 960 };
    return {
      width: Math.max(800, Math.round(container.clientWidth)),
      height: Math.max(520, Math.round(container.clientHeight + 118)),
    };
  }

  async function exportPng(options) {
    const chart = options.chart;
    const container = options.container;
    const preset = options.preset || 'current';
    const target = presetSize(preset, container);
    const headerH = 78;
    const footerH = 40;
    const chartH = Math.max(360, target.height - headerH - footerH);

    const oldStyleWidth = container.style.width;
    const oldStyleHeight = container.style.height;
    const oldWidth = container.clientWidth;
    const oldHeight = container.clientHeight;

    container.style.width = target.width + 'px';
    container.style.height = chartH + 'px';
    chart.resize(target.width, chartH, true);
    await nextPaint();

    const shot = chart.takeScreenshot(true, false);
    const scale = shot.width / target.width;
    const canvas = document.createElement('canvas');
    canvas.width = shot.width;
    canvas.height = Math.round(target.height * scale);
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);

    ctx.fillStyle = T.background;
    ctx.fillRect(0, 0, target.width, target.height);

    ctx.fillStyle = T.textStrong;
    ctx.font = '600 17px -apple-system, BlinkMacSystemFont, Segoe UI, Arial, sans-serif';
    ctx.fillText(options.infoLines[0] || '', 18, 27);
    ctx.fillStyle = T.text;
    ctx.font = '13px -apple-system, BlinkMacSystemFont, Segoe UI, Arial, sans-serif';
    ctx.fillText(options.infoLines[1] || '', 18, 52);

    ctx.drawImage(shot, 0, headerH, target.width, chartH);

    ctx.fillStyle = T.muted;
    ctx.font = '12px -apple-system, BlinkMacSystemFont, Segoe UI, Arial, sans-serif';
    ctx.fillText(options.footer || '', 18, target.height - 15);

    container.style.width = oldStyleWidth;
    container.style.height = oldStyleHeight;
    chart.resize(oldWidth, oldHeight, true);
    await nextPaint();

    const filename = (options.filenameBase || 'order-flow-chart') + '-' + preset + '.png';
    await downloadCanvas(canvas, filename);
    return { width: canvas.width, height: canvas.height, filename };
  }

  global.OrderFlowChartExport = { exportPng, presetSize };
})(typeof globalThis !== 'undefined' ? globalThis : window);
