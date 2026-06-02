/**
 * LIFE OS - Full-screen pie analytics (vanilla JS)
 */
(function (global) {
  'use strict';

  const COLORS = {
    productive: '#1e7bff',
    neutral: '#00ff9d',
    distraction: '#ff3355',
    text: '#ffffff'
  };

  const PRODUCTIVE_PALETTE = ['#1e7bff', '#00b4ff', '#6fb0ff', '#3d7cff', '#35d5ff', '#9f8cff', '#2de2e6', '#78a8ff'];
  const SUBTASK_PALETTE = ['#00b4ff', '#6fb0ff', '#1e7bff', '#36ffc0', '#9f8cff', '#ffaa00', '#4c9bff', '#b8ff7a'];
  const NEUTRAL_PALETTE = ['#00ff9d', '#36ffc0', '#7dffcf', '#00cc7d', '#b8ff7a', '#4ee8a7', '#94ffd8', '#18d68a'];
  const DISTRACTION_PALETTE = ['#ff3355', '#ff5f78', '#ff8296', '#d92040', '#ff1744', '#ff6b35', '#ff9a8a', '#c9184a'];

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

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    })[ch]);
  }

  function categoryKey(entry, getCategory) {
    const cat = entry.category || getCategory(entry.main);
    if (cat === 'distraction') return 'distraction';
    if (cat === 'productive' || cat === 'study') return 'productive';
    return 'neutral';
  }

  function sum(items) {
    return items.reduce((total, item) => total + item.value, 0);
  }

  function addToMap(map, key, value) {
    if (!key || !value) return;
    if (!map.has(key)) map.set(key, { label: key, value: 0 });
    map.get(key).value += value;
  }

  function toSlices(map, palette) {
    return [...map.values()]
      .filter((item) => item.value > 0)
      .sort((a, b) => b.value - a.value)
      .map((item, index) => ({
        ...item,
        color: item.color || palette[index % palette.length]
      }));
  }

  function buildBreakdowns(entries, getCategory) {
    const categories = new Map([
      ['Productive', { label: 'Productive', value: 0, color: COLORS.productive }],
      ['Neutral', { label: 'Neutral', value: 0, color: COLORS.neutral }],
      ['Distraction', { label: 'Distraction', value: 0, color: COLORS.distraction }]
    ]);
    const productive = new Map();
    const productiveSubtasks = new Map();
    const neutral = new Map();
    const distraction = new Map();

    entries.forEach((entry) => {
      const d = duration(entry);
      if (!d) return;
      const cat = categoryKey(entry, getCategory);
      const taskLabel = entry.main || '--';

      if (cat === 'productive') {
        categories.get('Productive').value += d;
        addToMap(productive, taskLabel, d);
        if (entry.sub) addToMap(productiveSubtasks, entry.sub, d);
        return;
      }

      if (cat === 'distraction') {
        categories.get('Distraction').value += d;
        addToMap(distraction, taskLabel, d);
        return;
      }

      categories.get('Neutral').value += d;
      addToMap(neutral, taskLabel, d);
    });

    return {
      categories: [...categories.values()],
      productive: toSlices(productive, PRODUCTIVE_PALETTE),
      productiveSubtasks: toSlices(productiveSubtasks, SUBTASK_PALETTE),
      neutral: toSlices(neutral, NEUTRAL_PALETTE),
      distraction: toSlices(distraction, DISTRACTION_PALETTE)
    };
  }

  function setupCanvas(canvas, width, height) {
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = '100%';
    canvas.style.height = height + 'px';
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    return ctx;
  }

  function drawEmpty(canvas) {
    const width = Math.max(320, Math.floor(canvas.getBoundingClientRect().width || 760));
    const height = Math.max(360, Math.floor(canvas.getBoundingClientRect().height || 460));
    const ctx = setupCanvas(canvas, width, height);
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 22px Share Tech Mono, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('No data in this range', width / 2, height / 2);
  }

  function drawPie(canvas, slices) {
    if (!canvas) return;
    const active = slices.filter((slice) => slice.value > 0);
    if (!active.length) return drawEmpty(canvas);

    const width = Math.max(320, Math.floor(canvas.getBoundingClientRect().width || 760));
    const height = Math.max(380, Math.floor(canvas.getBoundingClientRect().height || 520));
    const ctx = setupCanvas(canvas, width, height);
    if (!ctx) return;

    const total = sum(active);
    const cx = width / 2;
    const cy = height / 2 + 6;
    const radius = Math.min(width * 0.27, height * 0.36, 190);
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
      ctx.lineWidth = 4;
      ctx.stroke();
      start += angle;
    });

    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.43, 0, Math.PI * 2);
    ctx.fillStyle = '#0a0e14';
    ctx.fill();
    ctx.strokeStyle = '#1a2a3a';
    ctx.lineWidth = 2;
    ctx.stroke();

    const top = active[0];
    const pct = Math.round((top.value / total) * 100);
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 38px Orbitron, sans-serif';
    ctx.fillText(pct + '%', cx, cy - 8);
    ctx.fillStyle = top.color;
    ctx.font = '700 17px Share Tech Mono, monospace';
    ctx.fillText(top.label.slice(0, 22), cx, cy + 28);
  }

  function legendHTML(items, total) {
    if (!items.length || total <= 0) return '<p class="chart-empty-text">No data in this range</p>';
    return items.map((item) => {
      const pct = Math.round((item.value / total) * 100);
      return `<div class="chart-legend-item">
        <span class="chart-dot" style="background:${item.color}"></span>
        <span class="chart-legend-label">${escapeHtml(item.label)}</span>
        <strong>${pct}% (${formatMs(item.value)})</strong>
      </div>`;
    }).join('');
  }

  function sectionHTML(id, title, items, total, tone, emptyMessage) {
    const hasData = items.length && total > 0;
    return `<section class="chart-section chart-section-${tone}">
      <div class="chart-section-heading">
        <h3>${escapeHtml(title)}</h3>
        <span>${hasData ? formatMs(total) : '--'}</span>
      </div>
      ${hasData ? `
        <div class="chart-pie-layout">
          <canvas id="${id}" class="chart-pie-canvas" aria-label="${escapeHtml(title)} pie chart"></canvas>
          <div class="chart-legend">${legendHTML(items, total)}</div>
        </div>` : `<p class="chart-empty-text">${escapeHtml(emptyMessage || 'No data in this range')}</p>`}
    </section>`;
  }

  function renderChartsPanel(container, entries, getCategory, options = {}) {
    if (!container) return;

    const breakdown = buildBreakdowns(entries || [], getCategory);
    const total = sum(breakdown.categories);
    const productiveTotal = sum(breakdown.productive);
    const subtaskTotal = sum(breakdown.productiveSubtasks);
    const neutralTotal = sum(breakdown.neutral);
    const distractionTotal = sum(breakdown.distraction);
    const rangeLabel = { today: 'Today', yesterday: 'Yesterday', week: 'This Week', month: 'This Month' }[options.range] || 'Today';

    container.innerHTML = `
      <div class="charts-period-title">
        <span>${escapeHtml(rangeLabel)}</span>
        <strong>Total Logged: ${formatMs(total)}</strong>
      </div>
      <div class="charts-vertical">
        ${sectionHTML('chartTimeDistribution', 'Time Distribution', breakdown.categories, total, 'distribution')}
        ${sectionHTML('chartProductive', 'Productive Breakdown', breakdown.productive, productiveTotal, 'productive')}
        ${sectionHTML('chartProductiveSubtasks', 'Productive Subtask Breakdown', breakdown.productiveSubtasks, subtaskTotal, 'subtasks', 'No sub-task data available for this period.')}
        ${sectionHTML('chartNeutral', 'Neutral Breakdown', breakdown.neutral, neutralTotal, 'neutral')}
        ${sectionHTML('chartDistraction', 'Distraction Breakdown', breakdown.distraction, distractionTotal, 'distraction')}
      </div>`;

    requestAnimationFrame(() => {
      drawPie(container.querySelector('#chartTimeDistribution'), breakdown.categories);
      drawPie(container.querySelector('#chartProductive'), breakdown.productive);
      drawPie(container.querySelector('#chartProductiveSubtasks'), breakdown.productiveSubtasks);
      drawPie(container.querySelector('#chartNeutral'), breakdown.neutral);
      drawPie(container.querySelector('#chartDistraction'), breakdown.distraction);
    });
  }

  global.LifeOSCharts = { renderChartsPanel, COLORS };
})(typeof window !== 'undefined' ? window : global);
