/**
 * LIFE OS - Canvas chart helpers (vanilla JS)
 */
(function (global) {
  'use strict';

  const COLORS = {
    productive: '#1e7bff',
    study: '#1e7bff',
    neutral: '#00ff9d',
    distraction: '#ff3355',
    rest: '#00ff9d'
  };

  const CATEGORY_LABELS = {
    productive: 'Productive + Study',
    neutral: 'Neutral',
    distraction: 'Distraction'
  };

  function duration(entry) {
    return Math.max(0, Number(entry.durationMs) || 0);
  }

  function sumEntries(entries) {
    return entries.reduce((s, e) => s + duration(e), 0);
  }

  function formatMs(ms) {
    const m = Math.floor(ms / 60000);
    const h = Math.floor(m / 60);
    const rm = m % 60;
    if (h > 0) return h + 'h ' + rm + 'm';
    if (m > 0) return m + 'm';
    return Math.floor(ms / 1000) + 's';
  }

  function setupCanvas(canvas, width, height) {
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    return ctx;
  }

  function categoryTotals(entries, getCategory) {
    const totals = { productive: 0, neutral: 0, distraction: 0 };
    entries.forEach((entry) => {
      const cat = entry.category || getCategory(entry.main);
      const d = duration(entry);
      if (cat === 'distraction') totals.distraction += d;
      else if (cat === 'productive' || cat === 'study') totals.productive += d;
      else totals.neutral += d;
    });
    return totals;
  }

  function categorySlices(entries, getCategory) {
    const totals = categoryTotals(entries, getCategory);
    return Object.entries(totals).map(([key, value]) => ({
      key,
      label: CATEGORY_LABELS[key] || key,
      value,
      color: COLORS[key] || COLORS.neutral
    }));
  }

  function taskSlices(entries) {
    const totals = {};
    entries.forEach((entry) => {
      const label = entry.sub ? `${entry.main} > ${entry.sub}` : entry.main;
      totals[label] = (totals[label] || 0) + duration(entry);
    });
    const palette = ['#00ff9d', '#1e7bff', '#ff3355', '#00b4ff', '#ffaa00', '#6fb0ff', '#36ffc0'];
    return Object.entries(totals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([label, value], i) => ({ label, value, color: palette[i % palette.length] }));
  }

  function lineSeries(entries, getCategory) {
    const byBucket = new Map();
    entries.forEach((entry, index) => {
      const start = Number(entry.start || entry.startTime || 0);
      const date = start ? new Date(start) : null;
      const bucket = entry.dayKey || (date ? date.toISOString().slice(0, 10) : 'Session ' + (index + 1));
      if (!byBucket.has(bucket)) {
        byBucket.set(bucket, { label: formatBucket(bucket), productive: 0, neutral: 0, distraction: 0 });
      }
      const cat = entry.category || getCategory(entry.main);
      const d = duration(entry);
      if (cat === 'distraction') byBucket.get(bucket).distraction += d;
      else if (cat === 'neutral' || cat === 'rest') byBucket.get(bucket).neutral += d;
      else byBucket.get(bucket).productive += d;
    });
    return [...byBucket.values()];
  }

  function formatBucket(bucket) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(bucket)) {
      const date = new Date(bucket + 'T12:00:00');
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    return bucket;
  }

  function drawEmpty(ctx, width, height) {
    ctx.fillStyle = '#5a6a7a';
    ctx.font = '13px Share Tech Mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('No data yet', width / 2, height / 2);
  }

  function drawBar(canvas, slices, title) {
    const width = 520;
    const height = 260;
    const ctx = setupCanvas(canvas, width, height);
    if (!ctx) return;

    ctx.fillStyle = '#c8d6e5';
    ctx.font = '700 12px Orbitron, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(title, 18, 24);

    const active = slices.filter((s) => s.value > 0);
    if (!active.length) return drawEmpty(ctx, width, height);

    const max = Math.max(...active.map((s) => s.value));
    const barX = 150;
    const barMax = width - barX - 80;
    const rowH = Math.min(34, Math.floor((height - 52) / active.length));

    active.forEach((slice, index) => {
      const y = 48 + index * rowH;
      const w = Math.max(3, (slice.value / max) * barMax);
      ctx.fillStyle = '#ffffff';
      ctx.font = '12px Share Tech Mono, monospace';
      ctx.textAlign = 'right';
      ctx.fillText(slice.label.slice(0, 18), barX - 14, y + 14);
      ctx.fillStyle = '#071018';
      ctx.fillRect(barX, y, barMax, 16);
      ctx.fillStyle = slice.color;
      ctx.fillRect(barX, y, w, 16);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'left';
      ctx.fillText(formatMs(slice.value), barX + barMax + 12, y + 13);
    });
  }

  function drawPie(canvas, slices, title) {
    const size = 260;
    const ctx = setupCanvas(canvas, size, size);
    if (!ctx) return;

    const total = slices.reduce((s, x) => s + x.value, 0);
    const cx = size / 2;
    const cy = size / 2 + 6;
    const r = size * 0.34;

    ctx.fillStyle = '#c8d6e5';
    ctx.font = '700 12px Orbitron, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(title, cx, 20);

    if (total <= 0) return drawEmpty(ctx, size, size);

    let start = -Math.PI / 2;
    slices.forEach((slice) => {
      if (slice.value <= 0) return;
      const angle = (slice.value / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, start, start + angle);
      ctx.closePath();
      ctx.fillStyle = slice.color;
      ctx.fill();
      ctx.strokeStyle = '#050608';
      ctx.lineWidth = 2;
      ctx.stroke();
      start += angle;
    });

    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = '#0a0e14';
    ctx.fill();

    const top = slices.filter((s) => s.value > 0).sort((a, b) => b.value - a.value)[0];
    if (top) {
      const pct = Math.round((top.value / total) * 100);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 17px Orbitron, sans-serif';
      ctx.fillText(pct + '%', cx, cy + 4);
      ctx.fillStyle = top.color;
      ctx.font = '10px Share Tech Mono, monospace';
      ctx.fillText(top.label.slice(0, 18), cx, cy + 22);
    }
  }

  function drawLine(canvas, points, title) {
    const width = 560;
    const height = 280;
    const ctx = setupCanvas(canvas, width, height);
    if (!ctx) return;

    ctx.fillStyle = '#c8d6e5';
    ctx.font = '700 12px Orbitron, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(title, 18, 24);

    if (!points.length) return drawEmpty(ctx, width, height);

    const series = [
      { key: 'productive', label: 'Productive', color: COLORS.productive },
      { key: 'neutral', label: 'Neutral', color: COLORS.neutral },
      { key: 'distraction', label: 'Distraction', color: COLORS.distraction }
    ];

    const left = 52;
    const right = 20;
    const top = 46;
    const bottom = 48;
    const chartW = width - left - right;
    const chartH = height - top - bottom;
    const max = Math.max(1, ...points.flatMap((p) => series.map((s) => p[s.key] || 0)));

    ctx.strokeStyle = '#1a2a3a';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i += 1) {
      const y = top + (chartH / 4) * i;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(width - right, y);
      ctx.stroke();
    }

    series.forEach((s) => {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      points.forEach((point, index) => {
        const x = left + (points.length === 1 ? chartW / 2 : (chartW / (points.length - 1)) * index);
        const y = top + chartH - ((point[s.key] || 0) / max) * chartH;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    });

    points.forEach((point, index) => {
      const x = left + (points.length === 1 ? chartW / 2 : (chartW / (points.length - 1)) * index);
      ctx.fillStyle = '#ffffff';
      ctx.font = '10px Share Tech Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(point.label, x, height - 18);
    });
  }

  function legendHTML(slices, total) {
    if (!total) return '<p class="chart-legend-empty">Log tasks to see percentages</p>';
    return slices
      .filter((s) => s.value > 0)
      .sort((a, b) => b.value - a.value)
      .map((s) => {
        const pct = Math.round((s.value / total) * 100);
        return `<div class="chart-legend-item">
          <span class="chart-dot" style="background:${s.color}"></span>
          <span class="chart-legend-label">${escapeHtml(s.label)}</span>
          <span class="chart-pct">${formatMs(s.value)} · ${pct}%</span>
        </div>`;
      })
      .join('');
  }

  function lineLegendHTML(points) {
    const totals = points.reduce((acc, point) => {
      acc.productive += point.productive || 0;
      acc.neutral += point.neutral || 0;
      acc.distraction += point.distraction || 0;
      return acc;
    }, { productive: 0, neutral: 0, distraction: 0 });
    const total = totals.productive + totals.neutral + totals.distraction;
    return legendHTML([
      { label: 'Productive + Study', value: totals.productive, color: COLORS.productive },
      { label: 'Neutral + Rest', value: totals.neutral, color: COLORS.neutral },
      { label: 'Distraction', value: totals.distraction, color: COLORS.distraction }
    ], total);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    })[ch]);
  }

  function renderChartsPanel(container, entries, getCategory, options = {}) {
    if (!container) return;

    const chartType = options.chartType || 'bar';
    const total = sumEntries(entries);
    const category = categorySlices(entries, getCategory);
    const tasks = taskSlices(entries);
    const line = lineSeries(entries, getCategory);
    const rangeLabel = {
      today: 'Today',
      yesterday: 'Yesterday',
      week: 'This Week',
      month: 'This Month'
    }[options.range] || 'Today';
    const typeLabel = {
      bar: 'Bar Chart',
      pie: 'Pie Chart',
      line: 'Line Chart'
    }[chartType] || 'Bar Chart';

    container.innerHTML = `
      <p class="charts-summary">${rangeLabel} · ${typeLabel} · Total tracked: <strong>${formatMs(total)}</strong> · ${entries.length} sessions</p>
      <div class="charts-grid charts-grid-${chartType}">
        <div class="chart-card chart-card-wide">
          <h4>Category Breakdown</h4>
          <canvas id="chartMain"></canvas>
          <div class="chart-legend" id="legendMain"></div>
        </div>
        <div class="chart-card chart-card-wide">
          <h4>Task Breakdown</h4>
          <canvas id="chartTasks"></canvas>
          <div class="chart-legend" id="legendTasks"></div>
        </div>
      </div>`;

    if (chartType === 'pie') {
      drawPie(container.querySelector('#chartMain'), category, 'CATEGORY SHARE');
      drawPie(container.querySelector('#chartTasks'), tasks, 'TOP TASKS');
      container.querySelector('#legendMain').innerHTML = legendHTML(category, total);
      container.querySelector('#legendTasks').innerHTML = legendHTML(tasks, total);
      return;
    }

    if (chartType === 'line') {
      drawLine(container.querySelector('#chartMain'), line, 'CATEGORY TREND');
      drawLine(container.querySelector('#chartTasks'), line.map((point) => ({
        label: point.label,
        productive: point.productive + point.neutral + point.distraction,
        neutral: point.neutral,
        distraction: point.distraction
      })), 'TRACKED TIME TREND');
      container.querySelector('#legendMain').innerHTML = lineLegendHTML(line);
      container.querySelector('#legendTasks').innerHTML = legendHTML(tasks, total);
      return;
    }

    drawBar(container.querySelector('#chartMain'), category, 'CATEGORY TOTALS');
    drawBar(container.querySelector('#chartTasks'), tasks, 'TOP TASK TOTALS');
    container.querySelector('#legendMain').innerHTML = legendHTML(category, total);
    container.querySelector('#legendTasks').innerHTML = legendHTML(tasks, total);
  }

  global.LifeOSCharts = { renderChartsPanel, COLORS };
})(typeof window !== 'undefined' ? window : global);
