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
  const LAUNCH_SPLASH_SETTLE_MS = 160;
  const TIMELINE_PANEL_STATE_KEY = 'lifeos_timeline_panel_state';
  const SCHEDULE_KEY = 'schedules';
  const REMINDER_STATE_KEY = 'schedule_reminders';

  const DEFAULT_PREFS = {
    subtaskWaitMs: 2000,
    soundEnabled: true,
    reminderDelivery: 'notification',
    reminderTone: 'gentle',
    reminderVibration: 'medium',
    reminderVolume: 55,
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
    timelinePanels: { mission: true, taskSummary: false },
    lastActivity: Date.now(),
    analyticsTick: 0,
    selectedMainKeys: new Set(),
    selectedSubKeys: new Set(),
    activeUserId: 'user1',
    users: [],
    chartRange: 'today',
    timelineRange: 'today',
    deferredInstallPrompt: null,
    commandCentreExpanded: new Set(),
    isRestoringTask: false,
    schedules: [], reminderQueue: [], reminderVisible: false, activeReminder: null, alarmTimers: [], vibrationTimer: null,
    appearance: null, themeRefreshTimer: null
  };

  const THEME_DEFINITIONS = {
    'midnight-black': { name: 'Midnight Black', background: '#050608', panel: '#0a0e14', panelAlt: '#0f1419', border: '#1a2a3a', text: '#ffffff', muted: '#aab6c1', primary: '#00cc83', secondary: '#00b4ff', accent: '#00ff9d', success: '#00cc83', warning: '#ffaa00', error: '#ff3355', productive: '#1e7bff', neutral: '#00ff9d', distraction: '#ff3355' },
    'purple-focus': { name: 'Purple Focus', background: '#090711', panel: '#110f1b', panelAlt: '#191626', border: '#39304d', text: '#f8f4ff', muted: '#b9aecb', primary: '#9d75ec', secondary: '#c292ff', accent: '#c39bff', success: '#53d7a1', warning: '#f4bd61', error: '#ff718a', productive: '#a98bff', neutral: '#53d7a1', distraction: '#ff718a' },
    'emerald-productivity': { name: 'Emerald Productivity', background: '#07110d', panel: '#0b1711', panelAlt: '#122119', border: '#294638', text: '#f2fff7', muted: '#a9c6b4', primary: '#34bf82', secondary: '#60c9bd', accent: '#64e6a8', success: '#46d690', warning: '#e9bd60', error: '#ff6d72', productive: '#39bd78', neutral: '#64e6a8', distraction: '#ff6d72' },
    'arctic-light': { name: 'Arctic Light', background: '#eef2f6', panel: '#ffffff', panelAlt: '#e5ebf1', border: '#c6d0da', text: '#192633', muted: '#526272', primary: '#176da5', secondary: '#4a708e', accent: '#13744d', success: '#167245', warning: '#8a5700', error: '#ad293b', productive: '#176da5', neutral: '#167245', distraction: '#ad293b' },
    'crimson-command': { name: 'Crimson Command', background: '#10090c', panel: '#190e13', panelAlt: '#23131a', border: '#4a2832', text: '#fff5f6', muted: '#d0adb6', primary: '#d83e59', secondary: '#ed897e', accent: '#ff6479', success: '#63d2a0', warning: '#f2bb55', error: '#ff536b', productive: '#e66a7b', neutral: '#63d2a0', distraction: '#ff536b' }
  };
  const DEFAULT_APPEARANCE = {
    themeId: 'midnight-black', customColors: null, layout: 'balanced', textSize: 'normal', accessibility: false,
    visible: { timer: true, summary: true, activityLog: true, recent: true, analytics: true, upcoming: true, reminderWidget: true },
    mainCardOrder: ['livePanel', 'panelTimeline', 'right-column'],
    cardOrder: ['upcomingPanel', 'reminderWidget', 'panel-analytics', 'panel-recent']
  };

  function setupLaunchSplash() {
    const splash = document.getElementById('launchSplash');
    if (!splash) return;

    try {
      if (sessionStorage.getItem(LAUNCH_SPLASH_KEY) === '1') {
        splash.remove();
        document.documentElement.classList.remove('splash-pending', 'splash-running');
        return;
      }
      sessionStorage.setItem(LAUNCH_SPLASH_KEY, '1');
    } catch (error) {
      splash.remove();
      document.documentElement.classList.remove('splash-pending', 'splash-running');
      return;
    }

    const dismiss = () => {
      splash.classList.add('is-dismissed');
      splash.remove();
      document.documentElement.classList.remove('splash-pending', 'splash-running');
      document.documentElement.classList.add('splash-complete');
    };

    const handleSplashAnimationEnd = (event) => {
      if (event.target !== splash) return;
      splash.removeEventListener('animationend', handleSplashAnimationEnd);
      dismiss();
    };

    splash.addEventListener('animationend', handleSplashAnimationEnd);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.setTimeout(() => {
          document.documentElement.classList.remove('splash-pending');
          document.documentElement.classList.add('splash-running');
        }, LAUNCH_SPLASH_SETTLE_MS);
      });
    });
    window.setTimeout(dismiss, LAUNCH_SPLASH_SETTLE_MS + 2700);
  }

  function userPrefix() {
    return STORAGE_PREFIX + 'u_' + state.activeUserId + '_';
  }

  function loadAppearance() {
    try {
      const saved = JSON.parse(localStorage.getItem(userPrefix() + 'appearance') || 'null');
      state.appearance = { ...JSON.parse(JSON.stringify(DEFAULT_APPEARANCE)), ...(saved || {}), visible: { ...DEFAULT_APPEARANCE.visible, ...(saved?.visible || {}) }, mainCardOrder: Array.isArray(saved?.mainCardOrder) ? saved.mainCardOrder : [...DEFAULT_APPEARANCE.mainCardOrder], cardOrder: Array.isArray(saved?.cardOrder) ? saved.cardOrder : [...DEFAULT_APPEARANCE.cardOrder] };
    } catch (_) { state.appearance = JSON.parse(JSON.stringify(DEFAULT_APPEARANCE)); }
    applyTheme(false);
    applyUiAppearance(false);
  }
  function saveAppearance() { localStorage.setItem(userPrefix() + 'appearance', JSON.stringify(state.appearance)); }
  function hexRgb(hex) {
    const value = String(hex || '').replace('#', '');
    if (!/^[0-9a-f]{6}$/i.test(value)) return [0, 0, 0];
    return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
  }
  function blendHex(a, b, amount) {
    const first = hexRgb(a); const second = hexRgb(b);
    return '#' + first.map((value, index) => Math.round(value * (1 - amount) + second[index] * amount).toString(16).padStart(2, '0')).join('');
  }
  function contrastRatio(first, second) {
    const luminance = (hex) => {
      const channels = hexRgb(hex).map((channel) => channel / 255).map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
    return (values[0] + 0.05) / (values[1] + 0.05);
  }
  function customThemeDefinition() {
    const saved = state.appearance.customColors || {};
    const base = THEME_DEFINITIONS['midnight-black'];
    const colors = { primary: saved.primary || base.primary, secondary: saved.secondary || base.secondary, accent: saved.accent || base.accent, background: saved.background || base.background, text: saved.text || base.text, success: saved.success || base.success, warning: saved.warning || base.warning, error: saved.error || base.error };
    const light = contrastRatio(colors.background, '#ffffff') < 1.6;
    const surface = light ? '#ffffff' : '#000000';
    return { ...base, name: 'Custom', ...colors, panel: blendHex(colors.background, surface, 0.08), panelAlt: blendHex(colors.background, surface, 0.15), border: blendHex(colors.background, colors.text, 0.24), muted: blendHex(colors.text, colors.background, 0.35), productive: colors.primary, neutral: colors.success, distraction: colors.error };
  }
  function applyTheme(persist = true, updateControls = true) {
    const id = state.appearance?.themeId || DEFAULT_APPEARANCE.themeId;
    const theme = id === 'custom' ? customThemeDefinition() : (THEME_DEFINITIONS[id] || THEME_DEFINITIONS['midnight-black']);
    const root = document.documentElement;
    root.dataset.theme = id;
    const alpha = (color, amount) => { const rgb = hexRgb(color); return 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + amount + ')'; };
    const values = {
      '--bg-deep': theme.background, '--bg-panel': theme.panel, '--bg-panel-alt': theme.panelAlt, '--border': theme.border,
      '--text': theme.text, '--text-dim': theme.muted, '--text-muted': theme.muted,
      '--primary-color': theme.primary, '--accent': theme.accent, '--accent-dim': blendHex(theme.accent, theme.background, 0.28),
      '--secondary': theme.secondary, '--blue': theme.secondary, '--success': theme.success, '--amber': theme.warning, '--warning': theme.warning,
      '--red': theme.error, '--error': theme.error, '--productive': theme.productive, '--distraction': theme.distraction, '--neutral': theme.neutral,
      '--productive-dim': alpha(theme.productive, 0.15), '--distraction-dim': alpha(theme.distraction, 0.15), '--neutral-dim': alpha(theme.neutral, 0.15),
      '--chart-productive': theme.productive, '--chart-neutral': theme.neutral, '--chart-distraction': theme.distraction, '--chart-other': theme.border,
      '--chart-text': theme.text, '--chart-panel': theme.panel, '--chart-deep': theme.background, '--chart-border': theme.border,
      '--chart-primary': theme.primary, '--chart-secondary': theme.secondary, '--chart-warning': theme.warning, '--chart-error': theme.error,
      '--chart-1': theme.productive, '--chart-2': theme.neutral, '--chart-3': theme.distraction, '--chart-4': theme.warning,
      '--chart-5': theme.secondary, '--chart-6': theme.primary, '--chart-7': theme.accent, '--chart-8': theme.text, '--chart-9': theme.muted,
      '--border-glow': alpha(theme.accent, 0.2), '--glow-green': '0 0 20px ' + alpha(theme.accent, 0.34) + ', 0 0 40px ' + alpha(theme.accent, 0.13),
      '--glow-blue': '0 0 15px ' + alpha(theme.secondary, 0.28), '--font-scale': state.appearance?.textSize === 'compact' ? '0.92' : state.appearance?.textSize === 'large' ? '1.12' : '1'
    };
    Object.entries(values).forEach(([key, value]) => root.style.setProperty(key, value));
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.background);
    if (updateControls) updateThemeControls(theme);
    updateContrastFeedback(theme);
    if (persist && state.appearance) saveAppearance();
    clearTimeout(state.themeRefreshTimer);
    state.themeRefreshTimer = setTimeout(renderChartsIfOpen, 100);
  }
  function updateThemeControls(theme) {
    const selector = document.getElementById('themePreset');
    if (selector) selector.value = state.appearance.themeId;
    document.getElementById('customThemeSection')?.classList.toggle('is-custom-active', state.appearance.themeId === 'custom');
    document.querySelectorAll('[data-custom-color]').forEach((input) => {
      const key = input.dataset.customColor;
      const source = state.appearance.customColors || {};
      const value = source[key] || ({ primary: theme.primary, secondary: theme.secondary, accent: theme.accent, background: theme.background, text: theme.text, success: theme.success, warning: theme.warning, error: theme.error })[key];
      if (value && input.value.toLowerCase() !== value.toLowerCase()) input.value = value;
    });
    const holder = document.getElementById('themeSwatches');
    if (holder) holder.innerHTML = Object.entries(THEME_DEFINITIONS).map(([themeId, item]) => '<button type="button" class="theme-swatch ' + (themeId === state.appearance.themeId ? 'selected' : '') + '" data-theme-choice="' + themeId + '" aria-label="Apply ' + item.name + '"><span style="--swatch-bg:' + item.background + ';--swatch-panel:' + item.panel + ';--swatch-accent:' + item.accent + '"></span><small>' + item.name + '</small></button>').join('');
  }
  function chooseTheme(id) {
    if (id === 'custom' && !state.appearance.customColors) {
      const active = THEME_DEFINITIONS[state.appearance.themeId] || THEME_DEFINITIONS['midnight-black'];
      state.appearance.customColors = { primary: active.primary, secondary: active.secondary, accent: active.accent, background: active.background, text: active.text, success: active.success, warning: active.warning, error: active.error };
    }
    state.appearance.themeId = id;
    applyTheme(true);
  }
  function updateContrastFeedback(theme) {
    const feedback = document.getElementById('contrastFeedback');
    if (!feedback) return;
    const readable = contrastRatio(theme.background, theme.text) >= 4.5 && contrastRatio(theme.panel, theme.text) >= 4.5 && contrastRatio(theme.background, theme.accent) >= 3 && contrastRatio(theme.panel, theme.primary) >= 3;
    feedback.classList.toggle('contrast-warning', !readable);
    feedback.textContent = readable ? 'Color contrast looks good.' : 'Low contrast detected. Adjust Text, Accent, Primary, or Background for easier reading.';
  }
  function applyUiAppearance(persist = true) {
    const settings = state.appearance || DEFAULT_APPEARANCE;
    document.body.dataset.layout = settings.layout || 'balanced';
    document.body.dataset.textSize = settings.textSize || 'normal';
    document.body.classList.toggle('accessibility-mode', !!settings.accessibility);
    const visibilityTargets = {
      timer: document.getElementById('livePanel'), recent: document.querySelector('.panel-recent'),
      analytics: document.querySelector('.panel-analytics'), upcoming: document.getElementById('upcomingPanel'),
      reminderWidget: document.getElementById('reminderWidget')
    };
    Object.entries(visibilityTargets).forEach(([key, element]) => { if (element) element.classList.toggle('custom-hidden', settings.visible[key] === false); });
    const rightColumn = document.querySelector('.right-column');
    const sideEmpty = ['upcoming', 'reminderWidget', 'analytics', 'recent'].every((key) => settings.visible[key] === false);
    if (rightColumn) rightColumn.classList.toggle('custom-hidden', sideEmpty);
    document.body.classList.toggle('dashboard-side-empty', sideEmpty);
    const summary = document.getElementById('timelineSummary');
    const tabs = document.getElementById('timelineRangeTabs');
    const list = document.getElementById('timelineList');
    const showSummary = settings.visible.summary !== false;
    const showLog = settings.visible.activityLog !== false;
    if (summary) summary.classList.toggle('custom-hidden', !showSummary);
    if (tabs) tabs.classList.toggle('custom-hidden', !showLog);
    if (list) list.classList.toggle('custom-hidden', !showLog);
    document.querySelector('.panel-timeline')?.classList.toggle('custom-hidden', !showSummary && !showLog);
    document.body.classList.toggle('dashboard-no-timer', settings.visible.timer === false);
    document.body.classList.toggle('dashboard-no-timeline', !showSummary && !showLog);
    state.appearance.mainCardOrder.forEach((id, index) => {
      const card = id === 'right-column' ? document.querySelector('.right-column') : document.getElementById(id);
      if (card) card.style.order = index;
    });
    state.appearance.cardOrder.forEach((id, index) => { const card = document.getElementById(id) || document.querySelector('.' + id); if (card) card.style.order = index; });
    document.querySelectorAll('[data-ui-visible]').forEach((input) => { input.checked = settings.visible[input.dataset.uiVisible] !== false; });
    document.querySelectorAll('[data-layout]').forEach((button) => button.classList.toggle('active', button.dataset.layout === settings.layout));
    document.querySelectorAll('[data-text-size]').forEach((button) => button.classList.toggle('active', button.dataset.textSize === settings.textSize));
    const accessibility = document.getElementById('accessibilityMode');
    if (accessibility) accessibility.checked = !!settings.accessibility;
    renderCardOrderControls();
    if (persist) saveAppearance();
  }
  function renderCardOrderControls() {
    const labels = { livePanel: 'Timer', panelTimeline: 'Activity Log & Summary', 'right-column': 'Side Column', upcomingPanel: 'Upcoming Schedule', reminderWidget: 'Reminder Widget', 'panel-analytics': 'Quick Analytics', 'panel-recent': 'Last 5 Activities' };
    const render = (order, key) => order.map((id, index) => {
      const name = labels[id] || id;
      return '<div class="card-order-row"><span>' + name + '</span><button type="button" data-order-key="' + key + '" data-move-card="' + index + '" data-direction="-1" aria-label="Move ' + name + ' up" ' + (index === 0 ? 'disabled' : '') + '>↑</button><button type="button" data-order-key="' + key + '" data-move-card="' + index + '" data-direction="1" aria-label="Move ' + name + ' down" ' + (index === order.length - 1 ? 'disabled' : '') + '>↓</button></div>';
    }).join('');
    const main = document.getElementById('mainCardOrderControls');
    const side = document.getElementById('cardOrderControls');
    if (main) main.innerHTML = render(state.appearance.mainCardOrder, 'mainCardOrder');
    if (side) side.innerHTML = render(state.appearance.cardOrder, 'cardOrder');
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

    state.reminderQueue = [];
    state.reminderVisible = false;
    state.activeReminder = null;
    stopReminderDelivery();
    closeModal('reminderModal');
    saveCurrentActiveTask();
    cancelSubtaskWait();
    state.activeUserId = userId;
    saveUsers();
    loadPreferences();
    loadMappings();
    loadSchedules();
    restoreCurrentActiveTask();
    refreshAllUI();
    renderSchedules();
    checkScheduleReminders();
    showToast('Switched to ' + getActiveUserName());
  }

  // ─── Planned schedules (separate from tracked activity logs) ──
  function loadSchedules() {
    try {
      const list = JSON.parse(localStorage.getItem(userPrefix() + SCHEDULE_KEY) || '[]');
      state.schedules = Array.isArray(list) ? list.filter((item) => item && item.id && Number.isFinite(Number(item.startTimestamp)) && Number.isFinite(Number(item.endTimestamp))) : [];
    } catch (_) { state.schedules = []; }
  }
  function saveSchedules() { localStorage.setItem(userPrefix() + SCHEDULE_KEY, JSON.stringify(state.schedules)); }
  function getScheduleStatus(item, now = Date.now()) {
    if (!item.enabled) return 'Disabled';
    if (now < item.startTimestamp) return 'Upcoming';
    if (now < item.endTimestamp) return 'Active window';
    return reminderMarkers()[item.id]?.started ? 'Completed' : 'Missed';
  }
  function markScheduleStarted(id) {
    const marks = reminderMarkers();
    marks[id] = { ...(marks[id] || {}), started: true };
    localStorage.setItem(userPrefix() + REMINDER_STATE_KEY, JSON.stringify(marks));
  }
  function scheduleTime(ts, dateOnly = false) {
    return new Intl.DateTimeFormat(undefined, dateOnly ? { weekday: 'short', month: 'short', day: 'numeric' } : { hour: 'numeric', minute: '2-digit' }).format(new Date(ts));
  }
  function deliveryLabel(mode = 'notification') {
    return ({ notification: 'Notification only', alarm: 'Alarm only', vibration: 'Vibration only', 'notification-alarm': 'Notification + alarm', 'notification-vibration': 'Notification + vibration', 'alarm-vibration': 'Alarm + vibration', all: 'Notification + alarm + vibration' })[mode] || 'Notification only';
  }
  function renderSchedules() {
    const list = document.getElementById('scheduleList');
    const upcoming = document.getElementById('upcomingContent');
    if (!list || !upcoming) return;
    const now = Date.now();
    const ordered = [...state.schedules].sort((a, b) => a.startTimestamp - b.startTimestamp);
    list.innerHTML = ordered.length ? ordered.map((item) => {
      const status = getScheduleStatus(item, now);
      return `<article class="schedule-card"><div class="schedule-card-main"><div class="schedule-card-title">${escapeHtml(item.activityName)}</div><div class="schedule-card-meta">${scheduleTime(item.startTimestamp, true)} · ${scheduleTime(item.startTimestamp)}–${scheduleTime(item.endTimestamp)} · ${escapeHtml(item.category)}</div><div class="schedule-delivery-label">${deliveryLabel(item.delivery || state.prefs.reminderDelivery)}</div>${item.description ? `<p>${escapeHtml(item.description)}</p>` : ''}</div><span class="schedule-status status-${status.toLowerCase().replaceAll(' ', '-')}">${status}</span><label class="schedule-toggle" title="Enable reminders"><input type="checkbox" data-schedule-toggle="${item.id}" ${item.enabled ? 'checked' : ''}><span>Enabled</span></label><button class="btn btn-sm" data-schedule-edit="${item.id}" type="button">Edit</button><button class="btn btn-sm btn-danger" data-schedule-delete="${item.id}" type="button">Delete</button></article>`;
    }).join('') : '<div class="schedule-empty">No plans yet. Add a schedule to make space for what matters.</div>';
    const next = ordered.find((item) => item.enabled && item.endTimestamp > now);
    upcoming.innerHTML = next ? `<div class="upcoming-name">${escapeHtml(next.activityName)}</div><div class="upcoming-meta">${scheduleTime(next.startTimestamp, true)} · ${scheduleTime(next.startTimestamp)}${now < next.startTimestamp ? ` · ${formatRemaining(next.startTimestamp - now)}` : ' · In progress'}</div><button class="btn btn-primary btn-sm" type="button" data-schedule-start="${next.id}">Start activity</button>` : '<div class="upcoming-empty">Nothing scheduled next.</div>';
  }
  function formatRemaining(ms) {
    const minutes = Math.max(0, Math.ceil(ms / 60000));
    if (minutes < 60) return `In ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    return `In ${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ''}`;
  }
  function openScheduleEditor(item = null) {
    const form = document.getElementById('scheduleForm');
    form.reset();
    document.getElementById('scheduleId').value = item?.id || '';
    document.getElementById('scheduleEditorTitle').textContent = item ? 'Edit schedule' : 'New schedule';
    document.getElementById('scheduleName').value = item?.activityName || '';
    document.getElementById('scheduleCategory').value = item?.category || 'study';
    const date = item ? new Date(item.startTimestamp) : new Date();
    document.getElementById('scheduleDate').value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    document.getElementById('scheduleStart').value = item ? `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` : '09:00';
    const endDate = item ? new Date(item.endTimestamp) : null;
    document.getElementById('scheduleEnd').value = item ? `${String(endDate.getHours()).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')}` : '10:00';
    document.getElementById('scheduleDescription').value = item?.description || '';
    document.getElementById('scheduleDelivery').value = item?.delivery || state.prefs.reminderDelivery || 'notification';
    document.getElementById('scheduleTone').value = item?.tone || state.prefs.reminderTone || 'gentle';
    document.getElementById('scheduleVibration').value = item?.vibration || state.prefs.reminderVibration || 'medium';
    document.getElementById('scheduleVolume').value = item?.volume ?? state.prefs.reminderVolume ?? 55;
    document.getElementById('scheduleVolumeValue').textContent = `${document.getElementById('scheduleVolume').value}%`;
    document.getElementById('scheduleEnabled').checked = item ? !!item.enabled : true;
    openModal('scheduleEditorModal');
  }
  function scheduleFromForm() {
    const id = document.getElementById('scheduleId').value;
    const day = document.getElementById('scheduleDate').value;
    const start = new Date(`${day}T${document.getElementById('scheduleStart').value}`).getTime();
    let end = new Date(`${day}T${document.getElementById('scheduleEnd').value}`).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end)) { showToast('Choose a valid date and time', 'error'); return; }
    if (end <= start) { showToast('End time must be after start time', 'error'); return; }
    const previous = state.schedules.find((item) => item.id === id);
    const item = { id: id || (crypto.randomUUID ? crypto.randomUUID() : `schedule-${Date.now()}-${Math.random()}`), activityName: document.getElementById('scheduleName').value.trim(), category: document.getElementById('scheduleCategory').value, startTimestamp: start, endTimestamp: end, enabled: document.getElementById('scheduleEnabled').checked, description: document.getElementById('scheduleDescription').value.trim(), delivery: document.getElementById('scheduleDelivery').value, tone: document.getElementById('scheduleTone').value, vibration: document.getElementById('scheduleVibration').value, volume: Number(document.getElementById('scheduleVolume').value), createdAt: previous?.createdAt || Date.now(), updatedAt: Math.max(Date.now(), Number(previous?.updatedAt || 0) + 1) };
    if (!item.activityName) { showToast('Enter an activity name', 'error'); return; }
    state.schedules = previous ? state.schedules.map((schedule) => schedule.id === id ? item : schedule) : [...state.schedules, item];
    // A changed schedule gets fresh delivery markers; deleted/disabled plans cannot leave old reminders pending.
    clearReminderMarkers(id);
    if (id) cancelScheduleReminders(id);
    saveSchedules(); renderSchedules(); closeModal('scheduleEditorModal'); checkScheduleReminders();
    showToast(previous ? 'Schedule updated' : 'Schedule added');
  }
  function reminderMarkers() {
    try { return JSON.parse(localStorage.getItem(userPrefix() + REMINDER_STATE_KEY) || '{}'); } catch (_) { return {}; }
  }
  function clearReminderMarkers(id) {
    const marks = reminderMarkers();
    if (id) delete marks[id];
    else Object.keys(marks).forEach((key) => { if (!state.schedules.some((item) => item.id === key)) delete marks[key]; });
    localStorage.setItem(userPrefix() + REMINDER_STATE_KEY, JSON.stringify(marks));
  }
  function cancelScheduleReminders(id) {
    state.reminderQueue = state.reminderQueue.filter((reminder) => reminder.item.id !== id);
    if (state.activeReminder?.item.id === id) {
      stopReminderDelivery(); closeModal('reminderModal'); state.reminderVisible = false; state.activeReminder = null; showNextReminder();
    }
  }
  function checkScheduleReminders() {
    if (!state.schedules) return;
    const now = Date.now(); const marks = reminderMarkers();
    state.schedules.forEach((item) => {
      if (!item.enabled) return;
      ['start', 'end'].forEach((kind) => {
        const key = `${kind}:${item.updatedAt}`;
        if (now >= (kind === 'start' ? item.startTimestamp : item.endTimestamp) && marks[item.id]?.[kind] !== key) {
          marks[item.id] = { ...(marks[item.id] || {}), [kind]: key };
          state.reminderQueue.push({ item, kind });
        }
      });
    });
    localStorage.setItem(userPrefix() + REMINDER_STATE_KEY, JSON.stringify(marks));
    renderSchedules();
    showNextReminder();
  }
  function showNextReminder() {
    if (state.reminderVisible || !state.reminderQueue.length) return;
    const reminder = state.reminderQueue.shift(); const { item, kind } = reminder;
    if (!state.schedules.some((current) => current.id === item.id && current.enabled && current.updatedAt === item.updatedAt)) { showNextReminder(); return; }
    state.reminderVisible = true;
    state.activeReminder = reminder;
    const start = kind === 'start';
    document.getElementById('reminderKicker').textContent = start ? 'START REMINDER' : 'END REMINDER';
    document.getElementById('reminderTitle').textContent = start ? `Time to start: ${item.activityName}` : `${item.activityName} has reached its scheduled end time`;
    document.getElementById('reminderMessage').textContent = `${scheduleTime(item.startTimestamp)}–${scheduleTime(item.endTimestamp)} · ${start ? 'Your planned session is ready when you are.' : 'Your planned session has ended. Choose what happens next.'}`;
    const actions = start ? [['Start activity', 'start'], ['Snooze 5 min', 'snooze'], ['Dismiss', 'dismiss']] : [['Stop current activity', 'stop'], ['Continue', 'continue'], ['Log activity', 'log'], ['Snooze 5 min', 'snooze'], ['Dismiss', 'dismiss']];
    actions.push(['Open Schedule', 'open-schedule'], ['Mission Control', 'open-mission']);
    document.getElementById('reminderActions').innerHTML = actions.map(([label, action]) => `<button class="btn ${action === 'start' || action === 'stop' ? 'btn-primary' : ''}" type="button" data-reminder-action="${action}" data-reminder-id="${item.id}" data-reminder-name="${escapeHtml(item.activityName)}">${label}</button>`).join('');
    openModal('reminderModal');
    deliverReminder(item, kind);
  }
  function handleReminderAction(action, id, name) {
    if (action === 'open-schedule' || action === 'open-mission') {
      stopReminderDelivery(); closeModal('reminderModal'); state.reminderVisible = false; state.activeReminder = null;
      document.querySelector(`[data-screen="${action === 'open-schedule' ? 'schedule' : 'mission'}"]`)?.click(); showNextReminder(); return;
    }
    const reminderKind = state.activeReminder?.kind || 'start';
    const reminderVersion = state.activeReminder?.item.updatedAt;
    stopReminderDelivery();
    closeModal('reminderModal'); state.reminderVisible = false; state.activeReminder = null;
    if (action === 'start') {
      const key = Object.keys(state.mappings.mainTasks).find((candidate) => state.mappings.mainTasks[candidate].toLowerCase() === name.toLowerCase()) || null;
      startTask(name, null, key); saveCurrentActiveTask(); updateLivePanel(); updateSystemStatus();
      markScheduleStarted(id);
    } else if (action === 'stop' && state.currentTask) endCurrentTask(new Date());
    else if (action === 'log') {
      const planned = state.schedules.find((item) => item.id === id);
      if (planned) {
        saveTaskSegmentsByDay({ main: planned.activityName, sub: null }, planned.startTimestamp, planned.endTimestamp);
        renderTimeline(); renderRecent(); renderAnalytics(); renderChartsIfOpen(); updateTodaySummary();
        showToast(`Logged planned session: ${planned.activityName}`);
      }
    } else if (action === 'snooze') {
      setTimeout(() => { const item = state.schedules.find((schedule) => schedule.id === id); if (!item || !item.enabled || item.updatedAt !== reminderVersion) return; state.reminderQueue.push({ item, kind: reminderKind, snoozed: true }); showNextReminder(); }, 5 * 60 * 1000);
    }
    showNextReminder();
  }

  const ALARM_TONES = {
    gentle: { notes: [660, 880], gap: 210 },
    chime: { notes: [880, 1175, 988], gap: 180 },
    pulse: { notes: [520, 520, 780], gap: 140 }
  };
  const VIBRATION_PATTERNS = { short: [130], medium: [320], long: [650], repeated: [180, 130, 180, 130, 280] };
  function stopReminderDelivery() {
    state.alarmTimers.forEach((timer) => clearInterval(timer)); state.alarmTimers = [];
    if (state.vibrationTimer) clearInterval(state.vibrationTimer);
    state.vibrationTimer = null;
    try { if (navigator.vibrate) navigator.vibrate(0); } catch (_) { /* unsupported device */ }
  }
  function playAlarmBurst(toneName, volume) {
    if (!audioCtx || volume <= 0) return;
    try {
      const tone = ALARM_TONES[toneName] || ALARM_TONES.gentle;
      const now = audioCtx.currentTime;
      tone.notes.forEach((frequency, index) => {
        const oscillator = audioCtx.createOscillator(); const gain = audioCtx.createGain();
        oscillator.type = 'sine'; oscillator.frequency.value = frequency;
        const start = now + (tone.gap * index) / 1000; const end = start + 0.16;
        gain.gain.setValueAtTime(Math.max(0.005, Math.min(100, volume) / 100 * 0.17), start);
        gain.gain.exponentialRampToValueAtTime(0.001, end);
        oscillator.connect(gain); gain.connect(audioCtx.destination); oscillator.start(start); oscillator.stop(end);
      });
    } catch (error) { console.warn('Alarm audio unavailable:', error); }
  }
  function previewAlarm(toneName, volume) {
    if (!audioCtx) { showToast('Audio is unavailable in this browser', 'error'); return; }
    try { audioCtx.resume().then(() => playAlarmBurst(toneName, volume)).catch(() => showToast('Tap to preview when audio is allowed', 'error')); }
    catch (_) { showToast('Audio preview is unavailable', 'error'); }
  }
  function sendSystemReminder(title, item, kind) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const options = { body: 'Open LIFE-OS to choose an action.', tag: `${item.id}-${kind}-${item.updatedAt}`, silent: true };
    const fallback = () => {
      try {
        const notice = new Notification(title, options);
        notice.onclick = () => { window.focus(); notice.close(); };
      } catch (error) { console.warn('System notification unavailable:', error); }
    };
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then((registration) => {
        if (registration.showNotification) return registration.showNotification(title, options);
        fallback();
      }).catch(fallback);
    } else fallback();
  }
  function deliverReminder(item, kind) {
    const delivery = item.delivery || state.prefs.reminderDelivery || 'notification';
    const wantsNotification = delivery === 'notification' || delivery.startsWith('notification-') || delivery === 'all';
    const wantsAlarm = delivery === 'alarm' || delivery.includes('alarm') || delivery === 'all';
    const wantsVibration = delivery === 'vibration' || delivery.includes('vibration') || delivery === 'all';
    if (wantsNotification && 'Notification' in window && Notification.permission === 'granted') {
      sendSystemReminder(kind === 'start' ? `Time to start: ${item.activityName}` : `${item.activityName} session ended`, item, kind);
    } else if (wantsNotification && 'Notification' in window && Notification.permission === 'denied') {
      showToast('System notifications are blocked; in-app reminder shown', 'error');
    }
    if (wantsAlarm) {
      if (!audioCtx) showToast('Alarm audio is unavailable; reminder remains on screen', 'error');
      else {
        try { audioCtx.resume().then(() => { if (state.activeReminder?.item.id !== item.id || state.activeReminder?.kind !== kind) return; playAlarmBurst(item.tone || state.prefs.reminderTone, item.volume ?? state.prefs.reminderVolume ?? 55); state.alarmTimers.push(setInterval(() => playAlarmBurst(item.tone || state.prefs.reminderTone, item.volume ?? state.prefs.reminderVolume ?? 55), 2200)); }).catch(() => showToast('Audio blocked by browser; reminder remains on screen', 'error')); }
        catch (_) { showToast('Audio blocked by browser; reminder remains on screen', 'error'); }
      }
    }
    if (wantsVibration) {
      if (typeof navigator.vibrate !== 'function') showToast('Vibration is unavailable on this device', 'error');
      else {
        const pattern = VIBRATION_PATTERNS[item.vibration || state.prefs.reminderVibration] || VIBRATION_PATTERNS.medium;
        try {
          if (navigator.vibrate(pattern) === false) { showToast('Vibration is unavailable on this device', 'error'); return; }
          if ((item.vibration || state.prefs.reminderVibration) === 'repeated') state.vibrationTimer = setInterval(() => { try { navigator.vibrate(pattern); } catch (_) { clearInterval(state.vibrationTimer); } }, 1500);
        } catch (_) { showToast('Vibration is unavailable on this device', 'error'); }
      }
    }
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
    state.appearance = JSON.parse(JSON.stringify(DEFAULT_APPEARANCE));
    applyTheme(false);
    applyUiAppearance(false);
    state.schedules = [];
    state.reminderQueue = [];
    state.reminderVisible = false;
    state.activeReminder = null;
    stopReminderDelivery();
    closeModal('reminderModal');
    state.currentTask = null;
    cancelSubtaskWait();
    removeActiveTask();
    refreshAllUI();
    renderSchedules();
    showToast('User data cleared');
  }

  function refreshAllUI() {
    refreshMappingUI();
    updateLivePanel();
    renderTimeline();
    renderRecent();
    renderAnalytics();
    renderChartsIfOpen();
    updateTodaySummary();
    updateSystemStatus();
    renderUserSelect();
    renderUsersList();
  }

  function getEntriesForRange(range) {
    const normalizedRange = range === 'day' ? 'today' : range;
    return getTimelineRangeModel(normalizedRange).entries;
  }

  function renderChartsDashboard() {
    const container = document.getElementById('chartsContainer');
    if (!container) return;

    if (!window.LifeOSCharts) {
      container.innerHTML = '<p class="chart-error">Charts failed to load. Refresh the page or check that charts.js is present.</p>';
      return;
    }

    try {
      const range = state.chartRange === 'day' ? 'today' : state.chartRange;
      const model = getTimelineRangeModel(range);
      const entries = model.entries;
      LifeOSCharts.renderChartsPanel(container, entries, getCategory, {
        range,
        model
      });
    } catch (err) {
      console.error('Chart render error:', err);
      container.innerHTML = '<p class="chart-error">Could not draw charts. See console for details.</p>';
    }
  }

  function renderChartsIfOpen() {
    const modal = document.getElementById('chartsModal');
    const detailOverlay = document.getElementById('chartDetailOverlay');
    const detailOpen = detailOverlay && !detailOverlay.classList.contains('hidden');
    if (modal && !modal.classList.contains('hidden') && !detailOpen) renderChartsDashboard();
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
    const btn = document.getElementById('btnMobileKeys');
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
    applyDeliveryDefaultsToUI();
    loadAppearance();
  }
  function applyDeliveryDefaultsToUI() {
    const delivery = document.getElementById('defaultDelivery'); if (!delivery) return;
    delivery.value = state.prefs.reminderDelivery || DEFAULT_PREFS.reminderDelivery;
    document.getElementById('defaultTone').value = state.prefs.reminderTone || DEFAULT_PREFS.reminderTone;
    document.getElementById('defaultVibration').value = state.prefs.reminderVibration || DEFAULT_PREFS.reminderVibration;
    document.getElementById('defaultVolume').value = state.prefs.reminderVolume ?? DEFAULT_PREFS.reminderVolume;
  }
  function saveDeliveryDefaults() {
    state.prefs.reminderDelivery = document.getElementById('defaultDelivery').value;
    state.prefs.reminderTone = document.getElementById('defaultTone').value;
    state.prefs.reminderVibration = document.getElementById('defaultVibration').value;
    state.prefs.reminderVolume = Number(document.getElementById('defaultVolume').value);
    localStorage.setItem(userPrefix() + 'prefs', JSON.stringify(state.prefs));
    showToast('Defaults saved for new schedules');
  }

  function savePreferences() {
    state.prefs.subtaskWaitMs = parseInt(document.getElementById('prefSubtaskWait').value, 10);
    state.prefs.soundEnabled = document.getElementById('prefSound').checked;
    state.prefs.timelineNewestFirst = document.getElementById('prefTimelineNewest').checked;
    state.prefs.clockFormat = document.getElementById('prefClockFormat').value;
    state.soundEnabled = state.prefs.soundEnabled;
    localStorage.setItem(userPrefix() + 'prefs', JSON.stringify(state.prefs));
    applyPreferencesToUI();
    refreshAllUI();
    tickTimer();
    showToast('Preferences saved');
  }

  function applyPreferencesToUI() {
    const waitSel = document.getElementById('prefSubtaskWait');
    if (waitSel) waitSel.value = String(state.prefs.subtaskWaitMs);
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
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function entryIdentity(entry) {
    return [
      entry.start || entry.startTime || '',
      entry.end || '',
      entry.main || '',
      entry.sub || '',
      entry.durationMs || ''
    ].join('|');
  }

  function emptyDayData() {
    return { timeline: [], taskSwitches: 0 };
  }

  function readStoredDayData(key) {
    const raw = localStorage.getItem(userPrefix() + 'day_' + key);
    if (!raw) return emptyDayData();
    try {
      const data = JSON.parse(raw);
      return {
        timeline: Array.isArray(data.timeline) ? data.timeline : [],
        taskSwitches: Number(data.taskSwitches) || 0
      };
    } catch (e) {
      return emptyDayData();
    }
  }

  function getUserDayKeys() {
    const prefix = userPrefix() + 'day_';
    return Object.keys(localStorage)
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.replace(prefix, ''));
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
    return getDayDataByKey(dateKey());
  }

  /** Save today's timeline */
  function saveTodayData(data) {
    localStorage.setItem(userPrefix() + 'day_' + dateKey(), JSON.stringify(data));
    purgeOldData();
  }

  function saveDayDataByKey(key, data) {
    localStorage.setItem(userPrefix() + 'day_' + key, JSON.stringify(data));
    purgeOldData();
  }

  function startOfNextDayMs(timestamp) {
    const d = new Date(timestamp);
    d.setHours(24, 0, 0, 0);
    return d.getTime();
  }

  function makeTaskEntry(task, startMs, endMs) {
    const startDate = new Date(startMs);
    const endDate = new Date(endMs);
    return {
      main: task.main,
      sub: task.sub || null,
      category: getCategory(task.main),
      start: startMs,
      end: endMs,
      startFormatted: formatTime(startDate),
      endFormatted: formatTime(endDate),
      durationMs: Math.max(0, endMs - startMs)
    };
  }

  function saveTaskSegmentsByDay(task, startMs, endMs, options = {}) {
    if (!task || !task.main || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return [];

    const saved = [];
    let cursor = startMs;
    while (cursor < endMs) {
      const boundary = Math.min(startOfNextDayMs(cursor), endMs);
      const entry = makeTaskEntry(task, cursor, boundary);
      if (entry.durationMs > 0) {
        const key = dateKey(new Date(cursor));
        const dayData = getDayDataByKey(key);
        dayData.timeline.push(entry);
        if (options.incrementSwitches) dayData.taskSwitches = (dayData.taskSwitches || 0) + 1;
        saveDayDataByKey(key, dayData);
        saved.push(entry);
      }
      cursor = boundary;
    }
    return saved;
  }

  function splitActiveTaskAtDayBoundaries(nowMs = Date.now()) {
    if (!state.currentTask) return false;
    const startMs = Number(state.currentTask.startTime);
    if (!Number.isFinite(startMs) || nowMs <= startMs || dateKey(new Date(startMs)) === dateKey(new Date(nowMs))) return false;

    const todayStart = new Date(nowMs);
    todayStart.setHours(0, 0, 0, 0);
    const todayStartMs = todayStart.getTime();
    saveTaskSegmentsByDay(state.currentTask, startMs, todayStartMs, { incrementSwitches: false });
    state.currentTask.startTime = todayStartMs;
    state.currentTask.startedAt = todayStartMs;
    saveCurrentActiveTask();
    renderTimeline();
    renderRecent();
    renderAnalytics();
    renderChartsIfOpen();
    updateTodaySummary();
    updateSystemStatus();
    return true;
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
    state.appearance = JSON.parse(JSON.stringify(DEFAULT_APPEARANCE));
    applyTheme(false); applyUiAppearance(false);
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
  let audioCtx = null;
  try {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (AudioContextCtor) audioCtx = new AudioContextCtor();
  } catch (error) { console.warn('Web Audio unavailable:', error); }

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

    saveTaskSegmentsByDay(state.currentTask, state.currentTask.startTime, endTime.getTime(), { incrementSwitches: true });

    state.currentTask = null;
    removeActiveTask();
    renderTimeline();
    renderRecent();
    renderAnalytics();
    renderChartsIfOpen();
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
      saveTaskSegmentsByDay(previousTask, previousTask.startTime, startedAt, { incrementSwitches: true });
      renderRecent();
      renderAnalytics();
      renderChartsIfOpen();
    }

    saveCurrentActiveTask();

    flashTaskSwitch();
    playSwitchSound();
    updateLivePanel();
    renderActiveCommands();
    renderTimeline();
    renderChartsIfOpen();
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
      startFormatted: formatTime(new Date(start)),
      endFormatted: isActive ? 'NOW' : formatTime(new Date(end)),
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
      splitActiveTaskAtDayBoundaries(now.getTime());
      const elapsed = Date.now() - state.currentTask.startTime;
      document.getElementById('liveTimer').textContent = formatDurationMs(elapsed);
      document.getElementById('taskDuration').textContent = formatDurationHuman(elapsed);
    }

    state.analyticsTick += 1;
    if (state.analyticsTick % 5 === 0) {
      renderAnalytics();
      renderChartsIfOpen();
    }
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

    const missionOpen = state.timelinePanels.mission;
    const taskSummaryOpen = state.timelinePanels.taskSummary;

    container.innerHTML = `<div class="mission-analysis timeline-section${missionOpen ? '' : ' is-collapsed'}" data-timeline-panel="mission">
      <button class="mission-analysis-title timeline-section-toggle" type="button" data-toggle-timeline-panel="mission" aria-expanded="${missionOpen}" aria-controls="missionAnalysisBody">
        <span class="timeline-section-label">
          <span class="timeline-section-arrow" aria-hidden="true">${missionOpen ? '&#9660;' : '&#9654;'}</span>
          <span>Mission Analysis</span>
        </span>
        <strong>${title}</strong>
      </button>
      <div class="timeline-section-body" id="missionAnalysisBody">
        <div class="mission-analysis-content">
          <div class="mission-metrics">
            ${metricSets[model.range].map(metric => missionMetricHTML(metric, summary)).join('')}
          </div>
          <div class="task-summary timeline-section${taskSummaryOpen ? '' : ' is-collapsed'}" data-timeline-panel="taskSummary">
            <button class="task-summary-title timeline-section-toggle" type="button" data-toggle-timeline-panel="taskSummary" aria-expanded="${taskSummaryOpen}" aria-controls="taskSummaryBody">
              <span class="timeline-section-label">
                <span class="timeline-section-arrow" aria-hidden="true">${taskSummaryOpen ? '&#9660;' : '&#9654;'}</span>
                <span>Task Summary</span>
              </span>
            </button>
            <div class="timeline-section-body" id="taskSummaryBody">
              <div class="task-summary-grid">
                ${taskSummaryHTML(summary.taskSummary)}
              </div>
            </div>
          </div>
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

  function loadTimelinePanelState() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(TIMELINE_PANEL_STATE_KEY) || '{}');
      state.timelinePanels = {
        mission: saved.mission !== false,
        taskSummary: saved.taskSummary === true
      };
    } catch (error) {
      state.timelinePanels = { mission: true, taskSummary: false };
    }
  }

  function saveTimelinePanelState() {
    try {
      sessionStorage.setItem(TIMELINE_PANEL_STATE_KEY, JSON.stringify(state.timelinePanels));
    } catch (error) {
      // Session persistence is a convenience; the UI remains usable without it.
    }
  }

  function toggleTimelinePanel(panel) {
    if (!Object.prototype.hasOwnProperty.call(state.timelinePanels, panel)) return;
    state.timelinePanels[panel] = !state.timelinePanels[panel];
    saveTimelinePanelState();

    const section = document.querySelector(`[data-timeline-panel="${panel}"]`);
    const toggle = document.querySelector(`[data-toggle-timeline-panel="${panel}"]`);
    if (section) section.classList.toggle('is-collapsed', !state.timelinePanels[panel]);
    if (toggle) {
      toggle.setAttribute('aria-expanded', String(state.timelinePanels[panel]));
      const arrow = toggle.querySelector('.timeline-section-arrow');
      if (arrow) arrow.innerHTML = state.timelinePanels[panel] ? '&#9660;' : '&#9654;';
    }
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
      rows.push([
        formatTime(new Date(e.start)),
        formatTime(new Date(e.end)),
        e.main,
        e.sub || '',
        formatDurationHuman(e.durationMs)
      ]);
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
    document.getElementById('themePreset').addEventListener('change', (event) => chooseTheme(event.target.value));
    document.getElementById('themeSwatches').addEventListener('click', (event) => {
      const choice = event.target.closest('[data-theme-choice]');
      if (!choice) return;
      chooseTheme(choice.dataset.themeChoice);
    });
    document.querySelectorAll('[data-custom-color]').forEach((input) => input.addEventListener('input', () => {
      if (!state.appearance.customColors) chooseTheme('custom');
      state.appearance.customColors[input.dataset.customColor] = input.value;
      state.appearance.themeId = 'custom';
      applyTheme(true, false);
    }));
    document.getElementById('layoutChoices').addEventListener('click', (event) => {
      const choice = event.target.closest('[data-layout]'); if (!choice) return;
      state.appearance.layout = choice.dataset.layout; applyUiAppearance(true);
    });
    document.getElementById('textSizeChoices').addEventListener('click', (event) => {
      const choice = event.target.closest('[data-text-size]'); if (!choice) return;
      state.appearance.textSize = choice.dataset.textSize; applyTheme(true); applyUiAppearance(true);
    });
    document.getElementById('accessibilityMode').addEventListener('change', (event) => { state.appearance.accessibility = event.target.checked; applyUiAppearance(true); });
    document.querySelectorAll('[data-ui-visible]').forEach((input) => input.addEventListener('change', () => {
      state.appearance.visible[input.dataset.uiVisible] = input.checked;
      applyUiAppearance(true);
    }));
    document.getElementById('cardOrderControls').addEventListener('click', (event) => {
      const button = event.target.closest('[data-move-card]'); if (!button) return;
      const index = Number(button.dataset.moveCard); const next = index + Number(button.dataset.direction);
      const order = state.appearance[button.dataset.orderKey];
      if (!order || next < 0 || next >= order.length) return;
      [order[index], order[next]] = [order[next], order[index]];
      applyUiAppearance(true);
    });
    document.getElementById('mainCardOrderControls').addEventListener('click', (event) => {
      const button = event.target.closest('[data-move-card]'); if (!button) return;
      const index = Number(button.dataset.moveCard); const next = index + Number(button.dataset.direction);
      const order = state.appearance.mainCardOrder;
      if (next < 0 || next >= order.length) return;
      [order[index], order[next]] = [order[next], order[index]];
      applyUiAppearance(true);
    });
    document.getElementById('btnReminderSettings').addEventListener('click', () => {
      document.querySelector('[data-screen="schedule"]').click();
    });
    document.addEventListener('pointerdown', () => { if (audioCtx?.state === 'suspended') audioCtx.resume().catch(() => {}); }, { passive: true });
    const alertButton = document.getElementById('btnEnableNotifications');
    if (!('Notification' in window)) alertButton.textContent = 'In-app alerts';
    else if (Notification.permission === 'granted') alertButton.textContent = 'System alerts on';
    alertButton.addEventListener('click', async () => {
      if (!('Notification' in window)) { showToast('This browser supports in-app reminders only', 'error'); return; }
      if (Notification.permission === 'granted') { showToast('System alerts are enabled'); return; }
      try {
        const permission = await Notification.requestPermission();
        alertButton.textContent = permission === 'granted' ? 'System alerts on' : 'Alerts blocked';
        showToast(permission === 'granted' ? 'System alerts enabled' : 'Allow notifications in browser settings', permission === 'granted' ? 'success' : 'error');
      } catch (_) { alertButton.textContent = 'In-app alerts'; showToast('System notifications are unavailable; in-app alerts still work', 'error'); }
    });
    document.querySelectorAll('.screen-nav-btn').forEach((button) => button.addEventListener('click', () => {
      const isSchedule = button.dataset.screen === 'schedule';
      document.body.classList.toggle('schedule-view', isSchedule);
      document.querySelectorAll('.screen-nav-btn').forEach((item) => item.classList.toggle('active', item === button));
      if (isSchedule) renderSchedules();
    }));
    document.getElementById('btnSchedule').addEventListener('click', () => document.querySelector('[data-screen="schedule"]').click());
    document.getElementById('btnOpenSchedule').addEventListener('click', () => document.querySelector('[data-screen="schedule"]').click());
    document.getElementById('btnNewSchedule').addEventListener('click', () => openScheduleEditor());
    document.getElementById('btnSaveDeliveryDefaults').addEventListener('click', saveDeliveryDefaults);
    document.getElementById('btnPreviewTone').addEventListener('click', () => previewAlarm(document.getElementById('scheduleTone').value, Number(document.getElementById('scheduleVolume').value)));
    document.getElementById('scheduleVolume').addEventListener('input', (event) => { document.getElementById('scheduleVolumeValue').textContent = `${event.target.value}%`; });
    document.getElementById('btnCloseScheduleEditor').addEventListener('click', () => closeModal('scheduleEditorModal'));
    document.getElementById('scheduleForm').addEventListener('submit', (event) => { event.preventDefault(); scheduleFromForm(); });
    document.getElementById('scheduleList').addEventListener('click', (event) => {
      const edit = event.target.closest('[data-schedule-edit]'); const del = event.target.closest('[data-schedule-delete]');
      if (edit) openScheduleEditor(state.schedules.find((item) => item.id === edit.dataset.scheduleEdit));
      if (del) { const id = del.dataset.scheduleDelete; cancelScheduleReminders(id); state.schedules = state.schedules.filter((item) => item.id !== id); clearReminderMarkers(id); saveSchedules(); renderSchedules(); showToast('Schedule deleted'); }
    });
    document.getElementById('scheduleList').addEventListener('change', (event) => {
      const toggle = event.target.closest('[data-schedule-toggle]'); if (!toggle) return;
      const item = state.schedules.find((entry) => entry.id === toggle.dataset.scheduleToggle); if (!item) return;
      cancelScheduleReminders(item.id); item.enabled = toggle.checked; item.updatedAt = Math.max(Date.now(), Number(item.updatedAt || 0) + 1); clearReminderMarkers(item.id);
      if (item.enabled) {
        const marks = reminderMarkers();
        marks[item.id] = {};
        if (item.startTimestamp <= Date.now()) marks[item.id].start = `start:${item.updatedAt}`;
        if (item.endTimestamp <= Date.now()) marks[item.id].end = `end:${item.updatedAt}`;
        localStorage.setItem(userPrefix() + REMINDER_STATE_KEY, JSON.stringify(marks));
      }
      saveSchedules(); renderSchedules(); checkScheduleReminders();
    });
    document.getElementById('upcomingContent').addEventListener('click', (event) => {
      const button = event.target.closest('[data-schedule-start]'); if (!button) return;
      const item = state.schedules.find((entry) => entry.id === button.dataset.scheduleStart); if (!item) return;
      const key = Object.keys(state.mappings.mainTasks).find((candidate) => state.mappings.mainTasks[candidate].toLowerCase() === item.activityName.toLowerCase()) || null;
      startTask(item.activityName, null, key); saveCurrentActiveTask(); updateLivePanel(); updateSystemStatus(); showToast(`Started: ${item.activityName}`);
      markScheduleStarted(item.id); renderSchedules();
    });
    document.getElementById('reminderActions').addEventListener('click', (event) => {
      const button = event.target.closest('[data-reminder-action]'); if (button) handleReminderAction(button.dataset.reminderAction, button.dataset.reminderId, button.dataset.reminderName);
    });
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
        if (state.reminderVisible) { e.preventDefault(); handleReminderAction('dismiss', state.activeReminder?.item.id, state.activeReminder?.item.activityName); return; }
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

    document.getElementById('timelineSummary')?.addEventListener('click', (event) => {
      const toggle = event.target.closest('[data-toggle-timeline-panel]');
      if (!toggle) return;
      toggleTimelinePanel(toggle.dataset.toggleTimelinePanel);
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
        state.chartRange = btn.dataset.range || 'today';
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
        if (e.target === overlay && overlay.id === 'reminderModal' && state.reminderVisible) handleReminderAction('dismiss', state.activeReminder?.item.id, state.activeReminder?.item.activityName);
        else if (e.target === overlay) closeModal(overlay.id);
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
    loadTimelinePanelState();
    loadMappings();
    loadSchedules();

    // PHASE 1: Restore active task BEFORE the first UI render
    console.log('[LIFE-OS] init() PHASE 1: Starting task restoration');
    state.isRestoringTask = true;
    const restoredTask = restoreCurrentActiveTask();
    if (restoredTask) {
      console.log('[LIFE-OS] Active task restored in init():', restoredTask.main, restoredTask.sub || '');
      splitActiveTaskAtDayBoundaries(Date.now());
    }

    // PHASE 2: Setup events and UI (with restoration flag still active)
    console.log('[LIFE-OS] init() PHASE 2: Binding events and rendering UI');
    bindEvents();
    setupMobileKeyboard();
    setupPWA();
    refreshAllUI();
    renderSchedules();

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
    setInterval(checkScheduleReminders, 1000);
    window.addEventListener('focus', checkScheduleReminders);
    window.addEventListener('pageshow', checkScheduleReminders);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkScheduleReminders(); });
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


