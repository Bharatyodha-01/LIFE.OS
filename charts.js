/**
 * LIFE OS - Layered analytics dashboard (vanilla JS)
 */
(function (global) {
  'use strict';

  const COLORS = {
    productive: '#1e7bff',
    neutral: '#00ff9d',
    distraction: '#ff3355',
    other: '#1a2a3a',
    text: '#ffffff'
  };

  const PRODUCTIVE_PALETTE = ['#1e7bff', '#00b4ff', '#6fb0ff', '#3d7cff', '#35d5ff', '#9f8cff', '#2de2e6', '#78a8ff'];
  const SUBTASK_PALETTE = ['#00b4ff', '#6fb0ff', '#1e7bff', '#36ffc0', '#9f8cff', '#ffaa00', '#4c9bff', '#b8ff7a'];
  const NEUTRAL_PALETTE = ['#00ff9d', '#36ffc0', '#7dffcf', '#00cc7d', '#b8ff7a', '#4ee8a7', '#94ffd8', '#18d68a'];
  const DISTRACTION_PALETTE = ['#ff3355', '#ff5f78', '#ff8296', '#d92040', '#ff1744', '#ff6b35', '#ff9a8a', '#c9184a'];
  const TOP_PALETTE = ['#ffaa00', '#1e7bff', '#00ff9d', '#ff3355', '#00b4ff', '#9f8cff', '#36ffc0', '#ff8296'];

  let currentModel = null;

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

  function detailLabel(entry) {
    return entry.sub ? `${entry.main} > ${entry.sub}` : entry.main || '--';
  }

  function sum(items) {
    return items.reduce((total, item) => total + item.value, 0);
  }

  function addToMap(map, key, value) {
    if (!key || !value) return;
    if (!map.has(key)) map.set(key, { label: key, value: 0 });
    map.get(key).value += value;
  }

  function toSlices(map, palette, limit) {
    const slices = [...map.values()]
      .filter((item) => item.value > 0)
      .sort((a, b) => b.value - a.value)
      .map((item, index) => ({ ...item, color: item.color || palette[index % palette.length] }));
    return limit ? slices.slice(0, limit) : slices;
  }

  function buildBreakdowns(entries, getCategory) {
    const categoryTotals = {
      productive: { label: 'Productive', value: 0, color: COLORS.productive },
      neutral: { label: 'Neutral', value: 0, color: COLORS.neutral },
      distraction: { label: 'Distraction', value: 0, color: COLORS.distraction }
    };
    const productive = new Map();
    const productiveSubtasks = new Map();
    const neutral = new Map();
    const distraction = new Map();
    const topByCategory = { productive: new Map(), neutral: new Map(), distraction: new Map() };

    entries.forEach((entry) => {
      const d = duration(entry);
      if (!d) return;
      const cat = categoryKey(entry, getCategory);
      const taskLabel = entry.main || '--';

      categoryTotals[cat].value += d;
      addToMap(topByCategory[cat], detailLabel(entry), d);

      if (cat === 'productive') {
        addToMap(productive, taskLabel, d);
        if (entry.sub) addToMap(productiveSubtasks, entry.sub, d);
      } else if (cat === 'distraction') {
        addToMap(distraction, taskLabel, d);
      } else {
        addToMap(neutral, taskLabel, d);
      }
    });

    return {
      categories: [categoryTotals.productive, categoryTotals.neutral, categoryTotals.distraction],
      categoryTotals,
      productive: toSlices(productive, PRODUCTIVE_PALETTE),
      productiveSubtasks: toSlices(productiveSubtasks, SUBTASK_PALETTE),
      neutral: toSlices(neutral, NEUTRAL_PALETTE),
      distraction: toSlices(distraction, DISTRACTION_PALETTE),
      topByCategory: {
        productive: toSlices(topByCategory.productive, TOP_PALETTE, 8),
        neutral: toSlices(topByCategory.neutral, TOP_PALETTE, 8),
        distraction: toSlices(topByCategory.distraction, TOP_PALETTE, 8)
      }
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

  function canvasSize(canvas, fallbackWidth, fallbackHeight) {
    const rect = canvas.getBoundingClientRect();
    return {
      width: Math.max(220, Math.floor(rect.width || fallbackWidth)),
      height: Math.max(180, Math.floor(rect.height || fallbackHeight))
    };
  }

  function drawEmpty(canvas, message, large) {
    const size = canvasSize(canvas, large ? 720 : 300, large ? 500 : 210);
    const ctx = setupCanvas(canvas, size.width, size.height);
    if (!ctx) return;
    ctx.fillStyle = COLORS.text;
    ctx.font = `700 ${large ? 24 : 15}px Share Tech Mono, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(message || 'No data in this range', size.width / 2, size.height / 2);
  }

  function drawPie(canvas, slices, options = {}) {
    if (!canvas) return;
    const active = slices.filter((slice) => slice.value > 0);
    if (!active.length) return drawEmpty(canvas, options.emptyMessage, options.large);

    const large = Boolean(options.large);
    const overview = Boolean(options.overview);
    const size = canvasSize(canvas, large ? 780 : 360, large ? 540 : overview ? 300 : 210);
    const ctx = setupCanvas(canvas, size.width, size.height);
    if (!ctx) return;

    const total = sum(active);
    const cx = size.width / 2;
    const cy = size.height / 2 + 3;
    const radius = Math.min(size.width * 0.3, size.height * 0.38, large ? 205 : overview ? 118 : 78);
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
      ctx.lineWidth = large ? 4 : 2;
      ctx.stroke();
      start += angle;
    });

    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = '#0a0e14';
    ctx.fill();
    ctx.strokeStyle = '#1a2a3a';
    ctx.lineWidth = 2;
    ctx.stroke();

    const centerPct = typeof options.centerPct === 'number'
      ? options.centerPct
      : Math.round((active[0].value / total) * 100);
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 ${large ? 42 : overview ? 34 : 24}px Orbitron, sans-serif`;
    ctx.fillText(centerPct + '%', cx, cy - (large ? 10 : 5));
    ctx.fillStyle = options.centerColor || active[0].color;
    ctx.font = `700 ${large ? 18 : overview ? 14 : 11}px Share Tech Mono, monospace`;
    ctx.fillText((options.centerLabel || active[0].label).slice(0, large ? 26 : 18), cx, cy + (large ? 30 : overview ? 24 : 18));
  }

  function legendHTML(items, total, compact = true) {
    if (!items.length || total <= 0) return '';
    const visible = compact ? items.slice(0, 4) : items;
    const hiddenCount = Math.max(0, items.length - visible.length);
    return visible.map((item) => {
      const pct = Math.round((item.value / total) * 100);
      return `<div class="chart-legend-item">
        <span class="chart-dot" style="background:${item.color}"></span>
        <span class="chart-legend-label">${escapeHtml(item.label)}</span>
        <strong>${pct}% (${formatMs(item.value)})</strong>
      </div>`;
    }).join('') + (hiddenCount ? `<div class="chart-legend-more">+${hiddenCount} more</div>` : '');
  }

  function summarySlices(category, value, total) {
    return [
      { label: category.label, value, color: category.color },
      { label: 'Other', value: Math.max(0, total - value), color: COLORS.other }
    ];
  }

  function categoryCardHTML(key, title, category, total) {
    const pct = total ? Math.round((category.value / total) * 100) : 0;
    return `<section class="chart-card chart-card-${key}">
      <div class="chart-card-head">
        <div>
          <h3>${escapeHtml(title)}</h3>
          <span>${formatMs(category.value)} / ${pct}%</span>
        </div>
        <button class="chart-expand-btn" data-detail-category="${key}" type="button">Detailed Analysis &rarr;</button>
      </div>
      <div class="chart-card-body chart-card-body-summary">
        <canvas id="chart${title}" class="chart-pie-canvas" aria-label="${escapeHtml(title)} summary pie chart"></canvas>
        <div class="chart-summary-stat">
          <strong>${pct}%</strong>
          <span>${formatMs(category.value)}</span>
        </div>
      </div>
    </section>`;
  }

  function detailOverlayHTML() {
    return `<div class="chart-detail-overlay hidden" id="chartDetailOverlay" aria-hidden="true">
      <div class="chart-detail-modal">
        <div class="chart-detail-head">
          <div>
            <h3 id="chartDetailTitle">Detailed Analysis</h3>
            <span id="chartDetailTotal">--</span>
          </div>
          <button class="btn-close" id="chartDetailClose" type="button">&times;</button>
        </div>
        <div class="chart-detail-content" id="chartDetailContent"></div>
      </div>
    </div>`;
  }

  function detailSectionHTML(id, title, items, total, emptyMessage) {
    const hasData = items.length && total > 0;
    return `<section class="chart-detail-section">
      <div class="chart-detail-section-head">
        <h4>${escapeHtml(title)}</h4>
        <span>${hasData ? formatMs(total) : '--'}</span>
      </div>
      ${hasData ? `
        <div class="chart-detail-grid">
          <canvas id="${id}" class="chart-detail-canvas" aria-label="${escapeHtml(title)} pie chart"></canvas>
          <div class="chart-legend chart-detail-legend">${legendHTML(items, total, false)}</div>
        </div>` : `<p class="chart-empty-text">${escapeHtml(emptyMessage)}</p>`}
    </section>`;
  }

  function closeDetail(container) {
    const overlay = container.querySelector('#chartDetailOverlay');
    if (!overlay) return;
    overlay.classList.add('hidden');
    overlay.setAttribute('aria-hidden', 'true');
  }

  function openDetail(container, category) {
    if (!currentModel) return;
    const config = {
      productive: {
        title: 'Productive Detailed Analysis',
        total: currentModel.productiveTotal,
        mainItems: currentModel.breakdown.productive,
        mainTitle: 'Productive Activities',
        empty: 'No productive data in this range'
      },
      neutral: {
        title: 'Neutral Detailed Analysis',
        total: currentModel.neutralTotal,
        mainItems: currentModel.breakdown.neutral,
        mainTitle: 'Neutral Activities',
        empty: 'No neutral data in this range'
      },
      distraction: {
        title: 'Distraction Detailed Analysis',
        total: currentModel.distractionTotal,
        mainItems: currentModel.breakdown.distraction,
        mainTitle: 'Distraction Activities',
        empty: 'No distraction data in this range'
      }
    }[category];
    if (!config) return;

    const overlay = container.querySelector('#chartDetailOverlay');
    const title = container.querySelector('#chartDetailTitle');
    const total = container.querySelector('#chartDetailTotal');
    const content = container.querySelector('#chartDetailContent');
    if (!overlay || !title || !total || !content) return;

    const topItems = currentModel.breakdown.topByCategory[category] || [];
    const topTotal = sum(topItems);
    title.textContent = config.title;
    total.textContent = `Total: ${formatMs(config.total)}`;
    content.innerHTML = `
      ${detailSectionHTML('chartDetailMain', config.mainTitle, config.mainItems, config.total, config.empty)}
      ${category === 'productive' ? detailSectionHTML('chartDetailSubtasks', 'Subtask Breakdown', currentModel.breakdown.productiveSubtasks, currentModel.subtaskTotal, 'No sub-task data available.') : ''}
      ${detailSectionHTML('chartDetailTop', 'Top Activities', topItems, topTotal, 'No activity data in this range')}`;

    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => {
      drawPie(container.querySelector('#chartDetailMain'), config.mainItems, { large: true, emptyMessage: config.empty });
      if (category === 'productive') {
        drawPie(container.querySelector('#chartDetailSubtasks'), currentModel.breakdown.productiveSubtasks, { large: true, emptyMessage: 'No sub-task data available.' });
      }
      drawPie(container.querySelector('#chartDetailTop'), topItems, { large: true, emptyMessage: 'No activity data in this range' });
    });
  }

  function bindDetailControls(container) {
    container.querySelectorAll('[data-detail-category]').forEach((button) => {
      button.addEventListener('click', () => openDetail(container, button.dataset.detailCategory));
    });
    const close = container.querySelector('#chartDetailClose');
    if (close) close.addEventListener('click', () => closeDetail(container));
    const overlay = container.querySelector('#chartDetailOverlay');
    if (overlay) {
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) closeDetail(container);
      });
    }
  }

  function renderChartsPanel(container, entries, getCategory, options = {}) {
    if (!container) return;

    const breakdown = buildBreakdowns(entries || [], getCategory);
    const total = sum(breakdown.categories);
    const productiveTotal = breakdown.categoryTotals.productive.value;
    const neutralTotal = breakdown.categoryTotals.neutral.value;
    const distractionTotal = breakdown.categoryTotals.distraction.value;
    const subtaskTotal = sum(breakdown.productiveSubtasks);
    const rangeLabel = { today: 'Today', yesterday: 'Yesterday', week: 'This Week', month: 'This Month' }[options.range] || 'Today';

    currentModel = { breakdown, total, productiveTotal, neutralTotal, distractionTotal, subtaskTotal };

    container.innerHTML = `
      <div class="charts-period-title">
        <span>${escapeHtml(rangeLabel)}</span>
        <strong>Total Logged: ${formatMs(total)}</strong>
      </div>
      <div class="charts-hub-layout">
        <section class="chart-overview-card">
          <div class="chart-card-head chart-overview-head">
            <div>
              <h3>Overall Time Distribution</h3>
              <span>${formatMs(total)}</span>
            </div>
          </div>
          <div class="chart-overview-body">
            <canvas id="chartOverall" class="chart-overview-canvas" aria-label="Overall time distribution pie chart"></canvas>
            <div class="chart-legend chart-overview-legend">${legendHTML(breakdown.categories, total, false)}</div>
          </div>
        </section>
        <div class="charts-category-row">
          ${categoryCardHTML('productive', 'Productive', breakdown.categoryTotals.productive, total)}
          ${categoryCardHTML('neutral', 'Neutral', breakdown.categoryTotals.neutral, total)}
          ${categoryCardHTML('distraction', 'Distraction', breakdown.categoryTotals.distraction, total)}
        </div>
      </div>
      ${detailOverlayHTML()}`;

    bindDetailControls(container);
    requestAnimationFrame(() => {
      drawPie(container.querySelector('#chartOverall'), breakdown.categories, { overview: true, emptyMessage: 'No data in this range' });
      drawPie(container.querySelector('#chartProductive'), summarySlices(breakdown.categoryTotals.productive, productiveTotal, total), {
        centerPct: total ? Math.round((productiveTotal / total) * 100) : 0,
        centerLabel: 'Productive',
        centerColor: COLORS.productive,
        emptyMessage: 'No productive data in this range'
      });
      drawPie(container.querySelector('#chartNeutral'), summarySlices(breakdown.categoryTotals.neutral, neutralTotal, total), {
        centerPct: total ? Math.round((neutralTotal / total) * 100) : 0,
        centerLabel: 'Neutral',
        centerColor: COLORS.neutral,
        emptyMessage: 'No neutral data in this range'
      });
      drawPie(container.querySelector('#chartDistraction'), summarySlices(breakdown.categoryTotals.distraction, distractionTotal, total), {
        centerPct: total ? Math.round((distractionTotal / total) * 100) : 0,
        centerLabel: 'Distraction',
        centerColor: COLORS.distraction,
        emptyMessage: 'No distraction data in this range'
      });
    });
  }

  global.LifeOSCharts = { renderChartsPanel, COLORS };
})(typeof window !== 'undefined' ? window : global);
