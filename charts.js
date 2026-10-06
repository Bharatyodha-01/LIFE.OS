/**
 * LIFE OS - Layered analytics dashboard (vanilla JS)
 */
(function (global) {
  'use strict';

  const COLORS = {};
  ['productive', 'neutral', 'distraction', 'other', 'text', 'panel', 'deep', 'border', 'primary', 'secondary', 'warning', 'error'].forEach((key) => {
    Object.defineProperty(COLORS, key, { enumerable: true, get: () => getThemeColor(key) });
  });
  Object.defineProperty(COLORS, 'palette', { enumerable: true, get: () => getThemePalette() });
  function getThemeColor(key) {
    const fallback = { productive: '#1e7bff', neutral: '#00ff9d', distraction: '#ff3355', other: '#1a2a3a', text: '#ffffff', panel: '#0a0e14', deep: '#050608', border: '#1a2a3a', primary: '#00cc83', secondary: '#00b4ff', warning: '#ffaa00', error: '#ff3355' };
    try { return getComputedStyle(document.documentElement).getPropertyValue('--chart-' + key).trim() || fallback[key]; } catch (_) { return fallback[key]; }
  }
  function getThemePalette() {
    try {
      const style = getComputedStyle(document.documentElement);
      return Array.from({ length: 9 }, (_, index) => style.getPropertyValue('--chart-' + (index + 1)).trim()).filter(Boolean);
    } catch (_) { return ['#1e7bff', '#00ff9d', '#ff3355', '#ffaa00', '#fff23d', '#9f5cff', '#00e5ff', '#ff4fd8', '#ffffff']; }
  }

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

  function addTreeItem(tree, entry, value) {
    const main = entry.main || '--';
    const sub = entry.sub || 'No Subtask';
    if (!tree.has(main)) tree.set(main, { label: main, value: 0, subtasks: new Map() });
    const item = tree.get(main);
    item.value += value;
    addToMap(item.subtasks, sub, value);
  }

  function colorForIndex(index) {
    const palette = COLORS.palette;
    if (index < palette.length) return palette[index];
    const hue = Math.round((index * 137.508) % 360);
    return `hsl(${hue}, 96%, 58%)`;
  }

  function toSlices(map, limit, offset = 0) {
    const slices = [...map.values()]
      .filter((item) => item.value > 0)
      .sort((a, b) => b.value - a.value)
      .map((item, index) => ({ ...item, color: item.color || colorForIndex(index + offset) }));
    return limit ? slices.slice(0, limit) : slices;
  }

  function treeToItems(tree) {
    return [...tree.values()]
      .filter((item) => item.value > 0)
      .sort((a, b) => b.value - a.value)
      .map((item) => ({
        label: item.label,
        value: item.value,
        subtasks: toSlices(item.subtasks)
      }));
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
    const allActivities = new Map();
    const topByCategory = { productive: new Map(), neutral: new Map(), distraction: new Map() };
    const treeByCategory = { productive: new Map(), neutral: new Map(), distraction: new Map() };

    entries.forEach((entry) => {
      const d = duration(entry);
      if (!d) return;
      const cat = categoryKey(entry, getCategory);
      const taskLabel = entry.main || '--';

      categoryTotals[cat].value += d;
      addToMap(allActivities, detailLabel(entry), d);
      addToMap(topByCategory[cat], detailLabel(entry), d);
      addTreeItem(treeByCategory[cat], entry, d);

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
      productive: toSlices(productive),
      productiveSubtasks: toSlices(productiveSubtasks),
      neutral: toSlices(neutral),
      distraction: toSlices(distraction),
      topActivities: toSlices(allActivities, 5),
      topByCategory: {
        productive: toSlices(topByCategory.productive, 8),
        neutral: toSlices(topByCategory.neutral, 8),
        distraction: toSlices(topByCategory.distraction, 8)
      },
      treeByCategory: {
        productive: treeToItems(treeByCategory.productive),
        neutral: treeToItems(treeByCategory.neutral),
        distraction: treeToItems(treeByCategory.distraction)
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
      width: Math.max(240, Math.floor(rect.width || fallbackWidth)),
      height: Math.max(220, Math.floor(rect.height || fallbackHeight))
    };
  }

  function fitText(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let compact = text;
    while (compact.length > 4 && ctx.measureText(compact + '...').width > maxWidth) {
      compact = compact.slice(0, -1);
    }
    return compact.length > 4 ? compact + '...' : text.slice(0, 4);
  }

  function drawSliceLabels(ctx, slices, total, centerX, centerY, radius, options) {
    const labels = [];
    let start = -Math.PI / 2;
    slices.forEach((slice) => {
      const angle = (slice.value / total) * Math.PI * 2;
      const mid = start + angle / 2;
      const side = Math.cos(mid) >= 0 ? 1 : -1;
      labels.push({
        slice,
        pct: Math.round((slice.value / total) * 100),
        angle: mid,
        side,
        x: centerX + Math.cos(mid) * (radius + 12),
        y: centerY + Math.sin(mid) * (radius + 12),
        lineX: centerX + Math.cos(mid) * radius,
        lineY: centerY + Math.sin(mid) * radius
      });
      start += angle;
    });

    [-1, 1].forEach((side) => {
      const sideLabels = labels.filter((label) => label.side === side).sort((a, b) => a.y - b.y);
      const gap = options.overview ? 30 : 24;
      const top = centerY - radius - 8;
      const bottom = centerY + radius + 8;
      sideLabels.forEach((label, index) => {
        if (index > 0 && label.y < sideLabels[index - 1].y + gap) {
          label.y = sideLabels[index - 1].y + gap;
        }
      });
      for (let index = sideLabels.length - 1; index >= 0; index--) {
        if (sideLabels[index].y > bottom) sideLabels[index].y = bottom;
        if (index > 0 && sideLabels[index - 1].y > sideLabels[index].y - gap) {
          sideLabels[index - 1].y = sideLabels[index].y - gap;
        }
      }
      sideLabels.forEach((label) => {
        if (label.y < top) label.y = top;
      });
    });

    const fontSize = options.overview ? 13 : 11;
    ctx.font = `800 ${fontSize}px Share Tech Mono, monospace`;
    ctx.textBaseline = 'middle';
    labels.forEach((label) => {
      const outerOffset = options.overview ? 58 : 46;
      const safeEdge = options.overview ? 16 : 12;
      const naturalEndX = centerX + label.side * (radius + outerOffset);
      const endX = label.side === 1
        ? Math.min(naturalEndX, options.width - safeEdge)
        : Math.max(naturalEndX, safeEdge);
      const kneeX = centerX + label.side * Math.max(radius + 16, Math.abs(endX - centerX) - 18);
      const textX = label.side === 1 ? endX + 7 : safeEdge;
      const maxText = options.overview ? 78 : 60;
      const text = `${fitText(ctx, label.slice.label, maxText)} ${label.pct}%`;

      ctx.beginPath();
      ctx.moveTo(label.lineX, label.lineY);
      ctx.lineTo(kneeX, label.y);
      ctx.lineTo(endX, label.y);
      ctx.strokeStyle = label.slice.color;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = COLORS.text;
      ctx.textAlign = 'left';
      ctx.fillText(text, textX, label.y);
    });
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
    const maxLabelSpace = overview ? 110 : 78;
    const labelSpace = options.showLabels
      ? Math.min(maxLabelSpace, Math.max(58, (size.width - 210) / 2))
      : 0;
    const cx = size.width / 2;
    const cy = size.height / 2 + 3;
    const radius = Math.max(58, Math.min((size.width - labelSpace * 2) / 2, size.height / 2, large ? 220 : overview ? 148 : 94) - 12);
    let start = -Math.PI / 2;

    active.forEach((slice) => {
      const angle = (slice.value / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, start, start + angle);
      ctx.closePath();
      ctx.fillStyle = slice.color;
      ctx.fill();
      ctx.strokeStyle = COLORS.deep;
      ctx.lineWidth = large ? 4 : 2;
      ctx.stroke();
      start += angle;
    });

    if (options.showLabels) {
      drawSliceLabels(ctx, active, total, cx, cy, radius, { overview, width: size.width });
    }

    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.panel;
    ctx.fill();
    ctx.strokeStyle = COLORS.border;
    ctx.lineWidth = 2;
    ctx.stroke();

    const centerPct = typeof options.centerPct === 'number'
      ? options.centerPct
      : Math.round((active[0].value / total) * 100);
    const centerValue = options.centerText || (centerPct + '%');
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 ${large ? 48 : overview ? 32 : 28}px Orbitron, sans-serif`;
    ctx.fillText(centerValue, cx, cy - (large ? 10 : 5));
    ctx.fillStyle = options.centerColor || active[0].color;
    ctx.font = `700 ${large ? 21 : overview ? 15 : 12}px Share Tech Mono, monospace`;
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

  function topActivitiesHTML(items, total) {
    if (!items.length || total <= 0) {
      return '<p class="chart-empty-text chart-empty-compact">No activity data in this range</p>';
    }
    return items.slice(0, 5).map((item, index) => {
      const pct = Math.round((item.value / total) * 100);
      return `<div class="chart-top-row">
        <span class="chart-top-rank">#${index + 1}</span>
        <span class="chart-dot" style="background:${item.color}"></span>
        <span class="chart-top-name">${escapeHtml(item.label)}</span>
        <strong>${formatMs(item.value)}</strong>
        <em>${pct}%</em>
      </div>`;
    }).join('');
  }

  function topActivitiesPanelHTML(items, total) {
    return `<section class="chart-top-panel">
      <div class="chart-card-head">
        <div>
          <h3>Top Activities</h3>
          <span>Highest time sinks</span>
        </div>
      </div>
      <div class="chart-top-list">${topActivitiesHTML(items, total)}</div>
    </section>`;
  }

  function categoryCardHTML(key, title, category, total) {
    const pct = total ? Math.round((category.value / total) * 100) : 0;
    const topItems = currentModel.breakdown.topByCategory[key] || [];
    return `<section class="chart-card chart-card-${key}">
      <div class="chart-card-head">
        <div>
          <h3>${escapeHtml(title)}</h3>
          <span>${formatMs(category.value)} | ${pct}%</span>
        </div>
        <button class="chart-expand-btn" data-detail-category="${key}" type="button">Detailed Analysis &rarr;</button>
      </div>
      <div class="chart-card-body chart-card-body-summary">
        <canvas id="chart${title}" class="chart-pie-canvas" aria-label="${escapeHtml(title)} summary pie chart"></canvas>
        <div class="chart-category-detail">
          <div class="chart-summary-stat">
            <strong>${pct}%</strong>
            <span>${formatMs(category.value)}</span>
          </div>
          <div class="chart-card-top">
            <h4>Top Tasks:</h4>
            ${topActivitiesHTML(topItems.slice(0, 3), category.value)}
          </div>
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

  function taskTreeHTML(items, total) {
    if (!items.length || total <= 0) return '<p class="chart-empty-text">No task distribution in this range</p>';
    return `<div class="chart-task-tree">
      ${items.map((item) => {
        const pct = Math.round((item.value / total) * 100);
        const subtasks = item.subtasks && item.subtasks.length ? item.subtasks : [{ label: 'No Subtask', value: item.value }];
        return `<div class="chart-tree-group">
          <div class="chart-tree-parent">
            <span>${escapeHtml(item.label)}</span>
            <strong>${formatMs(item.value)} | ${pct}%</strong>
          </div>
          <div class="chart-tree-children">
            ${subtasks.map((subtask) => {
              const subPct = Math.round((subtask.value / total) * 100);
              return `<div class="chart-tree-child">
                <span>${escapeHtml(subtask.label)}</span>
                <strong>${formatMs(subtask.value)} | ${subPct}%</strong>
              </div>`;
            }).join('')}
          </div>
        </div>`;
      }).join('')}
    </div>`;
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
    const treeItems = currentModel.breakdown.treeByCategory[category] || [];
    const topTotal = sum(topItems);
    title.textContent = config.title;
    total.textContent = `Total: ${formatMs(config.total)}`;
    content.innerHTML = `
      ${detailSectionHTML('chartDetailMain', config.mainTitle, config.mainItems, config.total, config.empty)}
      <section class="chart-detail-section">
        <div class="chart-detail-section-head">
          <h4>Actual Task Distribution</h4>
          <span>${formatMs(config.total)}</span>
        </div>
        ${taskTreeHTML(treeItems, config.total)}
      </section>
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
        <div class="charts-top-grid">
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
          ${topActivitiesPanelHTML(breakdown.topActivities, total)}
        </div>
        <div class="charts-category-row">
          ${categoryCardHTML('productive', 'Productive', breakdown.categoryTotals.productive, total)}
          ${categoryCardHTML('neutral', 'Neutral', breakdown.categoryTotals.neutral, total)}
          ${categoryCardHTML('distraction', 'Distraction', breakdown.categoryTotals.distraction, total)}
        </div>
      </div>
      ${detailOverlayHTML()}`;

    bindDetailControls(container);
    requestAnimationFrame(() => {
      drawPie(container.querySelector('#chartOverall'), breakdown.categories, {
        overview: true,
        showLabels: true,
        centerText: 'Total',
        centerLabel: formatMs(total),
        emptyMessage: 'No data in this range'
      });
      drawPie(container.querySelector('#chartProductive'), breakdown.topByCategory.productive, {
        centerPct: total ? Math.round((productiveTotal / total) * 100) : 0,
        centerLabel: 'Productive',
        centerColor: COLORS.productive,
        emptyMessage: 'No productive data in this range'
      });
      drawPie(container.querySelector('#chartNeutral'), breakdown.topByCategory.neutral, {
        centerPct: total ? Math.round((neutralTotal / total) * 100) : 0,
        centerLabel: 'Neutral',
        centerColor: COLORS.neutral,
        emptyMessage: 'No neutral data in this range'
      });
      drawPie(container.querySelector('#chartDistraction'), breakdown.topByCategory.distraction, {
        centerPct: total ? Math.round((distractionTotal / total) * 100) : 0,
        centerLabel: 'Distraction',
        centerColor: COLORS.distraction,
        emptyMessage: 'No distraction data in this range'
      });
    });
  }

  global.LifeOSCharts = { renderChartsPanel, COLORS, getThemeColor };
})(typeof window !== 'undefined' ? window : global);
