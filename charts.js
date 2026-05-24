/**
 * LIFE OS — Canvas chart helpers (vanilla JS)
 */
(function (global) {
  'use strict';

  const COLORS = {
    productive: '#00ff9d',
    study: '#00b4ff',
    neutral: '#8a9bab',
    distraction: '#ff3355',
    rest: '#ffaa00'
  };

  const PALETTE = ['#00ff9d', '#00b4ff', '#7dffcf', '#4de8ff', '#a6ff00', '#b478ff', '#ff78c8', '#ffaa00'];

  function sumEntries(entries) {
    return entries.reduce((s, e) => s + (e.durationMs || 0), 0);
  }

  function drawPie(canvas, slices, title) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const size = 220;
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    const total = slices.reduce((s, x) => s + x.value, 0);
    const cx = size / 2;
    const cy = size / 2 - 6;
    const r = size * 0.36;

    ctx.fillStyle = '#c8d6e5';
    ctx.font = '600 11px Orbitron, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(title, cx, 14);

    if (total <= 0) {
      ctx.fillStyle = '#5a6a7a';
      ctx.font = '12px monospace';
      ctx.fillText('No data yet', cx, cy);
      return;
    }

    let start = -Math.PI / 2;
    slices.forEach((sl) => {
      if (sl.value <= 0) return;
      const angle = (sl.value / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, start, start + angle);
      ctx.closePath();
      ctx.fillStyle = sl.color;
      ctx.fill();
      ctx.strokeStyle = '#050608';
      ctx.lineWidth = 2;
      ctx.stroke();
      start += angle;
    });

    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.42, 0, Math.PI * 2);
    ctx.fillStyle = '#0a0e14';
    ctx.fill();

    const top = slices.filter((s) => s.value > 0).sort((a, b) => b.value - a.value)[0];
    if (top) {
      const pct = Math.round((top.value / total) * 100);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 15px Orbitron, sans-serif';
      ctx.fillText(pct + '%', cx, cy + 4);
      ctx.fillStyle = top.color;
      ctx.font = '9px monospace';
      const lbl = top.label.length > 14 ? top.label.slice(0, 12) + '…' : top.label;
      ctx.fillText(lbl, cx, cy + 20);
    }
  }

  function legendHTML(slices, total) {
    if (!total) {
      return '<p class="chart-legend-empty">Log tasks to see percentages</p>';
    }
    return slices
      .filter((s) => s.value > 0)
      .sort((a, b) => b.value - a.value)
      .map((s) => {
        const pct = Math.round((s.value / total) * 100);
        return `<div class="chart-legend-item">
          <span class="chart-dot" style="background:${s.color}"></span>
          <span class="chart-legend-label">${s.label}</span>
          <span class="chart-pct">${pct}%</span>
        </div>`;
      })
      .join('');
  }

  function computeDrillDowns(entries, getCategory) {
    const productive = {};
    const study = {};
    const distraction = {};
    const neutral = {};

    entries.forEach((e) => {
      const cat = e.category || getCategory(e.main);
      const d = e.durationMs || 0;
      const label = e.sub ? `${e.main} > ${e.sub}` : e.main;

      if (cat === 'productive') {
        productive[e.main] = (productive[e.main] || 0) + d;
      } else if (cat === 'study') {
        const key = e.sub || e.main;
        study[key] = (study[key] || 0) + d;
      } else if (cat === 'distraction') {
        distraction[label] = (distraction[label] || 0) + d;
      } else if (cat === 'neutral') {
        neutral[e.main] = (neutral[e.main] || 0) + d;
      } else if (cat === 'rest') {
        neutral['Rest / ' + e.main] = (neutral['Rest / ' + e.main] || 0) + d;
      }
    });

    function toSlices(obj) {
      return Object.entries(obj)
        .sort((a, b) => b[1] - a[1])
        .map(([label, value], i) => ({
          label,
          value,
          color: PALETTE[i % PALETTE.length]
        }));
    }

    return {
      productive: toSlices(productive),
      study: toSlices(study),
      distraction: toSlices(distraction),
      neutral: toSlices(neutral)
    };
  }

  function renderChartsPanel(container, entries, getCategory) {
    if (!container) return;

    const total = sumEntries(entries);
    const byCat = { productive: 0, study: 0, neutral: 0, distraction: 0, rest: 0 };

    entries.forEach((e) => {
      const cat = e.category || getCategory(e.main);
      const d = e.durationMs || 0;
      if (cat === 'productive') byCat.productive += d;
      else if (cat === 'study') byCat.study += d;
      else if (cat === 'distraction') byCat.distraction += d;
      else if (cat === 'rest') byCat.rest += d;
      else byCat.neutral += d;
    });

    const mainSlices = [
      { label: 'Productive', value: byCat.productive, color: COLORS.productive },
      { label: 'Study', value: byCat.study, color: COLORS.study },
      { label: 'Neutral', value: byCat.neutral, color: COLORS.neutral },
      { label: 'Distraction', value: byCat.distraction, color: COLORS.distraction },
      { label: 'Rest', value: byCat.rest, color: COLORS.rest }
    ];

    const drill = computeDrillDowns(entries, getCategory);
    const prodTotal = sumEntries(drill.productive.map((s) => ({ durationMs: s.value })));
    const studyTotal = sumEntries(drill.study.map((s) => ({ durationMs: s.value })));
    const distTotal = sumEntries(drill.distraction.map((s) => ({ durationMs: s.value })));
    const neuTotal = sumEntries(drill.neutral.map((s) => ({ durationMs: s.value })));

    container.innerHTML = `
      <p class="charts-summary">Total tracked: <strong>${formatMs(total)}</strong> · ${entries.length} sessions</p>
      <div class="charts-grid">
        <div class="chart-card">
          <h4>Time by category (%)</h4>
          <canvas id="chartMain"></canvas>
          <div class="chart-legend" id="legendMain"></div>
        </div>
        <div class="chart-card">
          <h4>Inside Productive</h4>
          <canvas id="chartProductive"></canvas>
          <div class="chart-legend" id="legendProductive"></div>
        </div>
        <div class="chart-card">
          <h4>Study subtypes (%)</h4>
          <canvas id="chartStudy"></canvas>
          <div class="chart-legend" id="legendStudy"></div>
        </div>
        <div class="chart-card">
          <h4>Distraction detail (%)</h4>
          <canvas id="chartDistraction"></canvas>
          <div class="chart-legend" id="legendDistraction"></div>
        </div>
        <div class="chart-card">
          <h4>Neutral detail (%)</h4>
          <canvas id="chartNeutral"></canvas>
          <div class="chart-legend" id="legendNeutral"></div>
        </div>
      </div>`;

    drawPie(container.querySelector('#chartMain'), mainSlices, 'ALL CATEGORIES');
    container.querySelector('#legendMain').innerHTML = legendHTML(mainSlices, total);

    const prodSlices = drill.productive.length ? drill.productive : [{ label: 'No productive tasks', value: 0, color: '#333' }];
    drawPie(container.querySelector('#chartProductive'), prodSlices, 'PRODUCTIVE');
    container.querySelector('#legendProductive').innerHTML = legendHTML(prodSlices, prodTotal);

    const studySlices = drill.study.length ? drill.study : [{ label: 'No study logged', value: 0, color: '#333' }];
    drawPie(container.querySelector('#chartStudy'), studySlices, 'STUDY');
    container.querySelector('#legendStudy').innerHTML = legendHTML(studySlices, studyTotal);

    const distSlices = drill.distraction.length ? drill.distraction : [{ label: 'No distraction', value: 0, color: '#333' }];
    drawPie(container.querySelector('#chartDistraction'), distSlices, 'DISTRACTION');
    container.querySelector('#legendDistraction').innerHTML = legendHTML(distSlices, distTotal);

    const neuSlices = drill.neutral.length ? drill.neutral : [{ label: 'No neutral', value: 0, color: '#333' }];
    drawPie(container.querySelector('#chartNeutral'), neuSlices, 'NEUTRAL');
    container.querySelector('#legendNeutral').innerHTML = legendHTML(neuSlices, neuTotal);
  }

  function formatMs(ms) {
    const m = Math.floor(ms / 60000);
    const h = Math.floor(m / 60);
    const rm = m % 60;
    if (h > 0) return h + 'h ' + rm + 'm';
    if (m > 0) return m + 'm';
    return Math.floor(ms / 1000) + 's';
  }

  global.LifeOSCharts = { renderChartsPanel, COLORS };
})(typeof window !== 'undefined' ? window : global);
