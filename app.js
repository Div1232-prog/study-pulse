'use strict';

/* StudyPulse v1.1 â€” local-first focus cockpit. No backend or third-party JS. */
(() => {
  const KEYS = {
    state: 'focusdeck.v1.1.state',
    legacy: 'focusdeck.v1.state',
    onboarded: 'focusdeck.v1.1.onboarded',
    recovery: 'focusdeck.v1.1.state.recovery'
  };
  const DURATIONS = { focus: 25 * 60, break: 5 * 60 };
  const MAX_FOCUS_SECONDS = 24 * 60 * 60;
  const MAX_BREAK_SECONDS = 180 * 60;
  const MIN_TRACKED_FOCUS_SECONDS = 5;
  const CIRCUMFERENCE = 2 * Math.PI * 124;
  const MAX_SESSIONS = 2000;
  const $ = (id) => document.getElementById(id);
  const viewPanels = Array.from(document.querySelectorAll('.view-panel'));
  const navItems = Array.from(document.querySelectorAll('.nav-item'));
  const navButtons = Array.from(document.querySelectorAll('[data-nav]'));
  const viewButtons = Array.from(document.querySelectorAll('[data-go-view]'));
  const homeLinks = Array.from(document.querySelectorAll('[data-home]'));
  const rangeButtons = Array.from(document.querySelectorAll('[data-range]'));
  const themeRadios = Array.from(document.querySelectorAll('input[name="theme"]'));
  const themeSelect = $('theme-select');

  const el = {
    todayLabel: $('today-label'), timerDisplay: $('timer-display'), timerProgress: $('timer-progress'), timerState: $('timer-state'), timerHint: $('timer-hint'),
    modeLabel: $('mode-label'), sessionLength: $('session-length'), start: $('start-button'), pause: $('pause-button'), reset: $('reset-button'),
    taskInput: $('task-input'), clearTask: $('clear-task-button'), taskSaveStatus: $('task-save-status'), taskCount: $('task-character-count'), taskReminder: $('task-reminder'),
    activeTaskSelect: $('active-task-select'), focusMinutes: $('focus-minutes'), sessionsCount: $('sessions-count'), historyList: $('history-list'),
    streakCurrent: $('streak-current'), streakLongest: $('streak-longest'), streakFlame: $('streak-flame'), completionCard: $('completion-card'), completionDescription: $('completion-description'),
    anotherSession: $('another-session-button'), startBreak: $('start-break-button'), breakBreathing: $('break-breathing'), breathCircle: $('breath-circle'), breathPhase: $('breath-phase'), skipBreak: $('skip-break-button'),
    settingsButton: $('settings-button'), settingsDialog: $('settings-dialog'), closeSettings: $('close-settings-button'), settingsDone: $('settings-done-button'),
    alertsToggle: $('alerts-toggle'), alertVolume: $('alert-volume'), alertVolumeValue: $('alert-volume-value'), ambientToggle: $('ambient-toggle'), ambientType: $('ambient-type'), ambientVolume: $('ambient-volume'), ambientVolumeValue: $('ambient-volume-value'),
    taskForm: $('task-form'), taskFormTitle: $('task-form-title'), newTaskTitle: $('new-task-title'), taskEstimate: $('task-estimate'), taskPriority: $('task-priority'), cancelEdit: $('cancel-edit-button'), saveTaskButton: $('save-task-button'),
    activeTaskList: $('active-task-list'), completedTaskList: $('completed-task-list'), activeTaskCount: $('active-task-count'), completedTaskCount: $('completed-task-count'),
    alltimeMinutes: $('alltime-minutes'), alltimeSessions: $('alltime-sessions'), analyticsStreak: $('analytics-streak'), analyticsLongest: $('analytics-longest'), chart: $('focus-chart'), chartTotal: $('chart-total'), analyticsInsight: $('analytics-insight'),
    welcomeDialog: $('welcome-dialog'), welcomeStart: $('welcome-start-button'), helpButton: $('help-button'), storageNote: $('storage-note'), toastRegion: $('toast-region'),
    timerHeading: $('timer-heading'),
    // Optional controls added by the coordinated index.html update.
    focusDurationInput: $('focus-duration-input'),
    breakDurationInput: $('break-duration-input'),
    autoBreakToggle: $('auto-break-toggle'),
  };
  const startLabel = el.start.querySelector('span');
  const progressView = $('view-progress');
  const themeColorMeta = document.querySelector('meta[name="theme-color"]');

  const storage = (() => {
    try { return window.localStorage; }
    catch (error) { return null; }
  })();
  let storageAvailable = Boolean(storage);
  let storageCorruptedRaw = null;
  let storageRecoveryPreserved = false;
  let storageLegacyPreserved = false;
  let lastKnownStateRaw = null;
  let lastStorageNote = '';
  let ticker = null;
  let dayRefreshTicker = null;
  let editTaskId = null;
  let chartRange = 7;
  let chartResizeObserver = null;
  let toastQueue = [];
  let toastBusy = false;
  let audioContext = null;
  let ambientGraph = null;
  let audioUnlocked = false;
  let lastBreathPhase = -1;
  let lastRenderedDay = localDateKey();

  const defaultState = () => ({
    version: 2,
    revision: 0,
    timer: { mode: 'focus', durationSeconds: DURATIONS.focus, remainingSeconds: DURATIONS.focus, status: 'idle', endAt: null, sessionId: null, linkedTaskId: null, linkedTaskTitle: '' },
    taskNote: '', tasks: [], activeTaskId: null, sessions: [],
    streak: { lastFocusDate: null, current: 0, longest: 0 },
    preferences: { alertsEnabled: true, alertVolume: 55, ambientEnabled: false, ambientType: 'rain', ambientVolume: 28, theme: 'default', chartRange: 7, focusDurationMinutes: 25, breakDurationMinutes: 5, autoBreak: true }
  });

  const clamp = (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback;
  const normalizeMinutes = (value, min, max, fallback) => {
    const number = Number(value);
    return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
  };
  const focusDurationSeconds = () => state.preferences.focusDurationMinutes * 60;
  const breakDurationSeconds = () => state.preferences.breakDurationMinutes * 60;
  const text = (value, max = 120) => typeof value === 'string' ? value.trim().slice(0, max) : '';
  const makeId = () => (window.crypto && typeof window.crypto.randomUUID === 'function') ? window.crypto.randomUUID() : `fd-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

  function normalizeSession(session) {
    if (!session || !Number.isFinite(Number(session.completedAt))) return null;
    const completedAt = Number(session.completedAt);
    if (completedAt <= 0 || !Number.isFinite(new Date(completedAt).getTime())) return null;
    return {
      id: text(session.id, 100) || makeId(), completedAt,
      // Focus records may now represent partial sessions or custom durations
      // up to 24 hours; older records remain valid and backward-compatible.
      durationSeconds: clamp(session.durationSeconds, 1, MAX_FOCUS_SECONDS, DURATIONS.focus),
      taskId: text(session.taskId, 100) || null,
      taskTitle: text(session.taskTitle, 120),
      kind: session.kind === 'partial' ? 'partial' : 'completed',
      mode: 'focus'
    };
  }

  function normalizeState(saved) {
    const state = defaultState();
    if (!saved || typeof saved !== 'object') return state;
    state.revision = clamp(saved.revision, 0, Number.MAX_SAFE_INTEGER, 0);

    const prefs = saved.preferences && typeof saved.preferences === 'object' ? saved.preferences : {};
    state.preferences = {
      alertsEnabled: prefs.alertsEnabled !== false,
      alertVolume: clamp(prefs.alertVolume, 0, 100, 55),
      ambientEnabled: Boolean(prefs.ambientEnabled),
      ambientType: ['rain', 'white', 'cafe'].includes(prefs.ambientType) ? prefs.ambientType : 'rain',
      ambientVolume: clamp(prefs.ambientVolume, 0, 100, 28),
      // Existing dark palettes remain supported; Light is an additional theme.
      theme: ['default', 'purple', 'ocean', 'emerald', 'light'].includes(prefs.theme) ? prefs.theme : 'default',
      chartRange: Number(prefs.chartRange) === 30 ? 30 : 7,
      focusDurationMinutes: normalizeMinutes(prefs.focusDurationMinutes, 1, 24 * 60, 25),
      breakDurationMinutes: normalizeMinutes(prefs.breakDurationMinutes, 1, 180, 5),
      autoBreak: prefs.autoBreak !== false
    };

    const timer = saved.timer && typeof saved.timer === 'object' ? saved.timer : saved;
    const mode = ['focus', 'break'].includes(timer.mode) ? timer.mode : 'focus';
    const fallbackDuration = mode === 'break' ? state.preferences.breakDurationMinutes * 60 : state.preferences.focusDurationMinutes * 60;
    const maxDuration = mode === 'break' ? MAX_BREAK_SECONDS : MAX_FOCUS_SECONDS;
    const duration = clamp(timer.durationSeconds, 60, maxDuration, fallbackDuration);
    state.timer = {
      mode,
      durationSeconds: duration,
      remainingSeconds: clamp(timer.remainingSeconds, 0, duration, duration),
      status: ['idle', 'running', 'paused', 'completed'].includes(timer.status) ? timer.status : 'idle',
      endAt: timer.endAt !== null && timer.endAt !== undefined && Number.isFinite(Number(timer.endAt)) && Number(timer.endAt) > 0 ? Number(timer.endAt) : null,
      sessionId: typeof timer.sessionId === 'string' ? timer.sessionId.slice(0, 100) : null,
      linkedTaskId: typeof timer.linkedTaskId === 'string' ? timer.linkedTaskId.slice(0, 100) : null,
      linkedTaskTitle: text(timer.linkedTaskTitle, 120)
    };
    if (state.timer.mode === 'break' && state.timer.status === 'completed') {
      state.timer = { mode: 'focus', durationSeconds: fallbackFocusDuration(state), remainingSeconds: fallbackFocusDuration(state), status: 'idle', endAt: null, sessionId: null, linkedTaskId: null, linkedTaskTitle: '' };
    }
    if (state.timer.status === 'running' && (!state.timer.endAt || (mode === 'focus' && !state.timer.sessionId))) {
      state.timer.status = 'paused';
      state.timer.endAt = null;
    }
    if (state.timer.status !== 'running') state.timer.endAt = null;
    if (state.timer.status === 'completed') state.timer.remainingSeconds = 0;
    // When an idle timer is loaded, the saved preference is the next session's duration.
    if (state.timer.mode === 'focus' && state.timer.status === 'idle' && !state.timer.sessionId) {
      state.timer.durationSeconds = state.preferences.focusDurationMinutes * 60;
      state.timer.remainingSeconds = state.timer.durationSeconds;
    }
    if (state.timer.mode === 'break' && state.timer.status === 'idle') {
      state.timer.durationSeconds = state.preferences.breakDurationMinutes * 60;
      state.timer.remainingSeconds = state.timer.durationSeconds;
    }

    state.taskNote = text(saved.taskNote !== undefined ? saved.taskNote : saved.task, 120);
    const taskIds = new Set();
    state.tasks = Array.isArray(saved.tasks) ? saved.tasks.map((task) => {
      if (!task || typeof task !== 'object') return null;
      let id = text(task.id, 100) || makeId();
      while (taskIds.has(id)) id = makeId();
      taskIds.add(id);
      return {
        id, title: text(task.title, 120),
        estimate: clamp(task.estimate, 1, 50, 2), completedSessions: clamp(task.completedSessions, 0, 9999, 0),
        priority: ['low', 'medium', 'high'].includes(task.priority) ? task.priority : 'medium', done: Boolean(task.done),
        createdAt: Number.isFinite(Number(task.createdAt)) && Number(task.createdAt) > 0 ? Number(task.createdAt) : Date.now()
      };
    }).filter((task) => task && task.title) : [];
    state.activeTaskId = text(saved.activeTaskId, 100) || null;
    if (!state.tasks.some((task) => task.id === state.activeTaskId && !task.done)) state.activeTaskId = null;
    const sessionIds = new Set();
    state.sessions = Array.isArray(saved.sessions) ? saved.sessions.map(normalizeSession).filter((session) => {
      if (!session || sessionIds.has(session.id)) return false;
      sessionIds.add(session.id);
      return true;
    }).sort((a, b) => b.completedAt - a.completedAt).slice(0, MAX_SESSIONS) : [];
    if (state.timer.linkedTaskId && !state.tasks.some((task) => task.id === state.timer.linkedTaskId)) state.timer.linkedTaskId = null;
    const streak = saved.streak && typeof saved.streak === 'object' ? saved.streak : {};
    state.streak = {
      lastFocusDate: isValidDateKey(streak.lastFocusDate) ? streak.lastFocusDate : null,
      current: clamp(streak.current, 0, 9999, 0), longest: clamp(streak.longest, 0, 9999, 0)
    };
    if (!state.streak.lastFocusDate && state.sessions.length) rebuildStreak(state);
    return state;
  }

  function fallbackFocusDuration(targetState) {
    return (targetState?.preferences?.focusDurationMinutes || 25) * 60;
  }

  function needsRecoveryCopy(saved, normalized) {
    if (Array.isArray(saved.tasks)) {
      if (normalized.tasks.length !== saved.tasks.length) return true;
      const taskIds = new Set();
      for (const task of saved.tasks) {
        const id = task && typeof task === 'object' ? text(task.id, 100) : '';
        if (id && taskIds.has(id)) return true;
        if (id) taskIds.add(id);
      }
    }
    if (Array.isArray(saved.sessions) && normalized.sessions.length !== saved.sessions.length) return true;
    return false;
  }

  function rebuildStreak(target) {
    const days = [...new Set(target.sessions.map((session) => localDateKey(session.completedAt)))].sort();
    let current = 0; let longest = 0; let previous = null;
    for (const day of days) {
      const gap = previous ? dayOrdinal(day) - dayOrdinal(previous) : 0;
      current = !previous || gap > 1 ? 1 : current + 1;
      longest = Math.max(longest, current); previous = day;
    }
    target.streak = { lastFocusDate: days[days.length - 1] || null, current, longest };
  }

  function loadState() {
    if (!storage) {
      storageAvailable = false;
      return defaultState();
    }
    try {
      const current = storage.getItem(KEYS.state);
      lastKnownStateRaw = current;
      if (current !== null) {
        try {
          const parsed = JSON.parse(current);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TypeError('Saved state must be an object.');
          const normalized = normalizeState(parsed);
          if (needsRecoveryCopy(parsed, normalized)) storageCorruptedRaw = current;
          return normalized;
        } catch (error) { storageCorruptedRaw = current; }
      }
      const legacy = storage.getItem(KEYS.legacy);
      if (legacy !== null) {
        try {
          const old = JSON.parse(legacy);
          if (!old || typeof old !== 'object' || Array.isArray(old)) throw new TypeError('Legacy save must be an object.');
          const migrated = normalizeState({ ...old, taskNote: old.task || '', timer: {
            mode: 'focus', durationSeconds: DURATIONS.focus, remainingSeconds: old.remainingSeconds,
            status: old.status, endAt: old.endAt, sessionId: old.sessionId, linkedTaskId: null, linkedTaskTitle: ''
          }});
          persist(migrated);
          return migrated;
        } catch (error) {
          // Keep the legacy value untouched; malformed data is never silently deleted.
          storageLegacyPreserved = true;
        }
      }
      return defaultState();
    } catch (error) {
      storageAvailable = false;
      return defaultState();
    }
  }

  let state = defaultState();
  state = loadState();
  chartRange = state.preferences.chartRange;

  function persist(value = state) {
    try {
      if (!storage) throw new Error('Local storage is unavailable.');
      const currentRaw = storage.getItem(KEYS.state);
      if (currentRaw !== lastKnownStateRaw) {
        adoptStoredState(currentRaw, true);
        return false;
      }
      if (storageCorruptedRaw !== null) {
        const recoveryKey = storage.getItem(KEYS.recovery) === null ? KEYS.recovery : `${KEYS.recovery}.${Date.now()}`;
        storage.setItem(recoveryKey, storageCorruptedRaw);
        storageCorruptedRaw = null;
        storageRecoveryPreserved = true;
      }
      value.revision = Math.max(Date.now(), (Number(value.revision) || 0) + 1);
      const serialized = JSON.stringify(value);
      storage.setItem(KEYS.state, serialized);
      lastKnownStateRaw = serialized;
      storageAvailable = true;
    } catch (error) { storageAvailable = false; }
    updateStorageNote();
    return true;
  }
  function updateStorageNote() {
    const message = !storageAvailable
      ? 'Browser storage is unavailable. Your progress may not survive a refresh.'
      : storageCorruptedRaw !== null
        ? 'A previous save needs repair. Its original data will be preserved before changes are saved.'
        : storageRecoveryPreserved
          ? 'A recovery copy of the previous save was kept on this device.'
          : storageLegacyPreserved
            ? 'An unreadable legacy save was left untouched; it was not migrated.'
            : 'Your focus data stays on this device.';
    if (message !== lastStorageNote) {
      el.storageNote.textContent = message;
      lastStorageNote = message;
    }
    el.storageNote.classList.toggle('storage-warning', !storageAvailable || storageCorruptedRaw !== null || storageLegacyPreserved);
  }

  function debounce(fn, delay = 240) {
    let timeoutId = null;
    const wrapped = (...args) => {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        timeoutId = null;
        fn(...args);
      }, delay);
    };
    wrapped.flush = () => {
      if (timeoutId === null) return;
      window.clearTimeout(timeoutId);
      timeoutId = null;
      fn();
    };
    wrapped.cancel = () => {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      timeoutId = null;
    };
    return wrapped;
  }

  const saveFocusNoteDebounced = debounce(() => {
    if (persist()) el.taskSaveStatus.textContent = storageAvailable ? 'Saved on this device' : 'Not saved â€” storage unavailable';
  }, 260);
  const savePreferencesDebounced = debounce(() => persist(), 260);

  function localDateKey(timestamp = Date.now()) {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  function isValidDateKey(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }
  function dayOrdinal(dateKey) {
    const [year, month, day] = dateKey.split('-').map(Number);
    return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
  }
  function dateFromKey(key) { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d, 12); }
  function formatDateLabel(date) { return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(date).toUpperCase(); }
  function formatTime(timestamp) { return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(timestamp)); }
  function formatClock(seconds) { const n = Math.max(0, Math.ceil(seconds)); return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`; }
  function formatFocusDuration(seconds) {
    const value = Math.max(0, Math.round(Number(seconds) || 0));
    if (value < 60) return `${value} sec`;
    return `${Math.round(value / 60)} min`;
  }
  function sumFocusSeconds(sessions) { return sessions.reduce((sum, session) => sum + Math.max(0, Number(session.durationSeconds) || 0), 0); }
  function effectiveStreak() {
    if (!state.streak.lastFocusDate) return 0;
    const gap = dayOrdinal(localDateKey()) - dayOrdinal(state.streak.lastFocusDate);
    return gap >= 0 && gap <= 1 ? state.streak.current : 0;
  }
  function bumpStreak(completedAt) {
    const day = localDateKey(completedAt);
    const last = state.streak.lastFocusDate;
    if (last === day) return false;
    const gap = last ? dayOrdinal(day) - dayOrdinal(last) : 0;
    // Historical sessions may be added later, but must never move the latest
    // activity date or current streak backwards.
    if (last && gap < 0) return false;
    state.streak.current = !last || gap > 1 ? 1 : state.streak.current + 1;
    state.streak.lastFocusDate = day;
    state.streak.longest = Math.max(state.streak.longest, state.streak.current);
    return true;
  }

  // ---------- Toast queue ----------
  function toast(message, type = 'info') { toastQueue.push({ message, type }); if (!toastBusy) showNextToast(); }
  function showNextToast() {
    const next = toastQueue.shift();
    if (!next) { toastBusy = false; return; }
    toastBusy = true;
    const node = document.createElement('div');
    node.className = `toast ${next.type}`; node.setAttribute('role', 'status'); node.textContent = next.message;
    el.toastRegion.append(node);
    requestAnimationFrame(() => node.classList.add('visible'));
    window.setTimeout(() => {
      node.classList.remove('visible');
      window.setTimeout(() => { node.remove(); toastBusy = false; showNextToast(); }, 240);
    }, 3000);
  }

  // ---------- Audio: Web Audio alerts and generated ambient sound ----------
  function getAudioContext() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    if (!audioContext) {
      try { audioContext = new Ctx(); }
      catch (error) { audioContext = null; }
    }
    return audioContext;
  }
  function unlockAudio() {
    if (audioUnlocked) return;
    audioUnlocked = true;
    const ctx = getAudioContext();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    try { window.speechSynthesis?.getVoices?.(); } catch (error) { /* voice discovery is optional */ }
    if (state.preferences.ambientEnabled) startAmbient();
  }
  function playTone(frequency = 660, duration = .16, volumeScale = 1) {
    if (!state.preferences.alertsEnabled || state.preferences.alertVolume <= 0) return;
    const ctx = getAudioContext(); if (!ctx) return;
    try {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const oscillator = ctx.createOscillator(); const gain = ctx.createGain();
      oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);
      const volume = (state.preferences.alertVolume / 100) * .075 * volumeScale;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(Math.max(.0002, volume), ctx.currentTime + .025);
      gain.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + duration);
      oscillator.connect(gain).connect(ctx.destination); oscillator.start(); oscillator.stop(ctx.currentTime + duration + .03);
      oscillator.addEventListener('ended', () => { try { oscillator.disconnect(); gain.disconnect(); } catch (error) { /* already disconnected */ } }, { once: true });
    } catch (error) { /* audio is optional; a browser audio failure must not interrupt the timer */ }
  }
  function announce(message, frequency = 660) {
    if (!state.preferences.alertsEnabled) return;
    const supported = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
    if (supported) {
      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(message);
        utterance.volume = clamp(state.preferences.alertVolume / 100, 0, 1, .55);
        utterance.rate = .92; utterance.pitch = .96;
        window.speechSynthesis.speak(utterance);
      } catch (error) { playTone(frequency); return; }
      playTone(frequency, .13, .35);
    } else playTone(frequency, .2, .8);
  }
  function stopAmbient() {
    if (!ambientGraph) return;
    try { ambientGraph.source.stop(); } catch (error) { /* already stopped */ }
    try { ambientGraph.lfo?.stop(); } catch (error) { /* optional oscillator */ }
    [ambientGraph.source, ambientGraph.filter, ambientGraph.gain, ambientGraph.lfo, ambientGraph.lfoGain].forEach((node) => {
      try { node?.disconnect(); } catch (error) { /* already disconnected */ }
    });
    ambientGraph = null;
  }
  function startAmbient() {
    if (!state.preferences.ambientEnabled || ambientGraph) return;
    const ctx = getAudioContext(); if (!ctx) { toast('Ambient audio is not supported in this browser.', 'warning'); return; }
    let source = null; let filter = null; let gain = null; let lfo = null; let lfoGain = null;
    try {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const length = Math.floor(ctx.sampleRate * 2.5); const buffer = ctx.createBuffer(1, length, ctx.sampleRate); const data = buffer.getChannelData(0);
      let brown = 0;
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        brown = (brown + .02 * white) / 1.02;
        data[i] = state.preferences.ambientType === 'white' ? white * .45 : (brown * 3.2 + white * .08);
      }
      source = ctx.createBufferSource(); source.buffer = buffer; source.loop = true;
      filter = ctx.createBiquadFilter();
      const type = state.preferences.ambientType;
      filter.type = type === 'white' ? 'highpass' : type === 'cafe' ? 'bandpass' : 'lowpass';
      filter.frequency.value = type === 'white' ? 950 : type === 'cafe' ? 850 : 1250;
      filter.Q.value = type === 'cafe' ? .75 : .45;
      gain = ctx.createGain(); gain.gain.value = 0.0001;
      source.connect(filter).connect(gain).connect(ctx.destination); source.start();
      if (type === 'cafe') {
        lfo = ctx.createOscillator(); lfoGain = ctx.createGain(); lfo.frequency.value = .16; lfoGain.gain.value = .0008;
        lfo.connect(lfoGain).connect(gain.gain); lfo.start();
      }
      ambientGraph = { source, filter, gain, lfo, lfoGain };
      updateAmbientGain();
    } catch (error) {
      try { source?.stop(); } catch (stopError) { /* source may not have started */ }
      [source, filter, gain, lfo, lfoGain].forEach((node) => {
        try { node?.disconnect(); } catch (disconnectError) { /* already disconnected */ }
      });
      ambientGraph = null;
      toast('Ambient audio could not be started. Check your browser audio settings.', 'warning');
    }
  }
  function updateAmbientGain() {
    if (!ambientGraph || !audioContext) return;
    const breakMultiplier = state.timer.mode === 'break' ? .35 : 1;
    const value = state.preferences.ambientEnabled ? (state.preferences.ambientVolume / 100) * .11 * breakMultiplier : .0001;
    try { ambientGraph.gain.gain.setTargetAtTime(Math.max(.0001, value), audioContext.currentTime, .35); }
    catch (error) { stopAmbient(); }
  }
  function restartAmbient() { stopAmbient(); if (state.preferences.ambientEnabled && audioUnlocked) startAmbient(); }

  // ---------- Navigation and view rendering ----------
  function goView(name) {
    if (!['focus', 'tasks', 'progress'].includes(name)) return;
    viewPanels.forEach((panel) => { panel.hidden = panel.dataset.view !== name; });
    navItems.forEach((button) => {
      const active = button.dataset.nav === name; button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    });
    if (name === 'progress') renderAnalytics();
    if (name === 'tasks') renderTasks();
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
    try { window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' }); }
    catch (error) { window.scrollTo(0, 0); }
  }
  navButtons.forEach((button) => button.addEventListener('click', () => goView(button.dataset.nav)));
  viewButtons.forEach((button) => button.addEventListener('click', () => goView(button.dataset.goView)));
  homeLinks.forEach((link) => link.addEventListener('click', (event) => { event.preventDefault(); goView('focus'); }));

  // ---------- Focus timer / session lifecycle ----------
  function stopTicker() { if (ticker !== null) { clearInterval(ticker); ticker = null; } }
  el.timerProgress.style.strokeDasharray = String(CIRCUMFERENCE);
  let lastTimerTitle = document.title;

  function updateTimerUI() {
    const timer = state.timer;
    if (timer.mode !== 'break') lastBreathPhase = -1;
    const remaining = timer.status === 'running' && timer.endAt ? Math.max(0, Math.ceil((timer.endAt - Date.now()) / 1000)) : timer.remainingSeconds;
    el.timerDisplay.textContent = formatClock(remaining);
    el.timerDisplay.setAttribute('aria-label', `${Math.floor(remaining / 60)} minutes and ${remaining % 60} seconds remaining`);
    const progress = timer.durationSeconds ? 1 - remaining / timer.durationSeconds : 0;
    el.timerProgress.style.strokeDashoffset = String(CIRCUMFERENCE * (1 - Math.max(0, Math.min(1, progress))));
    const running = timer.status === 'running';
    el.start.hidden = running; el.pause.hidden = !running;
    startLabel.textContent = timer.status === 'paused' ? 'Resume' : timer.mode === 'break' ? 'Start break' : 'Start focus';
    el.modeLabel.textContent = timer.mode === 'break' ? 'BREATHING BREAK' : 'FOCUS MODE';
    el.sessionLength.textContent = `${Math.round(timer.durationSeconds / 60)} MIN ${timer.mode === 'break' ? 'BREAK' : 'SESSION'}`;
    el.timerHeading.textContent = timer.mode === 'break' ? 'RESET YOUR PACE' : 'TIME TO FOCUS';
    if (timer.status === 'running') { el.timerState.textContent = timer.mode === 'break' ? 'A quiet moment to reset' : 'You are in your focus session'; el.timerHint.textContent = timer.mode === 'break' ? 'Follow the circle. There is nothing to rush.' : 'Stay with one thing. You are doing fine.'; }
    else if (timer.status === 'paused') { el.timerState.textContent = 'Paused â€” take your time'; el.timerHint.textContent = 'Pick up where you left off when you are ready.'; }
    else if (timer.status === 'completed') { el.timerState.textContent = 'A session well spent'; el.timerHint.textContent = 'You made space for focused work.'; }
    else { el.timerState.textContent = timer.mode === 'break' ? 'Break ready' : 'Ready when you are'; el.timerHint.textContent = 'Find a comfortable position and begin.'; }
    el.completionCard.hidden = timer.mode !== 'focus' || timer.status !== 'completed';
    el.breakBreathing.hidden = timer.mode !== 'break';
    const nextTitle = `${formatClock(remaining)} Â· StudyPulse`;
    if (nextTitle !== lastTimerTitle) { document.title = nextTitle; lastTimerTitle = nextTitle; }
    if (timer.mode === 'break') updateBreathingPhase(remaining);
  }
  function updateBreathingPhase(remaining) {
    const elapsed = Math.max(0, state.timer.durationSeconds - remaining);
    const phase = Math.floor(elapsed / 4) % 4;
    if (phase === lastBreathPhase) return;
    lastBreathPhase = phase;
    const phaseNames = ['Breathe in', 'Hold', 'Breathe out', 'Hold'];
    const classes = ['inhale', 'hold-in', 'exhale', 'hold-out'];
    el.breathPhase.textContent = phaseNames[phase];
    el.breathCircle.className = `breath-circle ${classes[phase]}`;
    el.breathPhase.setAttribute('aria-label', `${phaseNames[phase]}, four seconds`);
  }
  function renderStats() {
    const today = localDateKey();
    const todaySessions = state.sessions.filter((session) => localDateKey(session.completedAt) === today).sort((a, b) => b.completedAt - a.completedAt);
    // Aggregate seconds first, then round once so multiple partial sessions do not
    // inflate or lose minutes through per-session rounding.
    el.focusMinutes.textContent = String(Math.round(sumFocusSeconds(todaySessions) / 60));
    el.sessionsCount.textContent = String(todaySessions.length);
    const historyFragment = document.createDocumentFragment();
    if (!todaySessions.length) {
      const empty = document.createElement('li'); empty.className = 'empty-history'; empty.textContent = 'Your completed sessions will appear here.'; historyFragment.append(empty);
    } else todaySessions.slice(0, 8).forEach((session) => {
      const li = document.createElement('li'); li.className = 'history-row';
      const check = document.createElement('span'); check.className = 'history-check'; check.setAttribute('aria-hidden', 'true'); check.textContent = 'âœ“';
      const label = document.createElement('span'); label.className = 'history-row-label'; label.textContent = `${formatFocusDuration(session.durationSeconds)} Â· ${session.taskTitle || (session.kind === 'partial' ? 'Partial focus' : 'Focus session')}`;
      const time = document.createElement('time'); time.className = 'history-time'; time.dateTime = new Date(session.completedAt).toISOString(); time.textContent = formatTime(session.completedAt);
      li.append(check, label, time); historyFragment.append(li);
    });
    el.historyList.replaceChildren(historyFragment);
    const streak = effectiveStreak();
    el.streakCurrent.textContent = `${streak} Day Streak`;
    el.streakLongest.textContent = `${state.streak.longest} days`;
  }
  function renderTaskSelect() {
    const current = state.activeTaskId;
    const options = document.createDocumentFragment();
    const none = document.createElement('option'); none.value = ''; none.textContent = 'No task selected'; options.append(none);
    state.tasks.filter((task) => !task.done).forEach((task) => { const option = document.createElement('option'); option.value = task.id; option.textContent = task.title; options.append(option); });
    el.activeTaskSelect.replaceChildren(options);
    el.activeTaskSelect.value = current || '';
  }
  function renderFocusReminder() {
    const active = state.tasks.find((task) => task.id === state.activeTaskId && !task.done);
    el.taskReminder.textContent = active
      ? `Linked task: ${active.title} Â· ${active.completedSessions}/${active.estimate} estimated sessions`
      : state.taskNote
        ? `Your focus note: ${state.taskNote}`
        : `Keep it small. Your next focus session is ${state.preferences.focusDurationMinutes} minutes.`;
  }
  function renderFocusTask() {
    const note = state.taskNote;
    if (el.taskInput.value !== note) el.taskInput.value = note;
    el.taskCount.textContent = `${note.length}/120`;
    renderFocusReminder();
  }
  function renderAll() {
    el.todayLabel.textContent = formatDateLabel(new Date()); renderTimerUIAndAux(); renderStats(); renderTasks(); renderSettings(); applyTheme(); updateStorageNote();
  }
  function renderTimerUIAndAux() { updateTimerUI(); }
  function adoptStoredState(raw, notify = false) {
    saveFocusNoteDebounced.cancel();
    savePreferencesDebounced.cancel();
    stopTicker();
    if (raw === null) {
      state = defaultState();
      storageCorruptedRaw = null;
      storageRecoveryPreserved = false;
    } else {
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TypeError('Saved state must be an object.');
        state = normalizeState(parsed);
        storageCorruptedRaw = needsRecoveryCopy(parsed, state) ? raw : null;
      } catch (error) {
        state = defaultState();
        storageCorruptedRaw = raw;
      }
    }
    lastKnownStateRaw = raw;
    chartRange = state.preferences.chartRange;
    if (editTaskId && !state.tasks.some((task) => task.id === editTaskId)) resetTaskForm();
    renderAll();
    if (state.timer.status === 'running') startTicker();
    if (state.preferences.ambientEnabled) {
      if (audioUnlocked) restartAmbient();
    } else stopAmbient();
    updateAmbientGain();
    if (notify) toast('StudyPulse found a newer save from another tab and refreshed this view. Retry your last change if needed.', 'warning');
  }
  function idleFocusTimer() {
    const duration = focusDurationSeconds();
    return { mode: 'focus', durationSeconds: duration, remainingSeconds: duration, status: 'idle', endAt: null, sessionId: null, linkedTaskId: null, linkedTaskTitle: '' };
  }


  function elapsedFocusSeconds(timer = state.timer, now = Date.now()) {
    if (!timer || timer.mode !== 'focus' || !timer.sessionId) return 0;
    let elapsed = 0;
    if (timer.status === 'running' && timer.endAt) {
      elapsed = timer.durationSeconds - ((timer.endAt - now) / 1000);
    } else if (timer.status === 'paused') {
      elapsed = timer.durationSeconds - timer.remainingSeconds;
    }
    return Math.max(0, Math.min(timer.durationSeconds, Math.floor(elapsed)));
  }

  function addFocusRecord(sessionId, completedAt, durationSeconds, kind = 'completed', incrementTask = false) {
    if (!sessionId || durationSeconds < MIN_TRACKED_FOCUS_SECONDS) return { added: false, streakAdvanced: false };
    if (state.sessions.some((session) => session.id === sessionId)) return { added: false, streakAdvanced: false };
    const timer = state.timer;
    const task = state.tasks.find((item) => item.id === timer.linkedTaskId);
    state.sessions.unshift({
      id: sessionId,
      completedAt,
      durationSeconds: Math.min(MAX_FOCUS_SECONDS, Math.max(1, durationSeconds)),
      taskId: timer.linkedTaskId || null,
      taskTitle: timer.linkedTaskTitle || task?.title || '',
      kind: kind === 'partial' ? 'partial' : 'completed'
    });
    state.sessions = state.sessions.slice(0, MAX_SESSIONS);
    if (incrementTask && task && !task.done) task.completedSessions = Math.min(9999, task.completedSessions + 1);
    return { added: true, streakAdvanced: bumpStreak(completedAt) };
  }

  function showStreakFeedback(streakAdvanced) {
    if (!streakAdvanced) return;
    el.streakFlame.classList.remove('flame-pop');
    void el.streakFlame.offsetWidth;
    el.streakFlame.classList.add('flame-pop');
    const streak = effectiveStreak();
    toast(`Streak updated: ${streak} day${streak === 1 ? '' : 's'}!`, 'success');
  }

  function completeFocusSession(completedAt) {
    const timer = state.timer;
    if (timer.status === 'completed' || timer.mode !== 'focus') return;
    stopTicker();
    const at = Number.isFinite(completedAt) ? completedAt : Date.now();
    const sessionId = timer.sessionId;
    const focusSeconds = timer.durationSeconds;
    const record = addFocusRecord(sessionId, at, focusSeconds, 'completed', true);
    const shouldAutoBreak = state.preferences.autoBreak;

    if (shouldAutoBreak) {
      // Anchor the break to the scheduled focus completion time. If the app was
      // backgrounded for longer than the break, recovery will finish it immediately.
      const breakSeconds = breakDurationSeconds();
      state.timer = {
        mode: 'break', durationSeconds: breakSeconds, remainingSeconds: breakSeconds,
        status: 'running', endAt: at + breakSeconds * 1000,
        sessionId: null, linkedTaskId: null, linkedTaskTitle: ''
      };
    } else {
      timer.status = 'completed';
      timer.remainingSeconds = 0;
      timer.endAt = null;
    }

    if (!persist()) return;
    renderAll();
    showStreakFeedback(record.streakAdvanced);
    el.completionDescription.textContent = `You completed ${formatFocusDuration(focusSeconds)} of focused work. ${shouldAutoBreak ? 'Your break has started.' : 'Take a gentle break before your next session.'}`;
    toast(shouldAutoBreak ? 'Focus session saved. Your break started automatically.' : 'Session saved. Beautiful work.', 'success');
    announce(shouldAutoBreak ? 'Focus complete. Your break has started.' : 'Take a break', shouldAutoBreak ? 740 : 740);
    updateAmbientGain();
    if (shouldAutoBreak) startTicker();
  }

  function completeBreak() {
    stopTicker();
    state.timer = idleFocusTimer();
    if (!persist()) return;
    renderAll();
    toast('Break complete. Ready when you are.', 'success');
    announce('Break complete. Ready to focus', 590);
    updateAmbientGain();
  }
  function refreshLocalDay() {
    const today = localDateKey();
    if (today === lastRenderedDay) return;
    lastRenderedDay = today;
    el.todayLabel.textContent = formatDateLabel(new Date());
    renderStats();
    if (!progressView.hidden) renderAnalytics();
  }
  function startDayRefreshTicker() {
    if (dayRefreshTicker === null && !document.hidden) dayRefreshTicker = window.setInterval(refreshLocalDay, 60000);
  }
  function stopDayRefreshTicker() {
    if (dayRefreshTicker !== null) { window.clearInterval(dayRefreshTicker); dayRefreshTicker = null; }
  }
  function timerTick() {
    const timer = state.timer;
    if (timer.status !== 'running' || !timer.endAt) return;
    const remaining = Math.ceil((timer.endAt - Date.now()) / 1000);
    if (remaining <= 0) { if (timer.mode === 'focus') completeFocusSession(timer.endAt); else completeBreak(); return; }
    timer.remainingSeconds = remaining; updateTimerUI();
  }
  function startTicker() {
    stopTicker();
    timerTick();
    if (state.timer.status === 'running' && !document.hidden) ticker = window.setInterval(timerTick, 1000);
  }
  function startTimer() {
    unlockAudio();
    const timer = state.timer;
    if (timer.status === 'running') return;
    if (timer.mode === 'break') {
      if (timer.status === 'completed') { toast('Break already completed.', 'info'); return; }
      if (timer.status === 'idle') {
        timer.durationSeconds = breakDurationSeconds();
        timer.remainingSeconds = timer.durationSeconds;
      }
    } else if (timer.status === 'completed' || timer.remainingSeconds <= 0) {
      Object.assign(timer, idleFocusTimer());
    } else if (timer.status === 'idle' && !timer.sessionId) {
      timer.durationSeconds = focusDurationSeconds();
      timer.remainingSeconds = timer.durationSeconds;
    }
    if (timer.mode === 'focus' && !timer.sessionId) {
      timer.sessionId = makeId();
      timer.linkedTaskId = state.activeTaskId;
      const linked = state.tasks.find((task) => task.id === state.activeTaskId);
      timer.linkedTaskTitle = linked ? linked.title : state.taskNote;
    }
    timer.status = 'running';
    timer.endAt = Date.now() + timer.remainingSeconds * 1000;
    if (!persist()) return;
    updateTimerUI();
    startTicker();
    updateAmbientGain();
    if (timer.mode === 'focus') { announce('Focus session started', 520); toast('Focus session started. Youâ€™ve got this.', 'info'); }
    else toast('Break started. Follow your breathing.', 'info');
  }

  function pauseTimer() {
    const timer = state.timer;
    if (timer.status !== 'running' || !timer.endAt) return;
    const remaining = Math.ceil((timer.endAt - Date.now()) / 1000);
    if (remaining <= 0) { timerTick(); return; }
    stopTicker();
    timer.remainingSeconds = Math.min(timer.durationSeconds, remaining);
    timer.status = 'paused';
    timer.endAt = null;
    if (!persist()) return;
    updateTimerUI();
    updateAmbientGain();
    toast('Timer paused. Your elapsed focus time is preserved.', 'info');
  }

  function resetTimer() {
    const current = state.timer;
    const now = Date.now();
    let partialRecord = { added: false, streakAdvanced: false, seconds: 0 };

    // Resolve an already-expired focus timer as a completed session rather than
    // mislabelling it as a partial reset if the click races the final tick.
    if (current.mode === 'focus' && current.status === 'running' && current.endAt && current.endAt <= now) {
      completeFocusSession(current.endAt);
    } else if (current.mode === 'focus' && (current.status === 'running' || current.status === 'paused')) {
      const elapsed = elapsedFocusSeconds(current, now);
      if (elapsed >= MIN_TRACKED_FOCUS_SECONDS && current.sessionId) {
        partialRecord.seconds = elapsed;
        partialRecord = { ...addFocusRecord(current.sessionId, now, elapsed, 'partial', false), seconds: elapsed };
      }
    }

    stopTicker();
    state.timer = idleFocusTimer();
    if (!persist()) return false;
    renderAll();
    el.completionCard.hidden = true;
    updateAmbientGain();
    if (partialRecord.added) {
      showStreakFeedback(partialRecord.streakAdvanced);
      toast(`Reset saved ${formatFocusDuration(partialRecord.seconds)} of actual focus time.`, 'success');
    } else {
      toast(`Timer reset to ${formatClock(focusDurationSeconds())}.`, 'info');
    }
    return true;
  }

  function beginBreak() {
    if (state.timer.mode === 'break' && state.timer.status === 'running') return;
    // If a break is started manually during an active focus timer, save the
    // legitimate elapsed portion before switching modes.
    const current = state.timer;
    let partialRecord = { added: false, streakAdvanced: false, seconds: 0 };
    if (current.mode === 'focus' && (current.status === 'running' || current.status === 'paused')) {
      const elapsed = elapsedFocusSeconds(current);
      if (elapsed >= MIN_TRACKED_FOCUS_SECONDS && current.sessionId) {
        partialRecord = { ...addFocusRecord(current.sessionId, Date.now(), elapsed, 'partial', false), seconds: elapsed };
      }
    }
    stopTicker();
    const duration = breakDurationSeconds();
    state.timer = {
      mode: 'break', durationSeconds: duration, remainingSeconds: duration,
      status: 'running', endAt: Date.now() + duration * 1000,
      sessionId: null, linkedTaskId: null, linkedTaskTitle: ''
    };
    if (!persist()) return;
    renderTimerUIAndAux();
    startTicker();
    updateAmbientGain();
    showStreakFeedback(partialRecord.streakAdvanced);
    toast(`Break started for ${state.preferences.breakDurationMinutes} minutes.`, 'info');
  }

  function skipBreak() {
    if (state.timer.mode !== 'break') return;
    stopTicker();
    state.timer = idleFocusTimer();
    if (!persist()) return;
    renderTimerUIAndAux();
    updateAmbientGain();
    toast('Break skipped. Back to focus when ready.', 'info');
  }

  // ---------- Task manager ----------
  function emptyState(title, description, symbol = 'âœ§') {
    const box = document.createElement('div'); box.className = 'task-empty';
    const icon = document.createElement('span'); icon.className = 'empty-symbol'; icon.textContent = symbol;
    const strong = document.createElement('strong'); strong.textContent = title;
    const p = document.createElement('p'); p.textContent = description;
    box.append(icon, strong, p); return box;
  }
  function iconButton(label, action, id, glyph, extraClass = '') {
    const button = document.createElement('button'); button.type = 'button'; button.className = `small-icon-button ${extraClass}`.trim(); button.setAttribute('aria-label', label); button.title = label; button.dataset.action = action; button.dataset.id = id; button.textContent = glyph; return button;
  }
  function createTaskCard(task, completed = false) {
    const article = document.createElement('article'); article.className = `task-item${state.activeTaskId === task.id ? ' selected' : ''}`;
    if (!completed) {
      const check = document.createElement('input'); check.type = 'checkbox'; check.className = 'task-check'; check.checked = task.done; check.setAttribute('aria-label', `Mark ${task.title} complete`); check.dataset.action = 'complete-task'; check.dataset.id = task.id; article.append(check);
    } else {
      const mark = document.createElement('span'); mark.className = 'history-check'; mark.textContent = 'âœ“'; article.append(mark);
    }
    const main = document.createElement('div'); main.className = 'task-item-main';
    const title = document.createElement('span'); title.className = 'task-item-title'; title.textContent = task.title;
    const meta = document.createElement('div'); meta.className = 'task-item-meta';
    const priority = document.createElement('span'); priority.className = `priority-tag priority-${task.priority}`; priority.textContent = task.priority;
    const sessions = document.createElement('span'); sessions.textContent = `${task.completedSessions}/${task.estimate} sessions`;
    meta.append(priority, sessions);
    if (state.activeTaskId === task.id && !completed) { const active = document.createElement('span'); active.className = 'task-status-tag'; active.textContent = 'Linked to timer'; meta.append(active); }
    main.append(title, meta);
    if (!completed) { const track = document.createElement('div'); track.className = 'task-progress-mini'; const fill = document.createElement('span'); fill.style.width = `${Math.min(100, task.completedSessions / task.estimate * 100)}%`; track.append(fill); main.append(track); }
    article.append(main);
    const actions = document.createElement('div'); actions.className = 'task-item-actions';
    if (!completed) {
      const link = document.createElement('button'); link.type = 'button'; link.className = 'small-icon-button'; link.dataset.action = 'select-task'; link.dataset.id = task.id; link.setAttribute('aria-label', `Focus on ${task.title}`); link.title = 'Link to focus timer'; link.textContent = state.activeTaskId === task.id ? 'âœ“' : 'â—Ž'; actions.append(link);
      actions.append(iconButton(`Edit ${task.title}`, 'edit-task', task.id, 'âœŽ'));
      actions.append(iconButton(`Delete ${task.title}`, 'delete-task', task.id, 'Ã—', 'danger'));
    } else actions.append(iconButton(`Delete ${task.title}`, 'delete-task', task.id, 'Ã—', 'danger'));
    article.append(actions); return article;
  }
  function renderTasks() {
    const active = state.tasks.filter((task) => !task.done).sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.priority] - { high: 0, medium: 1, low: 2 }[b.priority]) || a.createdAt - b.createdAt);
    const completed = state.tasks.filter((task) => task.done).sort((a, b) => b.createdAt - a.createdAt);
    el.activeTaskCount.textContent = active.length; el.completedTaskCount.textContent = completed.length;
    const activeFragment = document.createDocumentFragment();
    const completedFragment = document.createDocumentFragment();
    if (!active.length) activeFragment.append(emptyState('A clear space to begin', 'Add a small task above. You can link it to a focus session when you are ready.', 'ï¼‹'));
    else active.forEach((task) => activeFragment.append(createTaskCard(task)));
    if (!completed.length) completedFragment.append(emptyState('Nothing completed yet', 'Finished tasks will settle here. Progress can be quiet and still count.', 'âœ“'));
    else completed.forEach((task) => completedFragment.append(createTaskCard(task, true)));
    el.activeTaskList.replaceChildren(activeFragment);
    el.completedTaskList.replaceChildren(completedFragment);
    renderTaskSelect(); renderFocusTask();
  }
  function resetTaskForm() { editTaskId = null; el.taskForm.reset(); el.taskEstimate.value = '2'; el.taskPriority.value = 'medium'; el.taskFormTitle.textContent = 'Add a task'; el.saveTaskButton.textContent = 'Save task'; el.cancelEdit.hidden = true; }
  function submitTask(event) {
    event.preventDefault(); const title = text(el.newTaskTitle.value, 120);
    if (!title) { toast('Add a task name first.', 'warning'); el.newTaskTitle.focus(); return; }
    const estimate = clamp(el.taskEstimate.value, 1, 50, 2); const priority = ['low', 'medium', 'high'].includes(el.taskPriority.value) ? el.taskPriority.value : 'medium';
    const message = editTaskId ? 'Task updated.' : 'Task locked in!';
    if (editTaskId) {
      const task = state.tasks.find((item) => item.id === editTaskId);
      if (task) { task.title = title; task.estimate = estimate; task.priority = priority; if (state.timer.linkedTaskId === task.id) state.timer.linkedTaskTitle = title; }
    } else {
      const task = { id: makeId(), title, estimate, completedSessions: 0, priority, done: false, createdAt: Date.now() }; state.tasks.unshift(task); state.activeTaskId = task.id;
    }
    if (!persist()) return;
    resetTaskForm(); renderTasks(); toast(message, 'success');
  }
  function selectTask(id) { const task = state.tasks.find((item) => item.id === id && !item.done); if (!task) return; state.activeTaskId = id; if (!persist()) return; renderTasks(); renderStats(); toast(`â€œ${task.title}â€ linked to your timer.`, 'success'); }
  function completeTask(id) { const task = state.tasks.find((item) => item.id === id); if (!task) return; task.done = true; if (state.activeTaskId === id) state.activeTaskId = null; if (!persist()) return; renderTasks(); toast('Task marked complete.', 'success'); }
  function editTask(id) { const task = state.tasks.find((item) => item.id === id); if (!task) return; editTaskId = id; el.newTaskTitle.value = task.title; el.taskEstimate.value = task.estimate; el.taskPriority.value = task.priority; el.taskFormTitle.textContent = 'Edit task'; el.saveTaskButton.textContent = 'Update task'; el.cancelEdit.hidden = false; el.newTaskTitle.focus(); el.taskForm.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  function deleteTask(id) { const task = state.tasks.find((item) => item.id === id); if (!task) return; state.tasks = state.tasks.filter((item) => item.id !== id); if (state.activeTaskId === id) state.activeTaskId = null; if (!persist()) return; renderTasks(); toast('Task deleted.', 'info'); }
  el.taskForm.addEventListener('submit', submitTask); el.cancelEdit.addEventListener('click', resetTaskForm);
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]'); if (!button) return;
    const { action, id } = button.dataset;
    if (action === 'select-task') selectTask(id);
    if (action === 'edit-task') editTask(id);
    if (action === 'delete-task') deleteTask(id);
  });
  document.addEventListener('change', (event) => { const input = event.target.closest('[data-action="complete-task"]'); if (input && input.checked) completeTask(input.dataset.id); });

  // ---------- Progress / lightweight Canvas chart ----------
  function renderAnalytics() {
    rangeButtons.forEach((button) => { const active = Number(button.dataset.range) === chartRange; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
    const totalMinutes = Math.round(sumFocusSeconds(state.sessions) / 60);
    el.alltimeMinutes.textContent = String(totalMinutes); el.alltimeSessions.textContent = String(state.sessions.length);
    el.analyticsStreak.textContent = String(effectiveStreak()); el.analyticsLongest.textContent = String(state.streak.longest);
    drawChart();
    if (!state.sessions.length) el.analyticsInsight.textContent = 'Your focus history will appear here after your first completed session.';
    else {
      const latest = state.sessions[0]; const activeTask = latest.taskTitle ? ` on â€œ${latest.taskTitle}â€` : '';
      const entryType = latest.kind === 'partial' ? 'recorded focus time' : 'completed focus session';
      el.analyticsInsight.textContent = `Your latest ${entryType} was ${formatFocusDuration(latest.durationSeconds)}${activeTask}. Small, repeatable sessions build momentum.`;
    }
  }
  function niceAxisMaximum(value) {
    if (!Number.isFinite(value) || value <= 0) return 25;
    const magnitude = 10 ** Math.floor(Math.log10(value));
    const scaled = value / magnitude;
    const nice = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
    return nice * magnitude;
  }

  function drawChart() {
    const canvas = el.chart; const rect = canvas.getBoundingClientRect(); if (!rect.width) return;
    const width = Math.max(1, rect.width); const height = rect.height || 260; const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.round(width * dpr); const pixelHeight = Math.round(height * dpr);
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    let ctx = null;
    try { ctx = canvas.getContext('2d'); } catch (error) { /* unavailable canvas implementation */ }
    if (!ctx) {
      canvas.setAttribute('aria-label', 'Focus activity chart is unavailable in this browser.');
      return;
    }
    canvas.setAttribute('aria-label', 'Focus minutes for the selected date range');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
    const today = dateFromKey(localDateKey());
    const firstDate = new Date(today); firstDate.setDate(today.getDate() - (chartRange - 1));
    const firstKey = localDateKey(firstDate.getTime()); const todayKey = localDateKey(today.getTime());
    const dailyTotals = new Map();
    state.sessions.forEach((session) => {
      const key = localDateKey(session.completedAt);
      if (key >= firstKey && key <= todayKey) dailyTotals.set(key, (dailyTotals.get(key) || 0) + session.durationSeconds);
    });
    const weekdayFormatter = chartRange === 7 ? new Intl.DateTimeFormat(undefined, { weekday: 'short' }) : null;
    const points = [];
    for (let index = chartRange - 1; index >= 0; index--) {
      const date = new Date(today); date.setDate(today.getDate() - index);
      const key = localDateKey(date.getTime());
      points.push({ date, minutes: Math.round((dailyTotals.get(key) || 0) / 60) });
    }
    const total = points.reduce((sum, point) => sum + point.minutes, 0); el.chartTotal.textContent = `${total} minute${total === 1 ? '' : 's'} in this period`;
    const pad = { left: 34, right: 12, top: 18, bottom: 34 }; const plotW = width - pad.left - pad.right; const plotH = height - pad.top - pad.bottom;
    const dataMaximum = Math.max(...points.map((point) => point.minutes), 0);
    const max = Math.max(25, niceAxisMaximum(dataMaximum));
    const themeStyles = getComputedStyle(document.body);
    const gridColor = themeStyles.getPropertyValue('--chart-grid').trim() || 'rgba(160,174,205,.18)';
    const labelColor = themeStyles.getPropertyValue('--chart-label').trim() || '#73809a';
    const mutedColor = themeStyles.getPropertyValue('--chart-muted').trim() || '#8793aa';
    ctx.font = '9px Manrope, sans-serif'; ctx.textBaseline = 'middle';
    ctx.strokeStyle = gridColor; ctx.fillStyle = labelColor; ctx.lineWidth = 1;
    for (let line = 0; line <= 4; line++) {
      const y = pad.top + plotH * line / 4; ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(width - pad.right, y); ctx.stroke();
      ctx.textAlign = 'right'; ctx.fillText(String(Math.round(max * (1 - line / 4))), pad.left - 8, y);
    }
    const slot = plotW / points.length; const barW = Math.max(3, Math.min(chartRange === 7 ? 25 : 12, slot * .55));
    const accent2 = themeStyles.getPropertyValue('--accent-2').trim() || '#22d3ee';
    const accent = themeStyles.getPropertyValue('--accent').trim() || '#7c5cff';
    points.forEach((point, index) => {
      const x = pad.left + slot * index + (slot - barW) / 2; const barH = point.minutes ? Math.max(3, plotH * point.minutes / max) : 0; const y = pad.top + plotH - barH;
      if (barH) { const gradient = ctx.createLinearGradient(0, y, 0, pad.top + plotH); gradient.addColorStop(0, accent2); gradient.addColorStop(1, accent); ctx.fillStyle = gradient; roundRect(ctx, x, y, barW, barH, Math.min(6, barW / 2)); }
      ctx.fillStyle = labelColor; ctx.textAlign = 'center';
      const label = chartRange === 7 ? weekdayFormatter.format(point.date) : (index % 5 === 0 || index === points.length - 1 ? String(point.date.getDate()) : '');
      ctx.fillText(label, x + barW / 2, height - 13);
    });
    if (total === 0) { ctx.fillStyle = mutedColor; ctx.textAlign = 'center'; ctx.font = '11px Manrope, sans-serif'; ctx.fillText('No focus data in this period yet', width / 2, height / 2); }
  }
  function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); ctx.fill(); }
  let chartDrawFrame = 0;
  function scheduleChartDraw() {
    if (progressView.hidden || chartDrawFrame) return;
    const requestFrame = window.requestAnimationFrame || ((callback) => window.setTimeout(callback, 16));
    chartDrawFrame = requestFrame(() => {
      chartDrawFrame = 0;
      if (!progressView.hidden) drawChart();
    });
  }
  rangeButtons.forEach((button) => button.addEventListener('click', () => {
    chartRange = Number(button.dataset.range) === 30 ? 30 : 7;
    state.preferences.chartRange = chartRange;
    if (!persist()) return;
    rangeButtons.forEach((item) => { const active = item === button; item.classList.toggle('active', active); item.setAttribute('aria-pressed', String(active)); });
    scheduleChartDraw();
  }));
  if ('ResizeObserver' in window) {
    chartResizeObserver = new window.ResizeObserver(scheduleChartDraw);
    chartResizeObserver.observe(progressView);
  } else window.addEventListener('resize', scheduleChartDraw, { passive: true });

  // ---------- Preferences, themes and ambient controls ----------
  function applyTheme() {
    const theme = state.preferences.theme;
    document.body.dataset.theme = theme;
    if (themeColorMeta) themeColorMeta.content = theme === 'light' ? '#f6f8fc' : '#070a12';
    scheduleChartDraw();
  }
  function renderSettings() {
    el.alertsToggle.checked = state.preferences.alertsEnabled; el.alertVolume.value = state.preferences.alertVolume; el.alertVolumeValue.value = `${state.preferences.alertVolume}%`; el.alertVolumeValue.textContent = `${state.preferences.alertVolume}%`;
    el.ambientToggle.checked = state.preferences.ambientEnabled; el.ambientType.value = state.preferences.ambientType; el.ambientVolume.value = state.preferences.ambientVolume; el.ambientVolumeValue.value = `${state.preferences.ambientVolume}%`; el.ambientVolumeValue.textContent = `${state.preferences.ambientVolume}%`;
    themeRadios.forEach((radio) => { radio.checked = radio.value === state.preferences.theme; });
    if (themeSelect) themeSelect.value = state.preferences.theme;
    if (el.focusDurationInput) el.focusDurationInput.value = String(state.preferences.focusDurationMinutes);
    if (el.breakDurationInput) el.breakDurationInput.value = String(state.preferences.breakDurationMinutes);
    if (el.autoBreakToggle) el.autoBreakToggle.checked = state.preferences.autoBreak;
  }
  function savePreferences() {
    if (!persist()) return false;
    applyTheme(); renderSettings(); updateAmbientGain();
    return true;
  }
  function openSettings() { renderSettings(); if (typeof el.settingsDialog.showModal === 'function') el.settingsDialog.showModal(); else toast('Settings dialog is not supported in this browser.', 'warning'); }
  function closeSettings() { if (el.settingsDialog.open) el.settingsDialog.close(); }
  el.settingsButton.addEventListener('click', openSettings); el.closeSettings.addEventListener('click', closeSettings); el.settingsDone.addEventListener('click', closeSettings);
  el.settingsDialog.addEventListener('click', (event) => { if (event.target === el.settingsDialog) closeSettings(); });
  el.alertsToggle.addEventListener('change', () => {
    state.preferences.alertsEnabled = el.alertsToggle.checked;
    if (savePreferences()) toast(state.preferences.alertsEnabled ? 'Voice alerts enabled.' : 'Voice alerts muted.', 'info');
  });
  el.alertVolume.addEventListener('input', () => { state.preferences.alertVolume = clamp(el.alertVolume.value, 0, 100, 55); el.alertVolumeValue.textContent = `${state.preferences.alertVolume}%`; savePreferencesDebounced(); });
  el.alertVolume.addEventListener('change', () => savePreferencesDebounced.flush());
  el.ambientToggle.addEventListener('change', () => {
    state.preferences.ambientEnabled = el.ambientToggle.checked;
    if (!savePreferences()) return;
    if (state.preferences.ambientEnabled) { unlockAudio(); startAmbient(); toast('Ambient sound enabled.', 'success'); }
    else { stopAmbient(); toast('Ambient sound off.', 'info'); }
  });
  el.ambientType.addEventListener('change', () => { state.preferences.ambientType = el.ambientType.value; if (!persist()) return; restartAmbient(); });
  el.ambientVolume.addEventListener('input', () => { state.preferences.ambientVolume = clamp(el.ambientVolume.value, 0, 100, 28); el.ambientVolumeValue.textContent = `${state.preferences.ambientVolume}%`; savePreferencesDebounced(); updateAmbientGain(); });
  el.ambientVolume.addEventListener('change', () => savePreferencesDebounced.flush());
  themeRadios.forEach((radio) => radio.addEventListener('change', () => {
    if (radio.checked) handleThemeChange(radio.value);
  }));

  function handleFocusDurationChange() {
    if (!el.focusDurationInput) return;
    const minutes = normalizeMinutes(el.focusDurationInput.value, 1, 24 * 60, 0);
    if (!minutes) {
      el.focusDurationInput.value = String(state.preferences.focusDurationMinutes);
      toast('Choose a whole focus duration between 1 and 1440 minutes.', 'warning');
      return;
    }
    state.preferences.focusDurationMinutes = minutes;
    if (state.timer.mode === 'focus' && state.timer.status === 'idle') {
      state.timer.durationSeconds = minutes * 60;
      state.timer.remainingSeconds = state.timer.durationSeconds;
    }
    if (!savePreferences()) return;
    toast(`Focus duration set to ${minutes} minutes.`, 'success');
    updateTimerUI();
  }

  function handleBreakDurationChange() {
    if (!el.breakDurationInput) return;
    const minutes = normalizeMinutes(el.breakDurationInput.value, 1, 180, 0);
    if (!minutes) {
      el.breakDurationInput.value = String(state.preferences.breakDurationMinutes);
      toast('Choose a whole break duration between 1 and 180 minutes.', 'warning');
      return;
    }
    state.preferences.breakDurationMinutes = minutes;
    if (state.timer.mode === 'break' && state.timer.status === 'idle') {
      state.timer.durationSeconds = minutes * 60;
      state.timer.remainingSeconds = state.timer.durationSeconds;
    }
    if (!savePreferences()) return;
    toast(`Break duration set to ${minutes} minutes.`, 'success');
    updateTimerUI();
  }

  function handleAutoBreakChange() {
    if (!el.autoBreakToggle) return;
    state.preferences.autoBreak = el.autoBreakToggle.checked;
    if (!savePreferences()) return;
    toast(state.preferences.autoBreak ? 'Automatic breaks enabled.' : 'Automatic breaks disabled.', 'info');
  }

  function handleThemeChange(themeValue) {
    if (!['default', 'purple', 'ocean', 'emerald', 'light'].includes(themeValue)) return;
    state.preferences.theme = themeValue;
    const selectedRadio = themeRadios.find((radio) => radio.value === themeValue);
    const themeName = selectedRadio?.parentElement?.querySelector('span:last-child')?.textContent || (themeValue === 'light' ? 'Light' : themeValue);
    if (savePreferences()) toast(`Theme changed to ${themeName}.`, 'success');
  }

  if (el.focusDurationInput) el.focusDurationInput.addEventListener('change', handleFocusDurationChange);
  if (el.breakDurationInput) el.breakDurationInput.addEventListener('change', handleBreakDurationChange);
  if (el.autoBreakToggle) el.autoBreakToggle.addEventListener('change', handleAutoBreakChange);
  if (themeSelect) themeSelect.addEventListener('change', () => handleThemeChange(themeSelect.value));

  // ---------- Welcome / onboarding ----------
  function markOnboarded() {
    try {
      if (!storage) throw new Error('Local storage is unavailable.');
      storage.setItem(KEYS.onboarded, 'yes');
    } catch (error) { storageAvailable = false; }
    updateStorageNote();
  }
  function showWelcome(force = false) {
    if (!force) { try { if (storage && storage.getItem(KEYS.onboarded) === 'yes') return; } catch (error) { /* show welcome when storage is unavailable */ } }
    if (!el.welcomeDialog.open && typeof el.welcomeDialog.showModal === 'function') el.welcomeDialog.showModal();
    else if (!el.welcomeDialog.open) el.welcomeDialog.setAttribute('open', '');
  }
  function closeWelcome() { markOnboarded(); if (el.welcomeDialog.open && typeof el.welcomeDialog.close === 'function') el.welcomeDialog.close(); else el.welcomeDialog.removeAttribute('open'); }
  el.welcomeStart.addEventListener('click', () => { unlockAudio(); closeWelcome(); toast('Welcome to your quiet space.', 'success'); });
  el.helpButton.addEventListener('click', () => showWelcome(true));

  // ---------- Existing focus note and UI events ----------
  function saveFocusNote(showToast = false) {
    saveFocusNoteDebounced.cancel();
    state.taskNote = text(el.taskInput.value, 120);
    if (!persist()) return;
    renderFocusTask();
    el.taskSaveStatus.textContent = storageAvailable ? 'Saved on this device' : 'Not saved â€” storage unavailable';
    if (showToast) toast('Task locked in!', 'success');
  }
  el.taskInput.addEventListener('input', () => {
    state.taskNote = el.taskInput.value.slice(0, 120);
    el.taskCount.textContent = `${el.taskInput.value.length}/120`;
    el.taskSaveStatus.textContent = 'Savingâ€¦';
    renderFocusReminder();
    saveFocusNoteDebounced();
  });
  el.taskInput.addEventListener('change', () => saveFocusNote(true));
  el.clearTask.addEventListener('click', () => {
    saveFocusNoteDebounced.cancel(); el.taskInput.value = ''; state.taskNote = '';
    if (!persist()) return;
    renderFocusTask(); el.taskInput.focus(); toast('Focus note cleared.', 'info');
  });
  el.activeTaskSelect.addEventListener('change', () => {
    const id = el.activeTaskSelect.value || null; state.activeTaskId = id;
    if (!persist()) return;
    renderTasks(); const task = state.tasks.find((item) => item.id === id); if (task) toast(`â€œ${task.title}â€ linked to your timer.`, 'success');
  });
  el.start.addEventListener('click', startTimer); el.pause.addEventListener('click', pauseTimer); el.reset.addEventListener('click', resetTimer); el.anotherSession.addEventListener('click', () => { if (resetTimer()) startTimer(); });
  el.startBreak.addEventListener('click', beginBreak); el.skipBreak.addEventListener('click', skipBreak);
  document.addEventListener('pointerdown', unlockAudio, { once: true }); document.addEventListener('keydown', unlockAudio, { once: true });

  // Handle a page sleeping, refreshing, or crossing a local date boundary.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopTicker();
      stopDayRefreshTicker();
      saveFocusNoteDebounced.flush();
      savePreferencesDebounced.flush();
      return;
    }
    startDayRefreshTicker();
    timerTick();
    if (state.timer.status === 'running' && ticker === null) startTicker();
    refreshLocalDay(); renderStats(); renderTaskSelect();
  });
  startDayRefreshTicker();
  window.addEventListener('pagehide', () => {
    stopTicker();
    stopDayRefreshTicker();
    saveFocusNoteDebounced.flush();
    savePreferencesDebounced.flush();
  });
  window.addEventListener('pageshow', () => { startDayRefreshTicker(); if (state.timer.status === 'running') { timerTick(); if (state.timer.status === 'running' && ticker === null) startTicker(); } renderStats(); });
  window.addEventListener('storage', (event) => {
    if (event.key !== null && event.key !== KEYS.state) return;
    let currentRaw = null;
    try { currentRaw = storage ? storage.getItem(KEYS.state) : null; }
    catch (error) { storageAvailable = false; updateStorageNote(); return; }
    adoptStoredState(currentRaw, true);
    if (event.key === null) showWelcome(false);
  });

  if (
  'serviceWorker' in navigator &&
  (location.protocol === 'https:' ||
   location.hostname === 'localhost' ||
   location.hostname === '127.0.0.1')
) {
  window.addEventListener('load', () => {
    const workerUrl = new URL('./sw.js', document.baseURI);
    const workerScope = new URL('./', document.baseURI).pathname;
    navigator.serviceWorker.register(workerUrl.href, {
      scope: workerScope,
      updateViaCache: 'none'
    }).catch((error) => {
      console.warn('StudyPulse: Service Worker registration failed.', error);
    });
  }, { once: true });
}


  // Restore any running timer from its saved end timestamp.
  renderAll();
  if (state.timer.status === 'running' && state.timer.endAt) {
    const left = Math.ceil((state.timer.endAt - Date.now()) / 1000);
    if (left <= 0) { if (state.timer.mode === 'focus') completeFocusSession(state.timer.endAt); else completeBreak(); }
    else { state.timer.remainingSeconds = left; startTicker(); }
  }
  if (state.preferences.ambientEnabled) { /* Ambient sound waits for a user gesture by browser policy. */ }
  showWelcome(false);
})();
