/**
 * LIFE OS - Canvas chart helpers (vanilla JS)
 */
(function (global) {
  'use strict';

  const COLORS = {
    productive: '#1e7bff',
    neutral: '#00ff9d',
    distraction: '#ff3355',
    muted: '#1a2a3a',
    text: '#ffffff'
  };

  const PALETTE = ['#1e7bff', '#00ff9d', '#ff3355', '#00b4ff', '#ffaa00', '#6fb0ff', '#36ffc0', '#ff7aa2', '#b8ff7a', '#9f8cff'];

  function duration(entry) {
    return Math.max(0, Number(entry.durationMs) || 0);
  }

  function formatMs(ms) {
    const totalMinutes = Math.floor(ms / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0) return hours + 'h ' + minutes + 'm';
    if (totalMinutes > 0) return totalMinutes + 'm';
    return Math.floor(ms / 1000) + 's';
  }

  function categoryKey(entry, getCategory) {
    const cat = entry.category || getCategory(entry.main);
    if (cat === 'distraction') return 'distraction';
    if (cat === 'productive' || cat === 'study') return 'productive';
    return 'neutral';
  }

  function detailLabel(entry) {
    return entry.sub ? `${entry.main} > ${entry.sub}` : entry.main;
  }

  function subtaskLabel(entry) {
    return entry.sub || entry.main || '--';
  }

  function sum(values) {
    return values.reduce((total, item) => total + item.value, 0);
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

  function addToMap(map, key, value, meta = {}) {
    if (!key) return;
    if (!map.has(key)) map.set(key, { label: key, value: 0, ...meta });
    map.get(key).value += value;
  }

  function toSlices(map, palette = PALETTE) {
    return [...map.values()]
      .sort((a, b) => b.value - a.value)
      .map((item, index) => ({
        ...item,
        color: item.color || palette[index % palette.length]
      }));
  }

  function buildBreakdowns(entries, getCategory) {
    const categories = new Map([
      ['productive', { label: 'Productive', value: 0, color: COLORS.productive }],
      ['neutral', { label: 'Neutral', value: 0, color: COLORS.neutral }],
      ['distraction', { label: 'Distraction', value: 0, color: COLORS.distraction }]
    ]);
    const detail = new Map();
    const productive = new Map();
    const neutral = new Map();
    const distraction = new Map();
    const subtasks = new Map();

    entries.forEach((entry) => {
      const d = duration(entry);
      if (!d) return;
      const cat = categoryKey(entry, getCategory);
      categories.get(cat).value += d;

      addToMap(detail, detailLabel(entry), d, { category: cat, color: COLORS[cat] });
      if (cat === 'productive') addToMap(productive, detailLabel(entry), d, { color: COLORS.productive });
      if (cat === 'neutral') addToMap(neutral, detailLabel(entry), d, { color: COLORS.neutral });
      if (cat === 'distraction') addToMap(distraction, detailLabel(entry), d, { color: COLORS.distraction });
      if (entry.sub) addToMap(subtasks, subtaskLabel(entry), d, { color: COLORS[cat] });
    });

    return {
      categories: toSlices(categories),
      detail: toSlices(detail),
      productive: toSlices(productive, ['#1e7bff', '#4c9bff', '#6fb0ff', '#00b4ff']),
      neutral: toSlices(neutral, ['#00ff9d', '#36ffc0', '#7dffcf', '#00cc7d']),
      distraction: toSlices(distraction, ['#ff3355', '#ff5f78', '#ff8296', '#d92040']),
      subtasks: toSlices(subtasks)
    };
  }

  function rangeDateKeys(model, range) {
    const days = (model && model.days ? model.days : []).map((day) => day.key).filter(Boolean);
    if (days.length) return [...days].sort();
    const keys = [...new Set((model && model.entries ? model.entries : []).map((entry) => entry.dayKey).filter(Boolean))].sort();
    return keys.length ? keys : [new Date().toISOString().slice(0, 10)];
  }

  function makeLineBuckets(model, range) {
    const entries = model && model.entries ? model.entries : [];
    const dayKeys = rangeDateKeys(model, range);
    const hourly = range === 'today' || range === 'yesterday';
    const buckets = [];

    if (hourly) {
      const dayKey = dayKeys[dayKeys.length - 1] || new Date().toISOString().slice(0, 10);
      for (let hour = 0; hour < 24; hour += 1) {
        const start = new Date(`${dayKey}T${String(hour).padStart(2, '0')}:00:00`).getTime();
        buckets.push({
          key: `${dayKey}-${hour}`,
          label: String(hour).padStart(2, '0') + ':00',
          start,
          end: start + 60 * 60 * 1000,
          productive: 0,
          neutral: 0,
          distraction: 0
        });
      }
    } else {
      dayKeys.forEach((dayKey) => {
        const start = new Date(`${dayKey}T00:00:00`).getTime();
        const date = new Date(`${dayKey}T12:00:00`);
        buckets.push({
          key: dayKey,
          label: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          start,
          end: start + 24 * 60 * 60 * 1000,
          productive: 0,
          neutral: 0,
          distraction: 0
        });
      });
    }

    entries.forEach((entry) => {
      const entryStart = Number(entry.start || entry.startTime || 0);
      const entryEnd = Number(entry.end || (entryStart + duration(entry)));
      if (!entryStart || !entryEnd || entryEnd <= entryStart) return;
      const cat = categoryKey(entry, () => entry.category || 'neutral');
      buckets.forEach((bucket) => {
        const overlap = Math.max(0, Math.min(entryEnd, bucket.end) - Math.max(entryStart, bucket.start));
        if (overlap > 0) bucket[cat] += overlap;
      });
    });

    return buckets;
  }

  function drawEmpty(ctx, width, height) {
    ctx.fillStyle = '#ffffff';
    ctx.font = '13px Share Tech Mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('No data yet', width / 2, height / 2);
  }

  function drawBar(canvas, slices, title) {
    const width = 560;
    const height = 300;
    const ctx = setupCanvas(canvas, width, height);
    if (!ctx) return;

    ctx.fillStyle = '#c8d6e5';
    ctx.font = '700 12px Orbitron, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(title, 18, 24);

    const active = slices.filter((slice) => slice.value > 0).slice(0, 10);
    if (!active.length) return drawEmpty(ctx, width, height);

    const max = Math.max(...active.map((slice) => slice.value));
    const barX = 178;
    const barMax = width - barX - 88;
    const rowH = Math.min(25, Math.floor((height - 58) / active.length));

    active.forEach((slice, index) => {
      const y = 48 + index * rowH;
      const widthValue = Math.max(3, (slice.value / max) * barMax);
      ctx.fillStyle = COLORS.text;
      ctx.font = '11px Share Tech Mono, monospace';
      ctx.textAlign = 'right';
      ctx.fillText(slice.label.slice(0, 24), barX - 12, y + 13);
      ctx.fillStyle = '#071018';
      ctx.fillRect(barX, y, barMax, 14);
      ctx.fillStyle = slice.color;
      ctx.fillRect(barX, y, widthValue, 14);
      ctx.fillStyle = COLORS.text;
      ctx.textAlign = 'left';
      ctx.fillText(formatMs(slice.value), barX + barMax + 10, y + 12);
    });
  }

  function drawPie(canvas, slices, title) {
    const size = 270;
    const ctx = setupCanvas(canvas, size, size);
    if (!ctx) return;

    const active = slices.filter((slice) => slice.value > 0);
    const total = sum(active);
    const cx = size / 2;
    const cy = size / 2 + 8;
    const radius = size * 0.34;

    ctx.fillStyle = '#c8d6e5';
    ctx.font = '700 12px Orbitron, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(title, cx, 20);

    if (!active.length) return drawEmpty(ctx, size, size);

    let start = -Math.PI / 2;
    active.forEach((slice) => {
      const angle = (slice.value / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, start, start + angle);
      ctx.closePath();
      ctx.fillStyle = slice.color;
      ctx.fill();
      ctx.strokeStyle = '#050608';
      ctx.lineWidth = 2;
      ctx.stroke();
      start += angle;
    });

    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = '#0a0e14';
    ctx.fill();

    const top = active[0];
    const pct = Math.round((top.value / total) * 100);
    ctx.fillStyle = COLORS.text;
    ctx.font = 'bold 17px Orbitron, sans-serif';
    ctx.fillText(pct + '%', cx, cy + 4);
    ctx.fillStyle = top.color;
    ctx.font = '10px Share Tech Mono, monospace';
    ctx.fillText(top.label.slice(0, 18), cx, cy + 22);
  }

  function drawLine(canvas, points, title) {
    const width = 620;
    const height = 300;
    const ctx = setupCanvas(canvas, width, height);
    if (!ctx) return;

    const series = [
      { key: 'productive', label: 'Productive', color: COLORS.productive },
      { key: 'neutral', label: 'Neutral', color: COLORS.neutral },
      { key: 'distraction', label: 'Distraction', color: COLORS.distraction }
    ];
    const max = Math.max(1, ...points.flatMap((point) => series.map((item) => point[item.key] || 0)));
    const left = 54;
    const right = 22;
    const top = 48;
    const bottom = 54;
    const chartWidth = width - left - right;
    const chartHeight = height - top - bottom;

    ctx.fillStyle = '#c8d6e5';
    ctx.font = '700 12px Orbitron, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(title, 18, 24);

    ctx.strokeStyle = COLORS.muted;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i += 1) {
      const y = top + (chartHeight / 4) * i;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(width - right, y);
      ctx.stroke();
    }

    series.forEach((item) => {
      ctx.strokeStyle = item.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      points.forEach((point, index) => {
        const x = left + (points.length <= 1 ? chartWidth / 2 : (chartWidth / (points.length - 1)) * index);
        const y = top + chartHeight - ((point[item.key] || 0) / max) * chartHeight;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      points.forEach((point, index) => {
        const x = left + (points.length <= 1 ? chartWidth / 2 : (chartWidth / (points.length - 1)) * index);
        const y = top + chartHeight - ((point[item.key] || 0) / max) * chartHeight;
        ctx.beginPath();
        ctx.arc(x, y, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = item.color;
        ctx.fill();
      });
    });

    const labelEvery = Math.max(1, Math.ceil(points.length / 8));
    points.forEach((point, index) => {
      if (index % labelEvery !== 0 && index !== points.length - 1) return;
      const x = left + (points.length <= 1 ? chartWidth / 2 : (chartWidth / (points.length - 1)) * index);
      ctx.fillStyle = COLORS.text;
      ctx.font = '10px Share Tech Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(point.label, x, height - 20);
    });
  }

  function listHTML(items, total) {
    if (!items.length || total <= 0) return '<p class="chart-legend-empty">No data in this range</p>';
    return items.map((item) => {
      const pct = Math.round((item.value / total) * 100);
      return `<div class="chart-detail-row">
        <div class="chart-detail-top">
          <span>${escapeHtml(item.label)}</span>
          <strong>${formatMs(item.value)} / ${pct}%</strong>
        </div>
        <div class="chart-contribution"><div style="width:${pct}%;background:${item.color}"></div></div>
      </div>`;
    }).join('');
  }

  function metricHTML(label, value, tone = '') {
    return `<div class="chart-metric ${tone}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>`;
  }

  function trend(points, key) {
    const values = points.map((point) => point[key] || 0);
    const first = values.find((value) => value > 0) || 0;
    const last = [...values].reverse().find((value) => value > 0) || 0;
    if (!first && !last) return 'No data';
    if (!first) return 'Up from 0';
    const pct = Math.round(((last - first) / first) * 100);
    if (pct === 0) return 'Flat';
    return (pct > 0 ? '+' : '') + pct + '%';
  }

  function renderChartsPanel(container, entries, getCategory, options = {}) {
    if (!container) return;

    const model = options.model || { entries, days: [] };
    const chartType = options.chartType || 'bar';
    const chartView = options.chartView || 'category';
    const breakdown = buildBreakdowns(entries, getCategory);
    const total = sum(breakdown.categories);
    const productiveTotal = sum(breakdown.productive);
    const neutralTotal = sum(breakdown.neutral);
    const distractionTotal = sum(breakdown.distraction);
    const line = makeLineBuckets(model, options.range || 'today');
    const chartSlices = chartView === 'detail' ? breakdown.detail : breakdown.categories;
    const topProductive = breakdown.productive[0];
    const topDistraction = breakdown.distraction[0];
    const topSubtask = breakdown.subtasks[0];
    const productivePct = total ? Math.round((productiveTotal / total) * 100) : 0;
    const distractionPct = total ? Math.round((distractionTotal / total) * 100) : 0;
    const rangeLabel = { today: 'Today', yesterday: 'Yesterday', week: 'This Week', month: 'This Month' }[options.range] || 'Today';

    container.innerHTML = `
      <p class="charts-summary">${rangeLabel} / ${chartType.toUpperCase()} / ${chartView === 'detail' ? 'Detailed Task View' : 'Category View'} / Total: <strong>${formatMs(total)}</strong></p>
      <div class="chart-metrics-grid">
        ${metricHTML('Top Productive Task', topProductive ? `${topProductive.label} (${formatMs(topProductive.value)})` : '--', 'productive')}
        ${metricHTML('Top Distraction', topDistraction ? `${topDistraction.label} (${formatMs(topDistraction.value)})` : '--', 'distraction')}
        ${metricHTML('Most Used Subtask', topSubtask ? `${topSubtask.label} (${formatMs(topSubtask.value)})` : '--')}
        ${metricHTML('Productive vs Distraction', `${productivePct}% / ${distractionPct}%`)}
        ${metricHTML('Daily Trend', trend(line, 'productive'), 'productive')}
        ${metricHTML('Weekly Trend', options.range === 'week' ? trend(line, 'productive') : 'Select week')}
        ${metricHTML('Monthly Trend', options.range === 'month' ? trend(line, 'productive') : 'Select month')}
      </div>
      <div class="charts-grid charts-grid-${chartType}">
        <div class="chart-card chart-card-wide">
          <h4>${chartView === 'detail' ? 'Detailed Task Contribution' : 'Category Contribution'}</h4>
          <canvas id="chartMain"></canvas>
          <div class="chart-legend">${listHTML(chartSlices, total)}</div>
        </div>
      </div>
      <div class="chart-breakdown-grid">
        <section class="chart-breakdown-card productive">
          <h4>Productive Analysis</h4>
          ${listHTML(breakdown.productive, productiveTotal)}
        </section>
        <section class="chart-breakdown-card neutral">
          <h4>Neutral Analysis</h4>
          ${listHTML(breakdown.neutral, neutralTotal)}
        </section>
        <section class="chart-breakdown-card distraction">
          <h4>Distraction Analysis</h4>
          ${listHTML(breakdown.distraction, distractionTotal)}
        </section>
      </div>`;

    if (chartType === 'pie') {
      drawPie(container.querySelector('#chartMain'), chartSlices, chartView === 'detail' ? 'TASK SHARE' : 'CATEGORY SHARE');
    } else if (chartType === 'line') {
      drawLine(container.querySelector('#chartMain'), line, 'TIME TREND');
    } else {
      drawBar(container.querySelector('#chartMain'), chartSlices, chartView === 'detail' ? 'TASK TOTALS' : 'CATEGORY TOTALS');
    }
  }

  global.LifeOSCharts = { renderChartsPanel, COLORS };
})(typeof window !== 'undefined' ? window : global);
