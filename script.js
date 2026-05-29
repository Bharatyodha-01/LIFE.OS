/**
 * LIFE-OS — Real-Time Activity Tracking System
 * =============================================
 * A keyboard-driven life operating system that tracks activities in real time.
 *
 * Architecture:
 * - State: current task, subtask wait mode, mappings
 * - Storage: localStorage (7-day rolling window)
 * - Engine: key handler → task switch → timeline → analytics
 * - UI: live timer, timeline, analytics panels
 */

(function () {
  'use strict';

  // ─── Constants ───────────────────────────────────────────────
  const STORAGE_PREFIX = 'lifeos_';
  const RETENTION_DAYS = 90;
  const LAUNCH_SPLASH_KEY = 'lifeos_launch_splash_seen';

  const DEFAULT_PREFS = {
    subtaskWaitMs: 2000,
    idleMinutes: 5,
    soundEnabled: true,
    timelineNewestFirst: true,
    showKeyOverlay: false,
    clockFormat: '24'
  };

  const DEFAULT_USERS = [
    { id: 'user1', name: 'User 1' },
    { id: 'user2', name: 'User 2' }
  ];

  const TASK_STYLES = [
    { category: 'productive', bg: 'rgba(30,123,255,0.12)', border: '#1e7bff', color: '#6fb0ff', font: 'Orbitron, sans-serif' },
    { category: 'study', bg: 'rgba(30,123,255,0.12)', border: '#1e7bff', color: '#6fb0ff', font: 'Orbitron, sans-serif' },
    { category: 'distraction', bg: 'rgba(255,51,85,0.12)', border: '#ff3355', color: '#ff6f88', font: 'Share Tech Mono, monospace' },
    { category: 'neutral', bg: 'rgba(0,255,157,0.10)', border: '#00ff9d', color: '#00ff9d', font: 'Share Tech Mono, monospace' },
    { category: 'rest', bg: 'rgba(0,255,157,0.10)', border: '#00ff9d', color: '#00ff9d', font: 'Share Tech Mono, monospace' }
  ];

  const DEFAULT_MAPPINGS = {
    mainTasks: {
      S: 'Study',
      P: 'Phone',
      W: 'Workout',
      E: 'Eat',
      F: 'Freshen Up',
      L: 'Sleep',
      B: 'Break'
    },
    subTasks: {
      S: { M: 'Maths', H: 'History', C: 'Chemistry', Y: 'Python', G: 'GAT' },
      P: { W: 'WhatsApp', I: 'Instagram', Y: 'YouTube' },
      W: { R: 'Running', G: 'Gym', S: 'Stretching' }
    },
    categories: {
      Study: 'study',
      Phone: 'distraction',
      Workout: 'productive',
      Eat: 'neutral',
      'Freshen Up': 'neutral',
      Sleep: 'rest',
      Break: 'rest'
    }
  };

  // ─── Application State ───────────────────────────────────────
  const state = {
    mappings: { mainTasks: {}, subTasks: {}, categories: {} },
    currentTask: null, // { main, sub, startTime, startedAt, mainKey }
    pendingMain: null, // { key, name } while waiting for subtask
    awaitingSubtaskFor: null, // { key, name } while subtask context owns key routing
    inputContext: { mode: 'normal', parentKey: null },
    subtaskTimer: null,
    subtaskCountdownInterval: null,
    soundEnabled: true,
    prefs: { ...DEFAULT_PREFS },
    lastActivity: Date.now(),
    idleAlertShown: false,
    analyticsTick: 0,
    selectedMainKeys: new Set(),
    selectedSubKeys: new Set(),
    activeUserId: 'user1',
    users: [],
    chartRange: 'day',
    timelineRange: 'today',
    deferredInstallPrompt: null,
    commandCentreExpanded: new Set(),
    isRestoringTask: false
  };

  function setupLaunchSplash() {
    const splash = document.getElementById('launchSplash');
    if (!splash) return;

    try {
      if (sessionStorage.getItem(LAUNCH_SPLASH_KEY) === '1') {
        splash.remove();
        return;
      }
      sessionStorage.setItem(LAUNCH_SPLASH_KEY, '1');
    } catch (error) {
      splash.remove();
      return;
    }

    const dismiss = () => {
      splash.classList.add('is-dismissed');
      splash.remove();
    };

    splash.addEventListener('animationend', dismiss, { once: true });
    window.setTimeout(dismiss, 2300);
  }

  function userPrefix() {
    return STORAGE_PREFIX + 'u_' + state.activeUserId + '_';
  }

  function sessionActiveKey() {
    return userPrefix() + 'active';
  }

  function normalizeActiveTask(task) {
    if (!task || !task.main) return null;

    const startedAt = Number(task.startedAt ?? task.startTime);
    if (!Number.isFinite(startedAt) || startedAt <= 0) return null;

    return {
      main: task.main,
      sub: task.sub || null,
      startTime: startedAt,
      startedAt,
      mainKey: task.mainKey || null
    };
  }

  function saveCurrentActiveTask() {
    const activeTask = normalizeActiveTask(state.currentTask);
    if (!activeTask) return;

    console.log('[LIFE-OS] SAVING ACTIVE TASK:', activeTask.main, activeTask.sub || '', 'startedAt:', activeTask.startedAt);
    localStorage.setItem(sessionActiveKey(), JSON.stringify(activeTask));
  }

  function removeActiveTask() {
    console.log('[LIFE-OS] REMOVING ACTIVE TASK');
    localStorage.removeItem(sessionActiveKey());
  }

  function loadCurrentActiveTask() {
    const raw = localStorage.getItem(sessionActiveKey());
    if (!raw) return null;
    try {
      const restored = normalizeActiveTask(JSON.parse(raw));
      if (restored) {
        console.log('[LIFE-OS] RESTORING ACTIVE TASK:', restored.main, restored.sub || '', 'startedAt:', restored.startedAt, 'elapsed:', Date.now() - restored.startedAt, 'ms');
        return restored;
      }
    } catch (e) { /* ignore invalid saved task */ }
    removeActiveTask();
    return null;
  }

  function restoreCurrentActiveTask() {
    state.currentTask = loadCurrentActiveTask();
    if (state.currentTask) saveCurrentActiveTask();
    return state.currentTask;
  }

  function isProductiveCategory(cat) {
    return cat === 'productive' || cat === 'study';
  }

  function getTaskStyle(mainName) {
    const cat = getCategory(mainName);
    return TASK_STYLES.find((style) => style.category === cat) || TASK_STYLES.find((style) => style.category === 'neutral');
  }

  function loadUsers() {
    const raw = localStorage.getItem(STORAGE_PREFIX + 'users');
    if (raw) {
      try {
        state.users = JSON.parse(raw);
      } catch (e) {
        state.users = [...DEFAULT_USERS];
      }
    } else {
      state.users = [...DEFAULT_USERS];
    }
    const active = localStorage.getItem(STORAGE_PREFIX + 'active_user');
    state.activeUserId = active && state.users.some((u) => u.id === active)
      ? active
      : state.users[0].id;
    saveUsers();
  }

  function saveUsers() {
    localStorage.setItem(STORAGE_PREFIX + 'users', JSON.stringify(state.users));
    localStorage.setItem(STORAGE_PREFIX + 'active_user', state.activeUserId);
  }

  function migrateLegacyData() {
    const hasLegacy = Object.keys(localStorage).some((k) =>
      k.startsWith(STORAGE_PREFIX + 'day_') || k === STORAGE_PREFIX + 'mappings'
    );
    if (!hasLegacy) return;

    const targetUser = state.users[0]?.id || 'user1';
    const prefix = STORAGE_PREFIX + 'u_' + targetUser + '_';

    Object.keys(localStorage).forEach((k) => {
      if (k.startsWith(STORAGE_PREFIX + 'day_')) {
        const day = k.replace(STORAGE_PREFIX + 'day_', '');
        if (!localStorage.getItem(prefix + 'day_' + day)) {
          localStorage.setItem(prefix + 'day_' + day, localStorage.getItem(k));
        }
        localStorage.removeItem(k);
      }
      if (k === STORAGE_PREFIX + 'mappings' && !localStorage.getItem(prefix + 'mappings')) {
        localStorage.setItem(prefix + 'mappings', localStorage.getItem(k));
        localStorage.removeItem(k);
      }
      if (k === STORAGE_PREFIX + 'prefs' && !localStorage.getItem(prefix + 'prefs')) {
        localStorage.setItem(prefix + 'prefs', localStorage.getItem(k));
      }
    });
  }

  function switchUser(userId) {
    if (userId === state.activeUserId) return;

    saveCurrentActiveTask();
    cancelSubtaskWait();
    state.activeUserId = userId;
    saveUsers();
    loadPreferences();
    loadMappings();
    restoreCurrentActiveTask();
    refreshAllUI();
    showToast('Switched to ' + getActiveUserName());
  }

  function getActiveUserName() {
    const u = state.users.find((x) => x.id === state.activeUserId);
    return u ? u.name : 'User';
  }

  function renderUserSelect() {
    const sel = document.getElementById('userSelect');
    if (!sel) return;
    sel.innerHTML = state.users.map((u) =>
      `<option value="${u.id}" ${u.id === state.activeUserId ? 'selected' : ''}>${u.name}</option>`
    ).join('');
  }

  function renderUsersList() {
    const list = document.getElementById('usersList');
    if (!list) return;
    list.innerHTML = state.users.map((u) => `
      <div class="user-row">
        <input type="text" class="user-rename-input" data-user-id="${u.id}" value="${u.name}">
        ${state.users.length > 1 ? `<button type="button" class="btn btn-sm btn-danger" data-del-user="${u.id}">Remove</button>` : ''}
        ${u.id === state.activeUserId ? '<span class="user-active-tag">ACTIVE</span>' : `<button type="button" class="btn btn-sm" data-switch-user="${u.id}">Switch</button>`}
      </div>
    `).join('');

    list.querySelectorAll('.user-rename-input').forEach((inp) => {
      inp.addEventListener('change', () => {
        const u = state.users.find((x) => x.id === inp.dataset.userId);
        if (u) {
          u.name = inp.value.trim() || u.name;
          saveUsers();
          renderUserSelect();
        }
      });
    });
    list.querySelectorAll('[data-switch-user]').forEach((btn) => {
      btn.addEventListener('click', () => switchUser(btn.dataset.switchUser));
    });
    list.querySelectorAll('[data-del-user]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!confirm('Delete this user and ALL their data?')) return;
        deleteUser(btn.dataset.delUser);
      });
    });
  }

  function addUser() {
    const n = state.users.length + 1;
    const id = 'user' + Date.now();
    state.users.push({ id, name: 'User ' + n });
    saveUsers();
    renderUsersList();
    renderUserSelect();
    showToast('User added');
  }

  function deleteUser(userId) {
    const deletingActiveUser = state.activeUserId === userId;
    Object.keys(localStorage).filter((k) => k.startsWith(STORAGE_PREFIX + 'u_' + userId + '_'))
      .forEach((k) => localStorage.removeItem(k));
    state.users = state.users.filter((u) => u.id !== userId);
    if (state.users.length === 0) state.users = [...DEFAULT_USERS];
    if (deletingActiveUser) {
      state.currentTask = null;
      state.activeUserId = state.users[0].id;
    }
    saveUsers();
    loadPreferences();
    loadMappings();
    restoreCurrentActiveTask();
    refreshAllUI();
  }

  function deleteAllLoggedDataForUser() {
    if (!confirm('Delete ALL timeline logs for ' + getActiveUserName() + '? This cannot be undone.')) return;
    Object.keys(localStorage).forEach((k) => {
      if (k.startsWith(userPrefix() + 'day_')) localStorage.removeItem(k);
    });
    if (state.currentTask) {
      state.currentTask = null;
      removeActiveTask();
    }
    refreshAllUI();
    showToast('All logged data deleted');
  }

  function clearCurrentUserCompletely() {
    if (!confirm('Delete ALL data and mappings for ' + getActiveUserName() + '?')) return;
    Object.keys(localStorage).filter((k) => k.startsWith(userPrefix())).forEach((k) => localStorage.removeItem(k));
    state.mappings = normalizeMappingKeys(JSON.parse(JSON.stringify(DEFAULT_MAPPINGS)));
    saveMappings();
    state.currentTask = null;
    cancelSubtaskWait();
    removeActiveTask();
    refreshAllUI();
    showToast('User data cleared');
  }

  function refreshAllUI() {
    refreshMappingUI();
    updateLivePanel();
    renderTimeline();
    renderRecent();
    renderAnalytics();
    updateTodaySummary();
    updateSystemStatus();
    renderUserSelect();
    renderUsersList();
  }

  function getEntriesForRange(range) {
    const entries = [];
    const days = range === 'week' ? 7 : 1;
    for (let i = 0; i < days; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = userPrefix() + 'day_' + dateKey(d);
      const raw = localStorage.getItem(key);
      if (raw) {
        try {
          const data = JSON.parse(raw);
          (data.timeline || []).forEach((e) => entries.push(e));
        } catch (e) { /* skip */ }
      }
    }
    if (state.currentTask) {
      entries.push({
        main: state.currentTask.main,
        sub: state.currentTask.sub,
        category: getCategory(state.currentTask.main),
        durationMs: Date.now() - state.currentTask.startTime
      });
    }
    return entries;
  }

  function renderChartsDashboard() {
    const container = document.getElementById('chartsContainer');
    if (!container) return;

    if (!window.LifeOSCharts) {
      container.innerHTML = '<p class="chart-error">Charts failed to load. Refresh the page or check that charts.js is present.</p>';
      return;
    }

    try {
      const entries = getEntriesForRange(state.chartRange);
      LifeOSCharts.renderChartsPanel(container, entries, getCategory);
    } catch (err) {
      console.error('Chart render error:', err);
      container.innerHTML = '<p class="chart-error">Could not draw charts. See console for details.</p>';
    }
  }

  /** Open charts modal (mobile-safe) and render after visible */
  function openChartsDashboard() {
    const modal = document.getElementById('chartsModal');
    const container = document.getElementById('chartsContainer');
    if (!modal || !container) {
      showToast('Charts UI missing', 'error');
      return;
    }

    modal.classList.remove('hidden');
    modal.classList.add('is-open');
    container.innerHTML = '<p class="chart-loading">Building charts…</p>';

    // Draw after modal is visible (hidden modals give canvas 0 size)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        renderChartsDashboard();
      });
    });
  }

  function closeChartsModal() {
    const modal = document.getElementById('chartsModal');
    if (modal) {
      modal.classList.add('hidden');
      modal.classList.remove('is-open');
    }
  }

  function bindChartButton(el) {
    if (!el) return;
    const handler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      openChartsDashboard();
    };
    el.addEventListener('click', handler);
    el.addEventListener('touchend', handler, { passive: false });
  }

  function isMobileDevice() {
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || window.innerWidth < 768;
  }

  function setupMobileKeyboard() {
    const input = document.getElementById('mobileKeyInput');
    const bar = document.getElementById('mobileKeyBar');
    const btn = document.getElementById('btnFocusKeys');
    if (!input || !bar) return;

    if (isMobileDevice()) {
      bar.classList.add('visible');
      document.body.classList.add('is-mobile');
    }

    btn.addEventListener('click', () => {
      input.focus();
      input.value = '';
    });

    input.addEventListener('input', () => {
      const val = input.value;
      if (!val) return;
      const ch = val.slice(-1).toUpperCase();
      input.value = '';
      if (/^[A-Z0-9]$/.test(ch)) handleTaskKey(ch);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace') return;
      const taskKey = keyFromEvent(e);
      if (taskKey) {
        e.preventDefault();
        e.stopPropagation();
        input.value = '';
        handleTaskKey(taskKey);
      }
    });
  }

  function getSubtaskWaitMs() {
    return state.prefs.subtaskWaitMs || DEFAULT_PREFS.subtaskWaitMs;
  }

  function getIdleThresholdMs() {
    const min = state.prefs.idleMinutes || DEFAULT_PREFS.idleMinutes;
    return min * 60 * 1000;
  }

  function loadPreferences() {
    const raw = localStorage.getItem(userPrefix() + 'prefs');
    if (raw) {
      try {
        state.prefs = { ...DEFAULT_PREFS, ...JSON.parse(raw) };
      } catch (e) {
        state.prefs = { ...DEFAULT_PREFS };
      }
    } else {
      state.prefs = { ...DEFAULT_PREFS };
    }
    state.soundEnabled = state.prefs.soundEnabled !== false;
    applyPreferencesToUI();
  }

  function savePreferences() {
    state.prefs.subtaskWaitMs = parseInt(document.getElementById('prefSubtaskWait').value, 10);
    state.prefs.idleMinutes = parseInt(document.getElementById('prefIdleMinutes').value, 10);
    state.prefs.soundEnabled = document.getElementById('prefSound').checked;
    state.prefs.timelineNewestFirst = document.getElementById('prefTimelineNewest').checked;
    state.prefs.clockFormat = document.getElementById('prefClockFormat').value;
    state.soundEnabled = state.prefs.soundEnabled;
    localStorage.setItem(userPrefix() + 'prefs', JSON.stringify(state.prefs));
    applyPreferencesToUI();
    showToast('Preferences saved');
  }

  function applyPreferencesToUI() {
    const waitSel = document.getElementById('prefSubtaskWait');
    const idleSel = document.getElementById('prefIdleMinutes');
    if (waitSel) waitSel.value = String(state.prefs.subtaskWaitMs);
    if (idleSel) idleSel.value = String(state.prefs.idleMinutes);
    const soundCb = document.getElementById('prefSound');
    const newestCb = document.getElementById('prefTimelineNewest');
    if (soundCb) soundCb.checked = state.prefs.soundEnabled;
    if (newestCb) newestCb.checked = state.prefs.timelineNewestFirst;
    const clockSel = document.getElementById('prefClockFormat');
    if (clockSel) clockSel.value = state.prefs.clockFormat || '24';
    const btnSound = document.getElementById('btnSound');
    if (btnSound) btnSound.textContent = state.soundEnabled ? 'SND' : 'MUTE';
    const overlay = document.getElementById('keyOverlay');
    if (overlay) overlay.classList.remove('hidden');
  }

  function updateSystemStatus() {
    const el = document.getElementById('systemStatus');
    if (getAwaitingSubtaskContext()) {
      el.textContent = 'AWAITING SUBTASK';
      el.style.color = 'var(--amber)';
    } else if (state.currentTask) {
      el.textContent = 'TRACKING ACTIVE';
      el.style.color = 'var(--accent)';
      console.log('[LIFE-OS] System status: TRACKING ACTIVE -', state.currentTask.main, state.currentTask.sub || '');
    } else {
      el.textContent = 'STANDBY';
      el.style.color = '';
      console.log('[LIFE-OS] System status: STANDBY');
    }
  }

  function updateTodaySummary() {
    const count = (getTodayData().timeline || []).length;
    const active = state.currentTask ? 1 : 0;
    document.getElementById('todaySummary').textContent =
      `${count + active} op${count + active === 1 ? '' : 's'} today`;
  }

  function formatTaskLabel(main, sub) {
    return sub ? `${main} > ${sub}` : main;
  }

  function getAwaitingSubtaskContext() {
    return state.inputContext.mode === 'subtask' ? state.awaitingSubtaskFor : null;
  }

  // ─── Utility Functions ───────────────────────────────────────

  /** Format Date as HH:MM (12h or 24h per user pref) */
  function formatTime(date) {
    const use12 = state.prefs.clockFormat === '12';
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: use12
    });
  }

  /** Format Date as HH:MM:SS for live clock */
  function formatClock(date) {
    const use12 = state.prefs.clockFormat === '12';
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: use12
    });
  }

  /** Format date key YYYY-MM-DD */
  function dateKey(date = new Date()) {
    return date.toISOString().slice(0, 10);
  }

  /** Format milliseconds as HH:MM:SS */
  function formatDurationMs(ms) {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return [h, m, s].map(n => String(n).padStart(2, '0')).join(':');
  }

  /** Format milliseconds as human readable (1h 58m) */
  function formatDurationHuman(ms) {
    const totalMin = Math.floor(ms / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m`;
    return `${Math.floor(ms / 1000)}s`;
  }

  /** Get today's timeline from storage */
  function getTodayData() {
    const key = userPrefix() + 'day_' + dateKey();
    const raw = localStorage.getItem(key);
    if (raw) {
      try { return JSON.parse(raw); } catch (e) { /* fall through */ }
    }
    return { timeline: [], taskSwitches: 0 };
  }

  /** Save today's timeline */
  function saveTodayData(data) {
    localStorage.setItem(userPrefix() + 'day_' + dateKey(), JSON.stringify(data));
    purgeOldData();
  }

  /** Remove data older than 7 days for current user */
  function purgeOldData() {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
    const cutoffKey = dateKey(cutoff);
    const prefix = userPrefix() + 'day_';

    Object.keys(localStorage).forEach(k => {
      if (k.startsWith(prefix)) {
        const d = k.replace(prefix, '');
        if (d < cutoffKey) localStorage.removeItem(k);
      }
    });
  }

  /** Normalize mapping keys to uppercase for reliable lookup */
  function normalizeMappingKeys(mappings) {
    const mainTasks = {};
    Object.entries(mappings.mainTasks || {}).forEach(([k, v]) => {
      mainTasks[k.toUpperCase()] = v;
    });

    const subTasks = {};
    Object.entries(mappings.subTasks || {}).forEach(([parentKey, subs]) => {
      const pk = parentKey.toUpperCase();
      subTasks[pk] = {};
      Object.entries(subs || {}).forEach(([sk, name]) => {
        subTasks[pk][sk.toUpperCase()] = name;
      });
    });

    return {
      mainTasks,
      subTasks,
      categories: mappings.categories || {}
    };
  }

  /** Load mappings from localStorage or defaults */
  function loadMappings() {
    const raw = localStorage.getItem(userPrefix() + 'mappings');
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        state.mappings = normalizeMappingKeys({
          mainTasks: parsed.mainTasks || {},
          subTasks: parsed.subTasks || {},
          categories: parsed.categories || {}
        });
        saveMappings();
        return;
      } catch (e) { /* use defaults */ }
    }
    state.mappings = normalizeMappingKeys(JSON.parse(JSON.stringify(DEFAULT_MAPPINGS)));
    saveMappings();
  }

  function saveMappings() {
    localStorage.setItem(userPrefix() + 'mappings', JSON.stringify(state.mappings));
  }

  /** Main-task keys only need to be unique among other main tasks. */
  function getMainKeyConflict(key) {
    const k = key.toUpperCase();
    return state.mappings.mainTasks[k] || null;
  }

  /** Subtask keys only need to be unique among siblings under the same parent. */
  function getSiblingSubtaskKeyConflict(parentKey, key) {
    const k = key.toUpperCase();
    const ownSubs = state.mappings.subTasks[parentKey];
    if (ownSubs && ownSubs[k]) {
      return `${state.mappings.mainTasks[parentKey] || parentKey} > ${ownSubs[k]}`;
    }
    return null;
  }

  /** Get category for a main task name */
  function getCategory(mainName) {
    return state.mappings.categories[mainName] || 'neutral';
  }

  /** Download a file */
  function downloadFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Show toast notification */
  function showToast(msg, type = 'success') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast' + (type === 'error' ? ' error' : '');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => el.classList.add('hidden'), 2500);
  }

  // ─── Sound Effects (Web Audio API) ───────────────────────────
  const audioCtx = typeof AudioContext !== 'undefined' ? new (window.AudioContext || window.webkitAudioContext)() : null;

  function playTone(freq, duration = 0.08, type = 'sine') {
    if (!state.soundEnabled || !audioCtx) return;
    try {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + duration);
    } catch (e) { /* silent fail */ }
  }

  function playSwitchSound() { playTone(880, 0.06); setTimeout(() => playTone(1100, 0.04), 60); }
  function playSubtaskSound() { playTone(660, 0.05); setTimeout(() => playTone(990, 0.05), 50); }
  function playWaitSound() { playTone(440, 0.04); }

  // ─── Task Engine ─────────────────────────────────────────────

  /** End current task and save to timeline */
  function endCurrentTask(endTime = new Date()) {
    if (!state.currentTask) return;
    
    console.trace('[LIFE-OS] endCurrentTask called');
    console.log('[LIFE-OS] endCurrentTask ending:', state.currentTask.main, state.currentTask.sub || '');

    const entry = {
      main: state.currentTask.main,
      sub: state.currentTask.sub || null,
      category: getCategory(state.currentTask.main),
      start: state.currentTask.startTime,
      end: endTime.getTime(),
      startFormatted: formatTime(new Date(state.currentTask.startTime)),
      endFormatted: formatTime(endTime),
      durationMs: endTime.getTime() - state.currentTask.startTime
    };

    const dayData = getTodayData();
    dayData.timeline.push(entry);
    dayData.taskSwitches = (dayData.taskSwitches || 0) + 1;
    saveTodayData(dayData);

    state.currentTask = null;
    removeActiveTask();
    renderTimeline();
    renderRecent();
    renderAnalytics();
    updateTodaySummary();
    updateSystemStatus();
  }

  /** Start a new task (auto-ends previous) */
  function startTask(mainName, subName, mainKey) {
    cancelSubtaskWait();

    const previousTask = state.currentTask;
    const startedAt = Date.now();
    
    // GUARD: Prevent duplicate task start during restoration phase
    if (
      state.isRestoringTask &&
      previousTask &&
      previousTask.main === mainName &&
      previousTask.sub === (subName || null)
    ) {
      console.log('[LIFE-OS] Prevented duplicate task start during restoration:', mainName, subName || '');
      return;
    }
    state.currentTask = {
      main: mainName,
      sub: subName || null,
      startTime: startedAt,
      startedAt,
      mainKey: mainKey
    };

    if (previousTask) {
      const entry = {
        main: previousTask.main,
        sub: previousTask.sub || null,
        category: getCategory(previousTask.main),
        start: previousTask.startTime,
        end: startedAt,
        startFormatted: formatTime(new Date(previousTask.startTime)),
        endFormatted: formatTime(new Date(startedAt)),
        durationMs: startedAt - previousTask.startTime
      };
      const dayData = getTodayData();
      dayData.timeline.push(entry);
      dayData.taskSwitches = (dayData.taskSwitches || 0) + 1;
      saveTodayData(dayData);
      renderRecent();
      renderAnalytics();
    }

    saveCurrentActiveTask();

    flashTaskSwitch();
    playSwitchSound();
    updateLivePanel();
    renderActiveCommands();
    renderTimeline();
    updateTodaySummary();
    updateSystemStatus();
    markActivity();
  }

  /** Enter subtask wait mode after main key press */
  function enterSubtaskWait(mainKey, mainName) {
    cancelSubtaskWait();

    const waitMs = getSubtaskWaitMs();
    state.pendingMain = { key: mainKey, name: mainName };
    state.awaitingSubtaskFor = state.pendingMain;
    state.inputContext = { mode: 'subtask', parentKey: mainKey };
    const banner = document.getElementById('subtaskBanner');
    banner.classList.remove('hidden');
    document.getElementById('pendingMainName').textContent = mainName;
    document.getElementById('statusDot').className = 'status-dot waiting';

    const subs = state.mappings.subTasks[mainKey] || {};
    const hintsEl = document.getElementById('subtaskHints');
    hintsEl.innerHTML = Object.entries(subs).map(([k, n]) =>
      `<span class="subtask-hint" data-hint-key="${k}" role="button" tabindex="0"><kbd>${k}</kbd>${n}</span>`
    ).join('') || '<span class="subtask-hint">No subtasks — waits then logs main only</span>';

    hintsEl.querySelectorAll('[data-hint-key]').forEach((el) => {
      el.addEventListener('click', () => handleTaskKey(el.dataset.hintKey));
    });

    playWaitSound();
    updateSystemStatus();
    renderActiveCommands();

    let remaining = waitMs;
    const countdownEl = document.getElementById('subtaskCountdown');
    countdownEl.textContent = (remaining / 1000).toFixed(1) + 's';

    state.subtaskCountdownInterval = setInterval(() => {
      remaining -= 100;
      countdownEl.textContent = Math.max(0, remaining / 1000).toFixed(1) + 's';
    }, 100);

    state.subtaskTimer = setTimeout(() => {
      if (state.pendingMain && state.pendingMain.key === mainKey) {
        startTask(mainName, null, mainKey);
        showToast(mainName, 'success');
      }
    }, waitMs);
  }

  function cancelSubtaskWait() {
    if (state.subtaskTimer) {
      clearTimeout(state.subtaskTimer);
      state.subtaskTimer = null;
    }
    if (state.subtaskCountdownInterval) {
      clearInterval(state.subtaskCountdownInterval);
      state.subtaskCountdownInterval = null;
    }
    state.pendingMain = null;
    state.awaitingSubtaskFor = null;
    state.inputContext = { mode: 'normal', parentKey: null };
    document.getElementById('subtaskBanner').classList.add('hidden');
    document.getElementById('subtaskHints').innerHTML = '';
    document.getElementById('statusDot').className = 'status-dot';
    updateSystemStatus();
    renderActiveCommands();
  }

  /** Resolve key from keyboard event (handles layout quirks) */
  function keyFromEvent(e) {
    if (e.key && e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
      return e.key.toUpperCase();
    }
    const codeMatch = e.code && e.code.match(/^Key([A-Z])$/i);
    if (codeMatch) return codeMatch[1].toUpperCase();
    return null;
  }

  /** Handle a single keypress for task switching */
  function handleTaskKey(key) {
    markActivity();
    const k = key.toUpperCase();

    const awaitingSubtaskFor = getAwaitingSubtaskContext();

    // In subtask context, only the selected parent's subtasks are valid.
    if (awaitingSubtaskFor) {
      const parentKey = awaitingSubtaskFor.key;
      const mainName = awaitingSubtaskFor.name;
      const subs = state.mappings.subTasks[parentKey] || {};
      const subName = subs && subs[k];

      if (subName) {
        cancelSubtaskWait();
        startTask(mainName, subName, parentKey);
        playSubtaskSound();
        showToast(`${mainName} > ${subName}`, 'success');
        return;
      }

      showToast(`Press a ${mainName} subtask key`, 'error');
      return;
    }

    // Check if it's a main task key
    if (state.mappings.mainTasks[k]) {
      const mainName = state.mappings.mainTasks[k];
      const hasSubs = state.mappings.subTasks[k] && Object.keys(state.mappings.subTasks[k]).length > 0;

      if (hasSubs) {
        enterSubtaskWait(k, mainName);
      } else {
        startTask(mainName, null, k);
      }
      return;
    }

    // Orphan subtask key without pending main — ignore or toast
  }

  /** Flash animation on task switch */
  function flashTaskSwitch() {
    const flash = document.getElementById('taskFlash');
    flash.classList.remove('hidden');
    const breadcrumb = document.getElementById('taskBreadcrumb');
    breadcrumb.classList.add('flash');
    setTimeout(() => {
      flash.classList.add('hidden');
      breadcrumb.classList.remove('flash');
    }, 350);
  }

  function markActivity() {
    state.lastActivity = Date.now();
    if (state.idleAlertShown) {
      state.idleAlertShown = false;
      document.getElementById('idleAlert').classList.add('hidden');
    }
    if (state.currentTask && !getAwaitingSubtaskContext()) {
      document.getElementById('statusDot').className = 'status-dot';
    }
  }

  // ─── Analytics ───────────────────────────────────────────────

  function computeAnalytics() {
    const dayData = getTodayData();
    const timeline = dayData.timeline || [];
    const now = Date.now();

  let productiveMs = 0, studyMs = 0, phoneMs = 0, distractionMs = 0;
    let longestMs = 0, totalMs = 0;
    const breakdown = {};
    let currentStreakMs = 0;

    // Include active task in calculations
    const entries = [...timeline];
    if (state.currentTask) {
      entries.push({
        main: state.currentTask.main,
        sub: state.currentTask.sub,
        durationMs: now - state.currentTask.startTime,
        start: state.currentTask.startTime,
        end: now
      });
    }

    entries.forEach(entry => {
      const dur = entry.durationMs || 0;
      totalMs += dur;
      if (dur > longestMs) longestMs = dur;

      const cat = getCategory(entry.main);
      if (isProductiveCategory(cat)) productiveMs += dur;
      if (cat === 'study' || entry.main === 'Study') studyMs += dur;
      if (cat === 'distraction') { distractionMs += dur; phoneMs += dur; }

      const label = entry.sub ? `${entry.main} > ${entry.sub}` : entry.main;
      breakdown[label] = (breakdown[label] || 0) + dur;
    });

    // Focus streak: consecutive productive/study entries from most recent
    for (let i = entries.length - 1; i >= 0; i--) {
      const cat = getCategory(entries[i].main);
      if (isProductiveCategory(cat)) {
        currentStreakMs += entries[i].durationMs || 0;
      } else break;
    }

    // Productivity score = % of logged time spent in productive work only
    const trackedMs = totalMs || 0;
    const score = trackedMs > 0 ? Math.round((productiveMs / trackedMs) * 100) : 0;

    return {
      score,
      productiveMs,
      studyMs,
      phoneMs: distractionMs,
      longestMs,
      totalMs,
      switches: dayData.taskSwitches || 0,
      streakMs: currentStreakMs,
      breakdown
    };
  }

  // ─── UI Rendering ────────────────────────────────────────────

  function getDayDataByKey(key) {
    const raw = localStorage.getItem(userPrefix() + 'day_' + key);
    if (raw) {
      try { return JSON.parse(raw); } catch (e) { /* skip invalid day */ }
    }
    return { timeline: [], taskSwitches: 0 };
  }

  function addDays(date, offset) {
    const d = new Date(date);
    d.setDate(d.getDate() + offset);
    return d;
  }

  function formatTimelineDate(date) {
    return date.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    }).toUpperCase();
  }

  function getTimelineRangeDays(range) {
    const today = new Date();
    today.setHours(12, 0, 0, 0);

    if (range === 'yesterday') return [addDays(today, -1)];

    if (range === 'week') {
      const dayOfWeek = today.getDay() || 7;
      const start = addDays(today, 1 - dayOfWeek);
      const days = [];
      for (let d = new Date(today); d >= start; d = addDays(d, -1)) days.push(new Date(d));
      return days;
    }

    if (range === 'month') {
      const days = [];
      for (let d = new Date(today); d.getMonth() === today.getMonth(); d = addDays(d, -1)) {
        days.push(new Date(d));
        if (d.getDate() === 1) break;
      }
      return days;
    }

    return [today];
  }

  function normalizeTimelineEntry(entry, dayKey, isActive = false) {
    const start = Number(entry.start || entry.startTime || Date.now());
    const end = Number(entry.end || (isActive ? Date.now() : start + (entry.durationMs || 0)));
    return {
      ...entry,
      dayKey,
      category: entry.category || getCategory(entry.main),
      start,
      end,
      startFormatted: entry.startFormatted || formatTime(new Date(start)),
      endFormatted: isActive ? 'NOW' : (entry.endFormatted || formatTime(new Date(end))),
      durationMs: entry.durationMs || Math.max(0, end - start),
      isActive
    };
  }

  function getTimelineRangeModel(range) {
    const days = getTimelineRangeDays(range);
    const todayKey = dateKey();
    const modelDays = days.map((date) => {
      const key = dateKey(date);
      const data = getDayDataByKey(key);
      const entries = (data.timeline || []).map((entry) => normalizeTimelineEntry(entry, key, false));

      if (key === todayKey && state.currentTask && range !== 'yesterday') {
        entries.push(normalizeTimelineEntry({
          main: state.currentTask.main,
          sub: state.currentTask.sub,
          category: getCategory(state.currentTask.main),
          start: state.currentTask.startTime,
          end: Date.now(),
          durationMs: Date.now() - state.currentTask.startTime
        }, key, true));
      }

      return { date, key, entries, switches: data.taskSwitches || 0 };
    });

    return {
      range,
      days: modelDays,
      entries: modelDays.flatMap((day) => day.entries)
    };
  }

  function summarizeEntries(entries, switches = 0) {
    let totalMs = 0, productiveMs = 0, distractionMs = 0, neutralMs = 0, studyMs = 0;
    let longestMs = 0, longestLabel = '--';
    const breakdown = {};

    entries.forEach((entry) => {
      const dur = entry.durationMs || 0;
      totalMs += dur;
      if (dur > longestMs) {
        longestMs = dur;
        longestLabel = entry.sub ? `${entry.main} > ${entry.sub}` : entry.main;
      }

      const cat = entry.category || getCategory(entry.main);
      if (isProductiveCategory(cat)) productiveMs += dur;
      if (cat === 'study' || entry.main === 'Study') studyMs += dur;
      if (cat === 'distraction') distractionMs += dur;
      if (!isProductiveCategory(cat) && cat !== 'distraction') neutralMs += dur;

      const label = entry.sub ? `${entry.main} > ${entry.sub}` : entry.main;
      breakdown[label] = (breakdown[label] || 0) + dur;
    });

    const mostUsed = Object.entries(breakdown).sort((a, b) => b[1] - a[1])[0];
    const taskSummary = Object.entries(breakdown)
      .sort((a, b) => b[1] - a[1])
      .map(([label, durationMs]) => ({ label, durationMs }));

    return {
      totalMs,
      productiveMs,
      distractionMs,
      neutralMs,
      studyMs,
      longestMs,
      longestLabel,
      switches,
      productivePct: totalMs > 0 ? Math.round((productiveMs / totalMs) * 100) : 0,
      mostUsedTask: mostUsed ? mostUsed[0] : '--',
      taskSummary
    };
  }

  function summarizeDay(day) {
    return summarizeEntries(day.entries, day.switches);
  }

  function getMostProductiveDay(days) {
    return days
      .map((day) => ({ day, summary: summarizeDay(day) }))
      .sort((a, b) => b.summary.productiveMs - a.summary.productiveMs)[0];
  }

  function getFocusTrend(days) {
    const summaries = days.map((day) => summarizeDay(day));
    const latest = summaries.slice(0, 7);
    const previous = summaries.slice(7, 14);
    const sum = (items) => items.reduce((total, item) => total + item.productiveMs, 0);
    const latestAvg = latest.length ? sum(latest) / latest.length : 0;
    const previousAvg = previous.length ? sum(previous) / previous.length : 0;
    if (!latestAvg && !previousAvg) return 'No signal';
    if (latestAvg > previousAvg * 1.05) return 'Rising';
    if (latestAvg < previousAvg * 0.95) return 'Falling';
    return 'Stable';
  }

  function updateLivePanel() {
    const breadcrumb = document.getElementById('taskBreadcrumb');
    const badge = document.getElementById('taskCategoryBadge');
    const timerEl = document.getElementById('liveTimer');

    if (!state.currentTask) {
      breadcrumb.className = 'task-breadcrumb standby';
      breadcrumb.textContent = '— STANDBY —';
      badge.classList.add('hidden');
      timerEl.classList.remove('ticking');
      document.getElementById('taskStartTime').textContent = '--:--';
      document.getElementById('taskDuration').textContent = '0m';
      timerEl.textContent = '00:00:00';
      return;
    }

    const { main, sub } = state.currentTask;
    const cat = getCategory(main);

    if (sub) {
      breadcrumb.className = 'task-breadcrumb has-sub';
      breadcrumb.innerHTML = `<span class="main-part">${main}</span><span class="sep">&gt;</span><span class="sub-part">${sub}</span>`;
    } else {
      breadcrumb.className = 'task-breadcrumb';
      breadcrumb.textContent = main;
    }

    badge.textContent = cat;
    badge.className = `task-category-badge ${cat}`;
    timerEl.classList.add('ticking');
    document.getElementById('taskStartTime').textContent = formatTime(new Date(state.currentTask.startTime));

    document.getElementById('currentMain').textContent = main;
    document.getElementById('currentSub').textContent = sub || '';
  }

  function tickTimer() {
    const now = new Date();
    document.getElementById('currentClock').textContent = formatClock(now);
    document.getElementById('currentDate').textContent = now.toLocaleDateString('en-GB', {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
    });

    if (state.currentTask) {
      const elapsed = Date.now() - state.currentTask.startTime;
      document.getElementById('liveTimer').textContent = formatDurationMs(elapsed);
      document.getElementById('taskDuration').textContent = formatDurationHuman(elapsed);
    }

    // Idle detection
    const idleMs = Date.now() - state.lastActivity;
    if (state.currentTask && idleMs > getIdleThresholdMs() && !state.idleAlertShown) {
      state.idleAlertShown = true;
      document.getElementById('idleDuration').textContent = Math.floor(idleMs / 60000);
      document.getElementById('idleAlert').classList.remove('hidden');
      document.getElementById('statusDot').className = 'status-dot idle-warn';
    }

    state.analyticsTick += 1;
    if (state.analyticsTick % 5 === 0) renderAnalytics();
  }

  function renderTimeline() {
    const list = document.getElementById('timelineList');
    const summaryEl = document.getElementById('timelineSummary');
    const model = getTimelineRangeModel(state.timelineRange);
    const entries = model.entries;

    renderTimelineSummary(model);

    if (entries.length === 0) {
      list.innerHTML = '<div class="timeline-empty">No activity logged for this range.</div>';
      if (summaryEl) summaryEl.classList.add('is-empty');
      return;
    }
    if (summaryEl) summaryEl.classList.remove('is-empty');

    if (state.timelineRange === 'today' || state.timelineRange === 'yesterday') {
      const displayEntries = [...entries];
      if (state.prefs.timelineNewestFirst) displayEntries.reverse();
      list.innerHTML = displayEntries.map(entry => timelineEntryHTML(entry, entry.isActive)).join('');
    } else {
      list.innerHTML = model.days
        .filter((day) => day.entries.length > 0)
        .map(dayTimelineHTML)
        .join('');
    }

    const activeRow = list.querySelector('.timeline-entry.active');
    if (activeRow) activeRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function renderTimelineSummary(model) {
    const container = document.getElementById('timelineSummary');
    if (!container) return;

    const switches = model.days.reduce((total, day) => total + day.switches, 0);
    const summary = summarizeEntries(model.entries, switches);
    const bestDay = getMostProductiveDay(model.days);
    const bestDayLabel = bestDay && bestDay.summary.productiveMs > 0
      ? formatTimelineDate(bestDay.day.date)
      : '--';

    const metricSets = {
      today: [
        ['Total Tracked', formatDurationHuman(summary.totalMs)],
        ['Productive', formatDurationHuman(summary.productiveMs)],
        ['Distraction', formatDurationHuman(summary.distractionMs)],
        ['Neutral', formatDurationHuman(summary.neutralMs)],
        ['Productivity Score', summary.productivePct, 'score'],
        ['Most Used', summary.mostUsedTask],
        ['Longest Session', summary.longestLabel, 'longest']
      ],
      yesterday: [
        ['Total Tracked', formatDurationHuman(summary.totalMs)],
        ['Productive', formatDurationHuman(summary.productiveMs)],
        ['Distraction', formatDurationHuman(summary.distractionMs)],
        ['Neutral', formatDurationHuman(summary.neutralMs)],
        ['Productivity Score', summary.productivePct, 'score'],
        ['Most Used', summary.mostUsedTask],
        ['Longest Session', summary.longestLabel, 'longest'],
        ['Task Switches', String(summary.switches)]
      ],
      week: [
        ['Total Tracked', formatDurationHuman(summary.totalMs)],
        ['Productive Time', formatDurationHuman(summary.productiveMs)],
        ['Distraction Time', formatDurationHuman(summary.distractionMs)],
        ['Neutral Time', formatDurationHuman(summary.neutralMs)],
        ['Productivity Score', summary.productivePct, 'score'],
        ['Most Used Task', summary.mostUsedTask],
        ['Most Productive Day', bestDayLabel],
        ['Longest Session', summary.longestLabel, 'longest'],
        ['Task Switches', String(summary.switches)]
      ],
      month: [
        ['Total Tracked', formatDurationHuman(summary.totalMs)],
        ['Productive Time', formatDurationHuman(summary.productiveMs)],
        ['Distraction Time', formatDurationHuman(summary.distractionMs)],
        ['Neutral Time', formatDurationHuman(summary.neutralMs)],
        ['Productivity Score', summary.productivePct, 'score'],
        ['Most Used Task', summary.mostUsedTask],
        ['Most Productive Day', bestDayLabel],
        ['Longest Session', summary.longestLabel, 'longest'],
        ['Focus Trend', getFocusTrend(model.days)],
        ['Study Time', formatDurationHuman(summary.studyMs)]
      ]
    };

    const title = {
      today: 'TODAY',
      yesterday: 'YESTERDAY',
      week: 'THIS WEEK',
      month: 'THIS MONTH'
    }[model.range] || 'TODAY';

    container.innerHTML = `<div class="mission-analysis">
      <div class="mission-analysis-title"><span>MISSION ANALYSIS</span><strong>${title}</strong></div>
      <div class="mission-metrics">
        ${metricSets[model.range].map(metric => missionMetricHTML(metric, summary)).join('')}
      </div>
      <div class="task-summary">
        <div class="task-summary-title">TASK SUMMARY</div>
        <div class="task-summary-grid">
          ${taskSummaryHTML(summary.taskSummary)}
        </div>
      </div>
    </div>`;
  }

  function missionMetricHTML([label, value, type], summary) {
    const tone = metricToneClass(label);
    if (type === 'score') {
      const pct = Number(value) || 0;
      return `<div class="mission-metric mission-score ${tone}">
        <span>${label}</span>
        <strong>${pct}%</strong>
        <div class="mission-score-bar"><div style="width:${pct}%"></div></div>
      </div>`;
    }

    if (type === 'longest') {
      return `<div class="mission-metric mission-longest ${tone}">
        <span>${label}</span>
        <strong>${escapeHtml(value || '--')}</strong>
        <em>${formatDurationHuman(summary.longestMs)}</em>
      </div>`;
    }

    return `<div class="mission-metric ${tone}">
      <span>${label}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>`;
  }

  function metricToneClass(label) {
    const normalized = String(label).toLowerCase();
    if (normalized.includes('productive') || normalized.includes('study')) return 'metric-productive';
    if (normalized.includes('distraction')) return 'metric-distraction';
    if (normalized.includes('neutral')) return 'metric-neutral';
    return '';
  }

  function taskSummaryHTML(tasks) {
    if (!tasks.length) return '<div class="task-summary-empty">No task data for this range.</div>';
    return tasks.map((task, index) => `<div class="task-summary-row">
      <span class="task-rank">${String(index + 1).padStart(2, '0')}</span>
      <strong>${escapeHtml(task.label)}</strong>
      <span>${formatDurationHuman(task.durationMs)}</span>
    </div>`).join('');
  }

  function dayTimelineHTML(day) {
    const summary = summarizeDay(day);
    const entries = [...day.entries].sort((a, b) => (b.start || 0) - (a.start || 0));
    return `<section class="timeline-day">
      <div class="timeline-day-header">
        <h3>${formatTimelineDate(day.date)}</h3>
        <div class="timeline-day-stats">
          <span>Tracked: <strong>${formatDurationHuman(summary.totalMs)}</strong></span>
          <span>Productive: <strong>${formatDurationHuman(summary.productiveMs)}</strong></span>
        </div>
      </div>
      <div class="timeline-day-entries">
        ${entries.map(entry => timelineEntryHTML(entry, entry.isActive)).join('')}
      </div>
    </section>`;
  }

  function timelineEntryHTML(entry, isActive) {
    const cat = entry.category || getCategory(entry.main);
    const style = getTaskStyle(entry.main);
    const taskLabel = entry.sub
      ? `<span class="main">${entry.main}</span><span class="sub">${entry.sub}</span>`
      : `<span class="main">${entry.main}</span>`;

    return `<div class="timeline-entry cat-${cat}${isActive ? ' active' : ''}" style="background:${style.bg};border-left-color:${style.border}">
      <div class="timeline-time">${entry.startFormatted} - ${entry.endFormatted || formatTime(new Date())}</div>
      <div class="timeline-task" style="color:${style.color};font-family:${style.font}">${taskLabel}</div>
      <div class="timeline-duration">${formatDurationHuman(entry.durationMs)}</div>
    </div>`;
  }

  function renderRecent() {
    const list = document.getElementById('recentList');
    const entries = (getTodayData().timeline || []).slice(-5).reverse();

    if (entries.length === 0) {
      list.innerHTML = '<div class="recent-empty">No completed tasks yet.</div>';
      return;
    }

    list.innerHTML = entries.map(e => {
      const label = e.sub ? `${e.main} > ${e.sub}` : e.main;
      const style = getTaskStyle(e.main);
      return `<div class="recent-item">
        <span class="recent-task" style="color:${style.color};font-family:${style.font}">${label}</span>
        <span class="recent-duration">${formatDurationHuman(e.durationMs)}</span>
      </div>`;
    }).join('');
  }

  function renderAnalytics() {
    const stats = computeAnalytics();

    document.getElementById('statScore').textContent = stats.score + '%';
    const scoreFill = document.getElementById('scoreFill');
    if (scoreFill) scoreFill.style.width = stats.score + '%';
    document.getElementById('statProductive').textContent = formatDurationHuman(stats.productiveMs);
    document.getElementById('statStudy').textContent = formatDurationHuman(stats.studyMs);
    document.getElementById('statPhone').textContent = formatDurationHuman(stats.phoneMs);
    document.getElementById('statLongest').textContent = formatDurationHuman(stats.longestMs);
    document.getElementById('statSwitches').textContent = stats.switches;
    document.getElementById('statStreak').textContent = formatDurationHuman(stats.streakMs);
    document.getElementById('statTotal').textContent = formatDurationHuman(stats.totalMs);

    const bars = document.getElementById('breakdownBars');
    const sorted = Object.entries(stats.breakdown).sort((a, b) => b[1] - a[1]);
    const max = sorted[0] ? sorted[0][1] : 1;

    if (sorted.length === 0) {
      bars.innerHTML = '<div class="breakdown-empty">No data yet</div>';
      return;
    }

    bars.innerHTML = sorted.map(([label, ms]) => {
      const pct = Math.round((ms / max) * 100);
      return `<div class="breakdown-item">
        <div class="breakdown-label"><span>${label}</span><span>${formatDurationHuman(ms)}</span></div>
        <div class="breakdown-bar"><div class="breakdown-fill" style="width:${pct}%"></div></div>
      </div>`;
    }).join('');
  }

  function renderActiveCommands() {
    renderKeyOverlay();
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function findMainKeyForTask(mainName) {
    const match = Object.entries(state.mappings.mainTasks)
      .find(([, name]) => name === mainName);
    return match ? match[0] : null;
  }

  function renderKeyOverlay() {
    const grid = document.getElementById('keyOverlayGrid');
    if (!grid) return;

    const awaiting = getAwaitingSubtaskContext();
    const activeMainKey = awaiting
      ? awaiting.key
      : (state.currentTask?.mainKey || findMainKeyForTask(state.currentTask?.main));
    const activeSub = awaiting ? null : (state.currentTask?.sub || null);
    const activeMain = awaiting ? awaiting.name : (state.currentTask?.main || null);

    const entries = Object.entries(state.mappings.mainTasks);
    if (entries.length === 0) {
      grid.innerHTML = '<div class="command-empty">No commands configured.</div>';
      return;
    }

    let html = '<div class="command-tree" role="tree" aria-label="Command Centre">';
    Object.entries(state.mappings.mainTasks).forEach(([key, name]) => {
      const subs = state.mappings.subTasks[key] || {};
      const subCount = Object.keys(subs).length;
      const isActiveParent = activeMainKey === key || activeMain === name;
      const isAwaiting = awaiting && awaiting.key === key;
      const isActiveMainOnly = isActiveParent && !activeSub && state.currentTask?.main === name;
      const isExpanded = isActiveParent || state.commandCentreExpanded.has(key);
      const parentClasses = [
        'command-node',
        'command-parent',
        isActiveParent ? 'active-path' : '',
        isActiveMainOnly ? 'active-leaf' : '',
        isAwaiting ? 'awaiting' : ''
      ].filter(Boolean).join(' ');

      html += `<div class="command-group${isActiveParent ? ' active-group' : ''}" role="treeitem" aria-expanded="${isExpanded}">
        <button class="${parentClasses}" type="button" data-command-toggle="${escapeHtml(key)}" aria-expanded="${isExpanded}">
          <span class="command-arrow" aria-hidden="true">${isExpanded ? '▼' : '▶'}</span>
          <kbd class="command-key">[${escapeHtml(key)}]</kbd>
          <span class="command-label">${escapeHtml(name)}</span>
          <span class="command-count">(${subCount})</span>
          ${isAwaiting ? '<span class="command-state">WAITING</span>' : ''}
          ${isActiveMainOnly ? '<span class="command-state">ACTIVE</span>' : ''}
        </button>`;

      if (isExpanded && subCount > 0) {
        html += '<div class="command-children" role="group">';
        Object.entries(subs).forEach(([sk, sn]) => {
          const isActiveSub = isActiveParent && activeSub === sn;
          const childClasses = [
            'command-node',
            'command-child',
            isActiveParent ? 'active-path' : '',
            isActiveSub ? 'active-leaf' : ''
          ].filter(Boolean).join(' ');

          html += `<div class="${childClasses}" role="treeitem">
            <span class="command-branch" aria-hidden="true"></span>
            <kbd class="command-key">[${escapeHtml(sk)}]</kbd>
            <span class="command-label">${escapeHtml(sn)}</span>
            ${isActiveSub ? '<span class="command-state">ACTIVE</span>' : ''}
          </div>`;
        });
        html += '</div>';
      } else if (isExpanded) {
        html += `<div class="command-children command-empty-subkeys" role="group">
          <div class="command-no-subkeys">No subkeys added yet. Go to Settings → Subtasks to add.</div>
        </div>`;
      }

      html += '</div>';
    });
    html += '</div>';
    grid.innerHTML = html;

    grid.querySelectorAll('[data-command-toggle]').forEach((button) => {
      button.addEventListener('click', () => {
        const key = button.dataset.commandToggle;
        if (!key || key === activeMainKey) return;
        if (state.commandCentreExpanded.has(key)) state.commandCentreExpanded.delete(key);
        else state.commandCentreExpanded.add(key);
        renderActiveCommands();
      });
    });

    const activeNode = grid.querySelector('.command-node.active-leaf, .command-group.active-group .command-parent');
    if (activeNode) activeNode.scrollIntoView({ block: 'nearest' });
  }

  function toggleKeyOverlay() {
    state.prefs.showKeyOverlay = !state.prefs.showKeyOverlay;
    localStorage.setItem(userPrefix() + 'prefs', JSON.stringify(state.prefs));
    document.getElementById('keyOverlay')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    showToast('Command Centre pinned in live panel');
  }

  function renderHelpKeyList() {
    const container = document.getElementById('helpKeyList');
    let html = '';

    Object.entries(state.mappings.mainTasks).forEach(([key, name]) => {
      html += `<div class="help-key-item"><kbd>${key}</kbd> ${name}</div>`;
      const subs = state.mappings.subTasks[key];
      if (subs) {
        Object.entries(subs).forEach(([sk, sn]) => {
          html += `<div class="help-key-item" style="margin-left:12px"><kbd>${key}</kbd> then <kbd>${sk}</kbd> → ${name} &gt; ${sn}</div>`;
        });
      }
    });

    container.innerHTML = html || '<p>No mappings configured.</p>';
  }

  // ─── Mapping CRUD UI ─────────────────────────────────────────

  function renderMainMappingList() {
    const list = document.getElementById('mainMappingList');
    const entries = Object.entries(state.mappings.mainTasks);

    if (entries.length === 0) {
      list.innerHTML = '<p class="tab-desc">No main tasks configured.</p>';
      return;
    }

    list.innerHTML = entries.map(([key, name]) => {
      const cat = getCategory(name);
      const checked = state.selectedMainKeys.has(key) ? 'checked' : '';
      return `<div class="mapping-row">
        <input type="checkbox" data-main-key="${key}" ${checked}>
        <span class="mapping-key">${key}</span>
        <span class="mapping-name">${name}</span>
        <span class="mapping-cat ${cat}">${cat}</span>
        <div class="mapping-actions">
          <button type="button" data-edit-main="${key}">Edit</button>
          <button type="button" data-del-main="${key}">Del</button>
        </div>
      </div>`;
    }).join('');

    list.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        const k = cb.dataset.mainKey;
        if (cb.checked) state.selectedMainKeys.add(k);
        else state.selectedMainKeys.delete(k);
      });
    });

    list.querySelectorAll('[data-edit-main]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.editMain;
        const name = state.mappings.mainTasks[key];
        document.getElementById('mainKeyInput').value = key;
        document.getElementById('mainNameInput').value = name;
        document.getElementById('mainCategoryInput').value = getCategory(name);
      });
    });

    list.querySelectorAll('[data-del-main]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (confirm('Delete this main task and its subtasks?')) {
          deleteMainMapping(btn.dataset.delMain);
          refreshMappingUI();
        }
      });
    });
  }

  function renderSubMappingList() {
    const list = document.getElementById('subMappingList');
    let html = '';

    Object.entries(state.mappings.subTasks).forEach(([parentKey, subs]) => {
      const parentName = state.mappings.mainTasks[parentKey] || parentKey;
      Object.entries(subs).forEach(([key, name]) => {
        const id = `${parentKey}:${key}`;
        const checked = state.selectedSubKeys.has(id) ? 'checked' : '';
        html += `<div class="mapping-row">
          <input type="checkbox" data-sub-id="${id}" ${checked}>
          <span class="mapping-key">${key}</span>
          <span class="mapping-name">${parentName} > ${name}</span>
          <div class="mapping-actions">
            <button type="button" data-del-sub="${id}">Del</button>
          </div>
        </div>`;
      });
    });

    list.innerHTML = html || '<p class="tab-desc">No subtasks configured.</p>';

    list.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        const id = cb.dataset.subId;
        if (cb.checked) state.selectedSubKeys.add(id);
        else state.selectedSubKeys.delete(id);
      });
    });

    list.querySelectorAll('[data-del-sub]').forEach(btn => {
      btn.addEventListener('click', () => {
        const [pk, sk] = btn.dataset.delSub.split(':');
        deleteSubMapping(pk, sk);
        refreshMappingUI();
      });
    });
  }

  function renderCategoryList() {
    const list = document.getElementById('categoryList');
    list.innerHTML = Object.entries(state.mappings.mainTasks).map(([, name]) => {
      const cat = getCategory(name);
      return `<div class="mapping-row">
        <span class="mapping-name">${name}</span>
        <select data-cat-task="${name}" class="input-select">
          ${['productive', 'study', 'distraction', 'neutral', 'rest'].map(c =>
            `<option value="${c}" ${cat === c ? 'selected' : ''}>${c}</option>`
          ).join('')}
        </select>
      </div>`;
    }).join('');

    list.querySelectorAll('[data-cat-task]').forEach(sel => {
      sel.addEventListener('change', () => {
        state.mappings.categories[sel.dataset.catTask] = sel.value;
        saveMappings();
        renderAnalytics();
      });
    });
  }

  function populateSubParentSelect() {
    const sel = document.getElementById('subParentInput');
    sel.innerHTML = Object.entries(state.mappings.mainTasks)
      .map(([k, v]) => `<option value="${k}">${k} — ${v}</option>`)
      .join('');
  }

  function refreshMappingUI() {
    renderMainMappingList();
    renderSubMappingList();
    renderCategoryList();
    renderActiveCommands();
    renderHelpKeyList();
    populateSubParentSelect();
  }

  function addMainMapping(key, name, category) {
    state.mappings.mainTasks[key] = name;
    state.mappings.categories[name] = category;
    if (!state.mappings.subTasks[key]) state.mappings.subTasks[key] = {};
    saveMappings();
  }

  function deleteMainMapping(key) {
    delete state.mappings.mainTasks[key];
    delete state.mappings.subTasks[key];
    saveMappings();
  }

  function addSubMapping(parentKey, key, name) {
    if (!state.mappings.subTasks[parentKey]) state.mappings.subTasks[parentKey] = {};
    state.mappings.subTasks[parentKey][key] = name;
    saveMappings();
  }

  function deleteSubMapping(parentKey, key) {
    if (state.mappings.subTasks[parentKey]) {
      delete state.mappings.subTasks[parentKey][key];
    }
    saveMappings();
  }

  // ─── Export Functions ──────────────────────────────────────────

  function exportTimelineJson() {
    const data = getTodayData();
    downloadFile(`lifeos-timeline-${dateKey()}.json`, JSON.stringify(data, null, 2), 'application/json');
    showToast('Timeline exported as JSON');
  }

  function exportTimelineCsv() {
    const entries = getTodayData().timeline || [];
    const rows = [['Start', 'End', 'Main', 'Sub', 'Duration']];
    entries.forEach(e => {
      rows.push([e.startFormatted, e.endFormatted, e.main, e.sub || '', formatDurationHuman(e.durationMs)]);
    });
    const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\\n');
    downloadFile(`lifeos-timeline-${dateKey()}.csv`, csv, 'text/csv');
    showToast('Timeline exported as CSV');
  }

  // ─── Modal & Tab Handling ────────────────────────────────────

  function openModal(id) {
    document.getElementById(id).classList.remove('hidden');
  }

  function closeModal(id) {
    if (id === 'chartsModal') {
      closeChartsModal();
      return;
    }
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('hidden');
    el.classList.remove('is-open');
  }

  function closeAllModals() {
    document.querySelectorAll('.modal-overlay').forEach(m => {
      m.classList.add('hidden');
      m.classList.remove('is-open');
    });
  }

  function isModalOpen() {
    return [...document.querySelectorAll('.modal-overlay')].some(m => !m.classList.contains('hidden'));
  }

  function isTypingContext(e) {
    const tag = e.target.tagName;
    return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
  }

  // ─── Event Listeners ─────────────────────────────────────────

  function bindEvents() {
    try {
      bindEventsCore();
    } catch (err) {
      console.error('bindEvents failed:', err);
      showToast('Some buttons failed to load — refresh page', 'error');
    }
  }

  function bindEventsCore() {
    // Global keyboard handler — core of the app
    document.addEventListener('keydown', (e) => {
      if (isTypingContext(e)) return;

      // Ctrl+K — settings
      if (e.ctrlKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openModal('settingsModal');
        refreshMappingUI();
        return;
      }

      // Escape — close modals
      if (e.key === 'Escape') {
        closeAllModals();
        cancelSubtaskWait();
        return;
      }

      // ? — help (shift+/ on most keyboards)
      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        renderHelpKeyList();
        openModal('helpModal');
        return;
      }

      // ` — toggle floating key overlay
      if (e.key === '`' || e.key === '~') {
        e.preventDefault();
        toggleKeyOverlay();
        return;
      }

      if (isModalOpen()) return;

      // Single character keys for task switching
      const taskKey = keyFromEvent(e);
      if (taskKey) {
        e.preventDefault();
        handleTaskKey(taskKey);
      }
    });

    // Mark activity on mouse/keyboard
    ['mousedown', 'keydown', 'touchstart'].forEach(evt => {
      document.addEventListener(evt, () => {
        if (state.currentTask) markActivity();
      }, { passive: true });
    });

    // Header buttons
    document.getElementById('btnSettings').addEventListener('click', () => {
      openModal('settingsModal');
      refreshMappingUI();
    });
    document.getElementById('btnCloseSettings').addEventListener('click', () => closeModal('settingsModal'));
    document.getElementById('btnHelp').addEventListener('click', () => {
      renderHelpKeyList();
      openModal('helpModal');
    });
    document.getElementById('btnCloseHelp').addEventListener('click', () => closeModal('helpModal'));

    document.getElementById('btnSound').addEventListener('click', () => {
      state.soundEnabled = !state.soundEnabled;
      state.prefs.soundEnabled = state.soundEnabled;
      localStorage.setItem(userPrefix() + 'prefs', JSON.stringify(state.prefs));
      document.getElementById('btnSound').textContent = state.soundEnabled ? 'SND' : 'MUTE';
      const soundCb = document.getElementById('prefSound');
      if (soundCb) soundCb.checked = state.soundEnabled;
      showToast(state.soundEnabled ? 'Sound ON' : 'Sound OFF');
    });

    document.getElementById('btnSavePrefs').addEventListener('click', savePreferences);

    document.getElementById('btnFullscreen').addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen?.();
        document.body.classList.add('fullscreen');
      } else {
        document.exitFullscreen?.();
        document.body.classList.remove('fullscreen');
      }
    });

    document.getElementById('btnExportJson').addEventListener('click', exportTimelineJson);
    document.getElementById('btnExportCsv').addEventListener('click', exportTimelineCsv);

    document.querySelectorAll('[data-timeline-range]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.timelineRange = btn.dataset.timelineRange || 'today';
        document.querySelectorAll('[data-timeline-range]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderTimeline();
      });
    });

    // Settings tabs only (not chart range buttons)
    document.querySelectorAll('.settings-tabs .tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.settings-tabs .tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('#settingsModal .tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        const panel = document.querySelector(`#settingsModal .tab-content[data-tab="${tab.dataset.tab}"]`);
        if (panel) panel.classList.add('active');
      });
    });

    // Add main mapping
    document.getElementById('btnAddMain').addEventListener('click', () => {
      const key = document.getElementById('mainKeyInput').value.trim().toUpperCase();
      const name = document.getElementById('mainNameInput').value.trim();
      const category = document.getElementById('mainCategoryInput').value;

      if (!key || !name) { showToast('Enter key and name', 'error'); return; }
      if (key.length !== 1) { showToast('Key must be 1 character', 'error'); return; }

      const conflict = getMainKeyConflict(key);
      if (conflict && state.mappings.mainTasks[key] !== name) {
        showToast(`Key "${key}" used by ${conflict}`, 'error');
        return;
      }

      addMainMapping(key, name, category);
      document.getElementById('mainKeyInput').value = '';
      document.getElementById('mainNameInput').value = '';
      refreshMappingUI();
      showToast(`Added: ${name}`);
    });

    // Add sub mapping
    document.getElementById('btnAddSub').addEventListener('click', () => {
      const parentKey = document.getElementById('subParentInput').value;
      const key = document.getElementById('subKeyInput').value.trim().toUpperCase();
      const name = document.getElementById('subNameInput').value.trim();

      if (!parentKey || !key || !name) { showToast('Fill all fields', 'error'); return; }

      const conflict = getSiblingSubtaskKeyConflict(parentKey, key);
      if (conflict) { showToast(`Key "${key}" used by ${conflict}`, 'error'); return; }

      addSubMapping(parentKey, key, name);
      document.getElementById('subKeyInput').value = '';
      document.getElementById('subNameInput').value = '';
      refreshMappingUI();
      showToast(`Added subtask: ${name}`);
    });

    document.getElementById('btnDeleteSelectedMain').addEventListener('click', () => {
      if (state.selectedMainKeys.size === 0) { showToast('Select tasks first', 'error'); return; }
      if (!confirm(`Delete ${state.selectedMainKeys.size} main task(s)?`)) return;
      state.selectedMainKeys.forEach(k => deleteMainMapping(k));
      state.selectedMainKeys.clear();
      refreshMappingUI();
    });

    document.getElementById('btnDeleteSelectedSub').addEventListener('click', () => {
      if (state.selectedSubKeys.size === 0) { showToast('Select subtasks first', 'error'); return; }
      if (!confirm(`Delete ${state.selectedSubKeys.size} subtask(s)?`)) return;
      state.selectedSubKeys.forEach(id => {
        const [pk, sk] = id.split(':');
        deleteSubMapping(pk, sk);
      });
      state.selectedSubKeys.clear();
      refreshMappingUI();
    });

    // Import/Export mappings
    document.getElementById('btnExportMappings').addEventListener('click', () => {
      downloadFile('lifeos-mappings.json', JSON.stringify(state.mappings, null, 2), 'application/json');
      showToast('Mappings exported');
    });

    document.getElementById('btnImportMappings').addEventListener('click', () => {
      document.getElementById('importMappingsFile').click();
    });

    document.getElementById('importMappingsFile').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target.result);
          state.mappings = normalizeMappingKeys({
            mainTasks: data.mainTasks || state.mappings.mainTasks,
            subTasks: data.subTasks || state.mappings.subTasks,
            categories: data.categories || state.mappings.categories
          });
          saveMappings();
          refreshMappingUI();
          showToast('Mappings imported');
        } catch (err) {
          showToast('Invalid JSON file', 'error');
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    });

    document.getElementById('btnExportAllData').addEventListener('click', () => {
      const all = { user: getActiveUserName(), userId: state.activeUserId };
      Object.keys(localStorage).filter(k => k.startsWith(userPrefix())).forEach(k => {
        all[k] = JSON.parse(localStorage.getItem(k));
      });
      downloadFile(`lifeos-backup-${state.activeUserId}.json`, JSON.stringify(all, null, 2), 'application/json');
      showToast('User backup exported');
    });

    document.getElementById('btnDeleteLogs').addEventListener('click', deleteAllLoggedDataForUser);
    document.getElementById('btnClearUserData').addEventListener('click', clearCurrentUserCompletely);
    document.getElementById('btnAddUser').addEventListener('click', addUser);

    document.getElementById('userSelect').addEventListener('change', (e) => {
      switchUser(e.target.value);
    });

    bindChartButton(document.getElementById('btnCharts'));

    const btnCloseCharts = document.getElementById('btnCloseCharts');
    if (btnCloseCharts) {
      btnCloseCharts.addEventListener('click', () => closeChartsModal());
      btnCloseCharts.addEventListener('touchend', (e) => {
        e.preventDefault();
        closeChartsModal();
      });
    }

    document.querySelectorAll('.chart-range-btn').forEach((btn) => {
      const setRange = (e) => {
        e.preventDefault();
        document.querySelectorAll('.chart-range-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.chartRange = btn.dataset.range || 'day';
        renderChartsDashboard();
      };
      btn.addEventListener('click', setRange);
      btn.addEventListener('touchend', setRange, { passive: false });
    });

    const btnInstall = document.getElementById('btnInstallPwa');
    if (btnInstall) {
      btnInstall.addEventListener('click', () => promptInstallApp());
    }

    // Close modal on overlay click
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal(overlay.id);
      });
    });
  } /* end bindEventsCore */

  // ─── PWA (install + offline + standalone) ─────────────────────

  function isPwaStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches
      || window.matchMedia('(display-mode: fullscreen)').matches
      || window.navigator.standalone === true;
  }

  async function promptInstallApp() {
    if (state.deferredInstallPrompt) {
      state.deferredInstallPrompt.prompt();
      const { outcome } = await state.deferredInstallPrompt.userChoice;
      state.deferredInstallPrompt = null;
      document.getElementById('installBanner')?.classList.add('hidden');
      showToast(outcome === 'accepted' ? 'App installed!' : 'Install cancelled');
      return;
    }
    showToast('Menu → Install app / Add to Home screen', 'error');
  }

  function setupPWA() {
    if (isPwaStandalone()) {
      document.body.classList.add('pwa-standalone');
      document.getElementById('installBanner')?.classList.add('hidden');
      document.getElementById('installPwaBox')?.classList.add('hidden');
    }

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      state.deferredInstallPrompt = e;
      if (!localStorage.getItem(STORAGE_PREFIX + 'install_dismissed')) {
        document.getElementById('installBanner')?.classList.remove('hidden');
      }
    });

    window.addEventListener('appinstalled', () => {
      state.deferredInstallPrompt = null;
      document.getElementById('installBanner')?.classList.add('hidden');
      showToast('LIFE-OS installed!');
    });

    document.getElementById('btnInstallBanner')?.addEventListener('click', promptInstallApp);
    document.getElementById('btnDismissInstall')?.addEventListener('click', () => {
      document.getElementById('installBanner')?.classList.add('hidden');
      localStorage.setItem(STORAGE_PREFIX + 'install_dismissed', '1');
    });

    function updateOnlineStatus() {
      const badge = document.getElementById('offlineBadge');
      if (!badge) return;
      if (navigator.onLine) badge.classList.add('hidden');
      else badge.classList.remove('hidden');
    }
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    updateOnlineStatus();

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js')
        .then((reg) => {
          console.log('SW registered:', reg.scope);
          reg.update();
        })
        .catch((err) => console.warn('SW registration failed:', err));
    }
  }

  // ─── Initialize ──────────────────────────────────────────────

  function init() {
    setupLaunchSplash();

    loadUsers();
    migrateLegacyData();
    loadPreferences();
    loadMappings();

    // PHASE 1: Restore active task BEFORE the first UI render
    console.log('[LIFE-OS] init() PHASE 1: Starting task restoration');
    state.isRestoringTask = true;
    const restoredTask = restoreCurrentActiveTask();
    if (restoredTask) {
      console.log('[LIFE-OS] Active task restored in init():', restoredTask.main, restoredTask.sub || '');
    }

    // PHASE 2: Setup events and UI (with restoration flag still active)
    console.log('[LIFE-OS] init() PHASE 2: Binding events and rendering UI');
    bindEvents();
    setupMobileKeyboard();
    setupPWA();
    refreshAllUI();

    // PHASE 3: END restoration phase - now safe to accept key input
    console.log('[LIFE-OS] init() PHASE 3: Completing restoration phase');
    state.isRestoringTask = false;

    // PHASE 4: If task was restored, ensure UI is fully synced
    if (restoredTask) {
      console.log('[LIFE-OS] init() PHASE 4: Syncing restored task UI');
      updateLivePanel();
      tickTimer();
      updateSystemStatus();
      showToast(`Resumed: ${formatTaskLabel(restoredTask.main, restoredTask.sub)}`);
    }

    // Ensure active task is persisted whenever it changes, not just on unload
    // NOTE: beforeunload only SAVES the active task. It NEVER removes or clears it.
    window.addEventListener('beforeunload', () => {
      saveCurrentActiveTask();
      console.log('[LIFE-OS] beforeunload: active task saved');
    });
    window.addEventListener('pagehide', saveCurrentActiveTask);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') saveCurrentActiveTask();
    });

    // Live clock + timer tick every second
    setInterval(tickTimer, 1000);
    tickTimer();

    console.log('%c LIFE-OS ONLINE ', 'background:#00ff9d;color:#000;font-weight:bold;padding:4px 8px;');
    console.log('Press any mapped key to start tracking. Ctrl+K settings, ` overlay.');
  }

  // Boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();


