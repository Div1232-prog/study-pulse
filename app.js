'use strict';

/* StudyPulse v1.1 — local-first focus cockpit. No backend or third-party JS. */
(() => {
  const KEYS = { state: 'focusdeck.v1.1.state', legacy: 'focusdeck.v1.state', onboarded: 'focusdeck.v1.1.onboarded' };
  const DURATIONS = { focus: 25 * 60, break: 5 * 60 };
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
  };
  const startLabel = el.start.querySelector('span');
  const progressView = $('view-progress');
  const themeColorMeta = document.querySelector('meta[name="theme-color"]');

  let storageAvailable = true;
  let ticker = null;
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
    timer: { mode: 'focus', durationSeconds: DURATIONS.focus, remainingSeconds: DURATIONS.focus, status: 'idle', endAt: null, sessionId: null, linkedTaskId: null, linkedTaskTitle: '' },
    taskNote: '', tasks: [], activeTaskId: null, sessions: [],
    streak: { lastFocusDate: null, current: 0, longest: 0 },
    preferences: { alertsEnabled: true, alertVolume: 55, ambientEnabled: false, ambientType: 'rain', ambientVolume: 28, theme: 'default', chartRange: 7 }
  });

  const clamp = (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback;
  const text = (value, max = 120) => typeof value === 'string' ? value.trim().slice(0, max) : '';
  const makeId = () => (window.crypto && typeof window.crypto.randomUUID === 'function') ? window.crypto.randomUUID() : `fd-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

  function normalizeSession(session) {
    if (!session || !Number.isFinite(Number(session.completedAt))) return null;
    return {
      id: text(session.id, 100) || makeId(), completedAt: Number(session.completedAt),
      durationSeconds: clamp(session.durationSeconds, 1, DURATIONS.focus, DURATIONS.focus),
      taskId: text(session.taskId, 100) || null, taskTitle: text(session.taskTitle, 120), mode: 'focus'
    };
  }

  function normalizeState(saved) {
    const state = defaultState();
    if (!saved || typeof saved !== 'object') return state;
    const timer = saved.timer && typeof saved.timer === 'object' ? saved.timer : saved;
    const mode = ['focus', 'break'].includes(timer.mode) ? timer.mode : 'focus';
    const duration = mode === 'break' ? DURATIONS.break : DURATIONS.focus;
    state.timer = {
      mode, durationSeconds: duration,
      remainingSeconds: clamp(timer.remainingSeconds, 0, duration, duration),
      status: ['idle', 'running', 'paused', 'completed'].includes(timer.status) ? timer.status : 'idle',
      endAt: Number.isFinite(Number(timer.endAt)) && timer.endAt !== null ? Number(timer.endAt) : null,
      sessionId: typeof timer.sessionId === 'string' ? timer.sessionId.slice(0, 100) : null,
      linkedTaskId: typeof timer.linkedTaskId === 'string' ? timer.linkedTaskId.slice(0, 100) : null,
      linkedTaskTitle: text(timer.linkedTaskTitle, 120)
    };
    if (state.timer.status === 'running' && (!state.timer.endAt || (mode === 'focus' && !state.timer.sessionId))) {
      state.timer.status = 'paused'; state.timer.endAt = null;
    }
    if (state.timer.status !== 'running') state.timer.endAt = null;
    if (state.timer.status === 'completed') state.timer.remainingSeconds = 0;
    state.taskNote = text(saved.taskNote !== undefined ? saved.taskNote : saved.task, 120);
    state.tasks = Array.isArray(saved.tasks) ? saved.tasks.map((task) => {
      if (!task || typeof task !== 'object') return null;
      return {
        id: text(task.id, 100) || makeId(), title: text(task.title, 120),
        estimate: clamp(task.estimate, 1, 50, 2), completedSessions: clamp(task.completedSessions, 0, 9999, 0),
        priority: ['low', 'medium', 'high'].includes(task.priority) ? task.priority : 'medium', done: Boolean(task.done), createdAt: Number(task.createdAt) || Date.now()
      };
    }).filter((task) => task && task.title) : [];
    state.activeTaskId = text(saved.activeTaskId, 100) || null;
    if (!state.tasks.some((task) => task.id === state.activeTaskId && !task.done)) state.activeTaskId = null;
    state.sessions = Array.isArray(saved.sessions) ? saved.sessions.map(normalizeSession).filter(Boolean).sort((a, b) => b.completedAt - a.completedAt).slice(0, MAX_SESSIONS) : [];
    const streak = saved.streak && typeof saved.streak === 'object' ? saved.streak : {};
    state.streak = {
      lastFocusDate: /^\d{4}-\d{2}-\d{2}$/.test(streak.lastFocusDate || '') ? streak.lastFocusDate : null,
      current: clamp(streak.current, 0, 9999, 0), longest: clamp(streak.longest, 0, 9999, 0)
    };
    const prefs = saved.preferences && typeof saved.preferences === 'object' ? saved.preferences : {};
    state.preferences = {
      alertsEnabled: prefs.alertsEnabled !== false,
      alertVolume: clamp(prefs.alertVolume, 0, 100, 55),
      ambientEnabled: Boolean(prefs.ambientEnabled),
      ambientType: ['rain', 'white', 'cafe'].includes(prefs.ambientType) ? prefs.ambientType : 'rain',
      ambientVolume: clamp(prefs.ambientVolume, 0, 100, 28),
      theme: ['default', 'purple', 'ocean', 'emerald'].includes(prefs.theme) ? prefs.theme : 'default',
      chartRange: Number(prefs.chartRange) === 30 ? 30 : 7
    };
    if (!state.streak.lastFocusDate && state.sessions.length) rebuildStreak(state);
    return state;
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
    try {
      const current = localStorage.getItem(KEYS.state);
      if (current) return normalizeState(JSON.parse(current));
      const legacy = localStorage.getItem(KEYS.legacy);
      if (legacy) {
        const old = JSON.parse(legacy);
        const migrated = normalizeState({ ...old, taskNote: old.task || '', timer: {
          mode: 'focus', durationSeconds: DURATIONS.focus, remainingSeconds: old.remainingSeconds,
          status: old.status, endAt: old.endAt, sessionId: old.sessionId, linkedTaskId: null, linkedTaskTitle: ''
        }});
        persist(migrated);
        return migrated;
      }
      return defaultState();
    } catch (error) {
      storageAvailable = false;
      return defaultState();
    }
  }

  let state = loadState();
  chartRange = state.preferences.chartRange;

  function persist(value = state) {
    try { localStorage.setItem(KEYS.state, JSON.stringify(value)); storageAvailable = true; }
    catch (error) { storageAvailable = false; }
    updateStorageNote();
  }
  let lastStorageNote = '';
  function updateStorageNote() {
    const message = storageAvailable ? 'Your focus data stays on this device.' : 'Browser storage is unavailable. Your progress may not survive a refresh.';
    if (message !== lastStorageNote) {
      el.storageNote.textContent = message;
      lastStorageNote = message;
    }
    el.storageNote.classList.toggle('storage-warning', !storageAvailable);
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
    persist();
    el.taskSaveStatus.textContent = 'Saved on this device';
  }, 260);
  const savePreferencesDebounced = debounce(() => persist(), 260);

  function localDateKey(timestamp = Date.now()) {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  function dayOrdinal(dateKey) {
    const [year, month, day] = dateKey.split('-').map(Number);
    return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
  }
  function dateFromKey(key) { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d, 12); }
  function formatDateLabel(date) { return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(date).toUpperCase(); }
  function formatTime(timestamp) { return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(timestamp)); }
  function formatClock(seconds) { const n = Math.max(0, Math.ceil(seconds)); return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`; }
  function effectiveStreak() {
    if (!state.streak.lastFocusDate) return 0;
    const gap = dayOrdinal(localDateKey()) - dayOrdinal(state.streak.lastFocusDate);
    return gap <= 1 ? state.streak.current : 0;
  }
  function bumpStreak(completedAt) {
    const day = localDateKey(completedAt);
    const last = state.streak.lastFocusDate;
    if (last === day) return false;
    const gap = last ? dayOrdinal(day) - dayOrdinal(last) : 0;
    state.streak.current = !last || gap > 1 || gap < 0 ? 1 : state.streak.current + 1;
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
    if (!audioContext) audioContext = new Ctx();
    return audioContext;
  }
  function unlockAudio() {
    if (audioUnlocked) return;
    audioUnlocked = true;
    const ctx = getAudioContext();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    if ('speechSynthesis' in window) window.speechSynthesis.getVoices();
    if (state.preferences.ambientEnabled) startAmbient();
  }
  function playTone(frequency = 660, duration = .16, volumeScale = 1) {
    if (!state.preferences.alertsEnabled || state.preferences.alertVolume <= 0) return;
    const ctx = getAudioContext(); if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const oscillator = ctx.createOscillator(); const gain = ctx.createGain();
    oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);
    const volume = (state.preferences.alertVolume / 100) * .075 * volumeScale;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(Math.max(.0002, volume), ctx.currentTime + .025);
    gain.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + duration);
    oscillator.connect(gain).connect(ctx.destination); oscillator.start(); oscillator.stop(ctx.currentTime + duration + .03);
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
    ambientGraph = null;
  }
  function startAmbient() {
    if (!state.preferences.ambientEnabled || ambientGraph) return;
    const ctx = getAudioContext(); if (!ctx) { toast('Ambient audio is not supported in this browser.', 'warning'); return; }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const length = Math.floor(ctx.sampleRate * 2.5); const buffer = ctx.createBuffer(1, length, ctx.sampleRate); const data = buffer.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      brown = (brown + .02 * white) / 1.02;
      data[i] = state.preferences.ambientType === 'white' ? white * .45 : (brown * 3.2 + white * .08);
    }
    const source = ctx.createBufferSource(); source.buffer = buffer; source.loop = true;
    const filter = ctx.createBiquadFilter();
    const type = state.preferences.ambientType;
    filter.type = type === 'white' ? 'highpass' : type === 'cafe' ? 'bandpass' : 'lowpass';
    filter.frequency.value = type === 'white' ? 950 : type === 'cafe' ? 850 : 1250;
    filter.Q.value = type === 'cafe' ? .75 : .45;
    const gain = ctx.createGain(); gain.gain.value = 0.0001;
    source.connect(filter).connect(gain).connect(ctx.destination); source.start();
    let lfo = null;
    if (type === 'cafe') {
      lfo = ctx.createOscillator(); const lfoGain = ctx.createGain(); lfo.frequency.value = .16; lfoGain.gain.value = .0008;
      lfo.connect(lfoGain).connect(gain.gain); lfo.start();
    }
    ambientGraph = { source, filter, gain, lfo };
    updateAmbientGain();
  }
  function updateAmbientGain() {
    if (!ambientGraph || !audioContext) return;
    const breakMultiplier = state.timer.mode === 'break' ? .35 : 1;
    const value = state.preferences.ambientEnabled ? (state.preferences.ambientVolume / 100) * .11 * breakMultiplier : .0001;
    ambientGraph.gain.gain.setTargetAtTime(Math.max(.0001, value), audioContext.currentTime, .35);
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
    window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
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
    else if (timer.status === 'paused') { el.timerState.textContent = 'Paused — take your time'; el.timerHint.textContent = 'Pick up where you left off when you are ready.'; }
    else if (timer.status === 'completed') { el.timerState.textContent = 'A session well spent'; el.timerHint.textContent = 'You made space for focused work.'; }
    else { el.timerState.textContent = timer.mode === 'break' ? 'Break ready' : 'Ready when you are'; el.timerHint.textContent = 'Find a comfortable position and begin.'; }
    el.completionCard.hidden = timer.mode !== 'focus' || timer.status !== 'completed';
    el.breakBreathing.hidden = timer.mode !== 'break';
    const nextTitle = `${formatClock(remaining)} · StudyPulse`;
    if (nextTitle !== lastTimerTitle) { document.title = nextTitle; lastTimerTitle = nextTitle; }
    if (timer.mode === 'break') updateBreathingPhase(remaining);
  }
  function updateBreathingPhase(remaining) {
    const elapsed = Math.max(0, DURATIONS.break - remaining);
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
    el.focusMinutes.textContent = String(todaySessions.reduce((sum, session) => sum + Math.round(session.durationSeconds / 60), 0));
    el.sessionsCount.textContent = String(todaySessions.length);
    const historyFragment = document.createDocumentFragment();
    if (!todaySessions.length) {
      const empty = document.createElement('li'); empty.className = 'empty-history'; empty.textContent = 'Your completed sessions will appear here.'; historyFragment.append(empty);
    } else todaySessions.slice(0, 8).forEach((session) => {
      const li = document.createElement('li'); li.className = 'history-row';
      const check = document.createElement('span'); check.className = 'history-check'; check.setAttribute('aria-hidden', 'true'); check.textContent = '✓';
      const label = document.createElement('span'); label.className = 'history-row-label'; label.textContent = `${Math.round(session.durationSeconds / 60)} min · ${session.taskTitle || 'Focus session'}`;
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
      ? `Linked task: ${active.title} · ${active.completedSessions}/${active.estimate} estimated sessions`
      : state.taskNote
        ? `Your focus note: ${state.taskNote}`
        : 'Keep it small. Your only job is the next 25 minutes.';
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
  function completeFocusSession(completedAt) {
    const timer = state.timer;
    if (timer.status === 'completed' || timer.mode !== 'focus') return;
    stopTicker();
    const at = Number.isFinite(completedAt) ? completedAt : Date.now();
    const duplicate = timer.sessionId && state.sessions.some((session) => session.id === timer.sessionId);
    if (!duplicate && timer.sessionId) {
      const task = state.tasks.find((item) => item.id === timer.linkedTaskId);
      state.sessions.unshift({ id: timer.sessionId, completedAt: at, durationSeconds: timer.durationSeconds, taskId: timer.linkedTaskId || null, taskTitle: timer.linkedTaskTitle || task?.title || '' });
      state.sessions = state.sessions.slice(0, MAX_SESSIONS);
      if (task && !task.done) task.completedSessions = Math.min(9999, task.completedSessions + 1);
      const streakAdvanced = bumpStreak(at);
      if (streakAdvanced) {
        el.streakFlame.classList.remove('flame-pop'); void el.streakFlame.offsetWidth; el.streakFlame.classList.add('flame-pop');
        toast(`Streak updated: ${effectiveStreak()} day${effectiveStreak() === 1 ? '' : 's'}!`, 'success');
      }
    }
    timer.status = 'completed'; timer.remainingSeconds = 0; timer.endAt = null;
    persist(); renderAll();
    el.completionDescription.textContent = `You completed ${Math.round(timer.durationSeconds / 60)} minutes of focused work. Take a gentle break before your next session.`;
    toast('Session saved. Beautiful work.', 'success'); announce('Take a break', 740); updateAmbientGain();
  }
  function completeBreak() {
    stopTicker();
    state.timer = { mode: 'focus', durationSeconds: DURATIONS.focus, remainingSeconds: DURATIONS.focus, status: 'idle', endAt: null, sessionId: null, linkedTaskId: null, linkedTaskTitle: '' };
    persist(); renderAll(); toast('Break complete. Ready when you are.', 'success'); announce('Break complete. Ready to focus', 590); updateAmbientGain();
  }
  function refreshLocalDay() {
    const today = localDateKey();
    if (today === lastRenderedDay) return;
    lastRenderedDay = today;
    el.todayLabel.textContent = formatDateLabel(new Date());
    renderStats();
    if (!progressView.hidden) renderAnalytics();
  }
  function timerTick() {
    refreshLocalDay();
    const timer = state.timer;
    if (timer.status !== 'running' || !timer.endAt) return;
    const remaining = Math.ceil((timer.endAt - Date.now()) / 1000);
    if (remaining <= 0) { if (timer.mode === 'focus') completeFocusSession(timer.endAt); else completeBreak(); return; }
    timer.remainingSeconds = remaining; updateTimerUI();
  }
  function startTicker() { stopTicker(); timerTick(); if (state.timer.status === 'running') ticker = window.setInterval(timerTick, 1000); }
  function startTimer() {
    unlockAudio();
    const timer = state.timer;
    if (timer.status === 'running') return;
    if (timer.mode === 'break') { if (timer.status === 'completed') { toast('Break already completed.', 'info'); return; } }
    else if (timer.status === 'completed' || timer.remainingSeconds <= 0) {
      timer.mode = 'focus'; timer.durationSeconds = DURATIONS.focus; timer.remainingSeconds = DURATIONS.focus; timer.status = 'idle'; timer.sessionId = null; timer.linkedTaskId = null; timer.linkedTaskTitle = '';
    }
    if (timer.mode === 'focus' && !timer.sessionId) {
      timer.sessionId = makeId(); timer.linkedTaskId = state.activeTaskId;
      const linked = state.tasks.find((task) => task.id === state.activeTaskId); timer.linkedTaskTitle = linked ? linked.title : state.taskNote;
    }
    timer.status = 'running'; timer.endAt = Date.now() + timer.remainingSeconds * 1000;
    persist(); updateTimerUI(); startTicker(); updateAmbientGain();
    if (timer.mode === 'focus') { announce('Focus session started', 520); toast('Focus session started. You’ve got this.', 'info'); }
    else toast('Break started. Follow your breathing.', 'info');
  }
  function pauseTimer() {
    const timer = state.timer; if (timer.status !== 'running' || !timer.endAt) return;
    const remaining = Math.ceil((timer.endAt - Date.now()) / 1000);
    if (remaining <= 0) { timerTick(); return; }
    stopTicker(); timer.remainingSeconds = remaining; timer.status = 'paused'; timer.endAt = null; persist(); updateTimerUI(); updateAmbientGain(); toast('Timer paused.', 'info');
  }
  function resetTimer() {
    stopTicker(); state.timer = { mode: 'focus', durationSeconds: DURATIONS.focus, remainingSeconds: DURATIONS.focus, status: 'idle', endAt: null, sessionId: null, linkedTaskId: null, linkedTaskTitle: '' };
    persist(); updateTimerUI(); el.completionCard.hidden = true; updateAmbientGain(); toast('Timer reset to 25:00.', 'info');
  }
  function beginBreak() {
    stopTicker(); state.timer = { mode: 'break', durationSeconds: DURATIONS.break, remainingSeconds: DURATIONS.break, status: 'running', endAt: Date.now() + DURATIONS.break * 1000, sessionId: null, linkedTaskId: null, linkedTaskTitle: '' };
    persist(); renderTimerUIAndAux(); startTicker(); updateAmbientGain(); toast('Five-minute break started.', 'info');
  }
  function skipBreak() { if (state.timer.mode !== 'break') return; stopTicker(); state.timer = { mode: 'focus', durationSeconds: DURATIONS.focus, remainingSeconds: DURATIONS.focus, status: 'idle', endAt: null, sessionId: null, linkedTaskId: null, linkedTaskTitle: '' }; persist(); renderTimerUIAndAux(); updateAmbientGain(); toast('Break skipped. Back to focus when ready.', 'info'); }

  // ---------- Task manager ----------
  function emptyState(title, description, symbol = '✧') {
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
      const mark = document.createElement('span'); mark.className = 'history-check'; mark.textContent = '✓'; article.append(mark);
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
      const link = document.createElement('button'); link.type = 'button'; link.className = 'small-icon-button'; link.dataset.action = 'select-task'; link.dataset.id = task.id; link.setAttribute('aria-label', `Focus on ${task.title}`); link.title = 'Link to focus timer'; link.textContent = state.activeTaskId === task.id ? '✓' : '◎'; actions.append(link);
      actions.append(iconButton(`Edit ${task.title}`, 'edit-task', task.id, '✎'));
      actions.append(iconButton(`Delete ${task.title}`, 'delete-task', task.id, '×', 'danger'));
    } else actions.append(iconButton(`Delete ${task.title}`, 'delete-task', task.id, '×', 'danger'));
    article.append(actions); return article;
  }
  function renderTasks() {
    const active = state.tasks.filter((task) => !task.done).sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.priority] - { high: 0, medium: 1, low: 2 }[b.priority]) || a.createdAt - b.createdAt);
    const completed = state.tasks.filter((task) => task.done).sort((a, b) => b.createdAt - a.createdAt);
    el.activeTaskCount.textContent = active.length; el.completedTaskCount.textContent = completed.length;
    const activeFragment = document.createDocumentFragment();
    const completedFragment = document.createDocumentFragment();
    if (!active.length) activeFragment.append(emptyState('A clear space to begin', 'Add a small task above. You can link it to a focus session when you are ready.', '＋'));
    else active.forEach((task) => activeFragment.append(createTaskCard(task)));
    if (!completed.length) completedFragment.append(emptyState('Nothing completed yet', 'Finished tasks will settle here. Progress can be quiet and still count.', '✓'));
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
    if (editTaskId) {
      const task = state.tasks.find((item) => item.id === editTaskId);
      if (task) { task.title = title; task.estimate = estimate; task.priority = priority; if (state.timer.linkedTaskId === task.id) state.timer.linkedTaskTitle = title; }
      toast('Task updated.', 'success');
    } else {
      const task = { id: makeId(), title, estimate, completedSessions: 0, priority, done: false, createdAt: Date.now() }; state.tasks.unshift(task); state.activeTaskId = task.id; toast('Task locked in!', 'success');
    }
    persist(); resetTaskForm(); renderTasks();
  }
  function selectTask(id) { const task = state.tasks.find((item) => item.id === id && !item.done); if (!task) return; state.activeTaskId = id; persist(); renderTasks(); renderStats(); toast(`“${task.title}” linked to your timer.`, 'success'); }
  function completeTask(id) { const task = state.tasks.find((item) => item.id === id); if (!task) return; task.done = true; if (state.activeTaskId === id) state.activeTaskId = null; persist(); renderTasks(); toast('Task marked complete.', 'success'); }
  function editTask(id) { const task = state.tasks.find((item) => item.id === id); if (!task) return; editTaskId = id; el.newTaskTitle.value = task.title; el.taskEstimate.value = task.estimate; el.taskPriority.value = task.priority; el.taskFormTitle.textContent = 'Edit task'; el.saveTaskButton.textContent = 'Update task'; el.cancelEdit.hidden = false; el.newTaskTitle.focus(); el.taskForm.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  function deleteTask(id) { const task = state.tasks.find((item) => item.id === id); if (!task) return; state.tasks = state.tasks.filter((item) => item.id !== id); if (state.activeTaskId === id) state.activeTaskId = null; persist(); renderTasks(); toast('Task deleted.', 'info'); }
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
    const totalMinutes = state.sessions.reduce((sum, session) => sum + Math.round(session.durationSeconds / 60), 0);
    el.alltimeMinutes.textContent = String(totalMinutes); el.alltimeSessions.textContent = String(state.sessions.length);
    el.analyticsStreak.textContent = String(effectiveStreak()); el.analyticsLongest.textContent = String(state.streak.longest);
    drawChart();
    if (!state.sessions.length) el.analyticsInsight.textContent = 'Your focus history will appear here after your first completed session.';
    else {
      const latest = state.sessions[0]; const activeTask = latest.taskTitle ? ` on “${latest.taskTitle}”` : '';
      el.analyticsInsight.textContent = `Your latest completed session was ${Math.round(latest.durationSeconds / 60)} minutes${activeTask}. Small, repeatable sessions build momentum.`;
    }
  }
  function drawChart() {
    const canvas = el.chart; const rect = canvas.getBoundingClientRect(); if (!rect.width) return;
    const width = Math.max(1, rect.width); const height = rect.height || 260; const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.round(width * dpr); const pixelHeight = Math.round(height * dpr);
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
    const today = dateFromKey(localDateKey());
    const firstDate = new Date(today); firstDate.setDate(today.getDate() - (chartRange - 1));
    const firstKey = localDateKey(firstDate.getTime()); const todayKey = localDateKey(today.getTime());
    const dailyTotals = new Map();
    state.sessions.forEach((session) => {
      const key = localDateKey(session.completedAt);
      if (key >= firstKey && key <= todayKey) dailyTotals.set(key, (dailyTotals.get(key) || 0) + Math.round(session.durationSeconds / 60));
    });
    const weekdayFormatter = chartRange === 7 ? new Intl.DateTimeFormat(undefined, { weekday: 'short' }) : null;
    const points = [];
    for (let index = chartRange - 1; index >= 0; index--) {
      const date = new Date(today); date.setDate(today.getDate() - index);
      const key = localDateKey(date.getTime());
      points.push({ date, minutes: dailyTotals.get(key) || 0 });
    }
    const total = points.reduce((sum, point) => sum + point.minutes, 0); el.chartTotal.textContent = `${total} minute${total === 1 ? '' : 's'} in this period`;
    const pad = { left: 34, right: 12, top: 18, bottom: 34 }; const plotW = width - pad.left - pad.right; const plotH = height - pad.top - pad.bottom;
    const max = Math.max(25, Math.ceil(Math.max(...points.map((p) => p.minutes), 0) / 25) * 25);
    ctx.font = '9px Manrope, sans-serif'; ctx.textBaseline = 'middle';
    ctx.strokeStyle = 'rgba(160,174,205,.13)'; ctx.fillStyle = '#73809a'; ctx.lineWidth = 1;
    for (let line = 0; line <= 4; line++) {
      const y = pad.top + plotH * line / 4; ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(width - pad.right, y); ctx.stroke();
      ctx.textAlign = 'right'; ctx.fillText(String(Math.round(max * (1 - line / 4))), pad.left - 8, y);
    }
    const slot = plotW / points.length; const barW = Math.max(3, Math.min(chartRange === 7 ? 25 : 12, slot * .55));
    const themeStyles = getComputedStyle(document.body);
    const accent2 = themeStyles.getPropertyValue('--accent-2').trim() || '#22d3ee';
    const accent = themeStyles.getPropertyValue('--accent').trim() || '#7c5cff';
    points.forEach((point, index) => {
      const x = pad.left + slot * index + (slot - barW) / 2; const barH = point.minutes ? Math.max(3, plotH * point.minutes / max) : 0; const y = pad.top + plotH - barH;
      if (barH) { const gradient = ctx.createLinearGradient(0, y, 0, pad.top + plotH); gradient.addColorStop(0, accent2); gradient.addColorStop(1, accent); ctx.fillStyle = gradient; roundRect(ctx, x, y, barW, barH, Math.min(6, barW / 2)); }
      ctx.fillStyle = '#77849b'; ctx.textAlign = 'center';
      const label = chartRange === 7 ? weekdayFormatter.format(point.date) : (index % 5 === 0 || index === points.length - 1 ? String(point.date.getDate()) : '');
      ctx.fillText(label, x + barW / 2, height - 13);
    });
    if (total === 0) { ctx.fillStyle = '#8793aa'; ctx.textAlign = 'center'; ctx.font = '11px Manrope, sans-serif'; ctx.fillText('No focus data in this period yet', width / 2, height / 2); }
  }
  function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); ctx.fill(); }
  let chartDrawFrame = 0;
  function scheduleChartDraw() {
    if (progressView.hidden || chartDrawFrame) return;
    chartDrawFrame = window.requestAnimationFrame(() => {
      chartDrawFrame = 0;
      if (!progressView.hidden) drawChart();
    });
  }
  rangeButtons.forEach((button) => button.addEventListener('click', () => {
    chartRange = Number(button.dataset.range) === 30 ? 30 : 7;
    state.preferences.chartRange = chartRange; persist();
    rangeButtons.forEach((item) => { const active = item === button; item.classList.toggle('active', active); item.setAttribute('aria-pressed', String(active)); });
    scheduleChartDraw();
  }));
  if ('ResizeObserver' in window) {
    chartResizeObserver = new ResizeObserver(scheduleChartDraw);
    chartResizeObserver.observe(progressView);
  } else window.addEventListener('resize', scheduleChartDraw, { passive: true });

  // ---------- Preferences, themes and ambient controls ----------
  function applyTheme() { document.body.dataset.theme = state.preferences.theme; if (themeColorMeta) themeColorMeta.content = '#070a12'; }
  function renderSettings() {
    el.alertsToggle.checked = state.preferences.alertsEnabled; el.alertVolume.value = state.preferences.alertVolume; el.alertVolumeValue.value = `${state.preferences.alertVolume}%`; el.alertVolumeValue.textContent = `${state.preferences.alertVolume}%`;
    el.ambientToggle.checked = state.preferences.ambientEnabled; el.ambientType.value = state.preferences.ambientType; el.ambientVolume.value = state.preferences.ambientVolume; el.ambientVolumeValue.value = `${state.preferences.ambientVolume}%`; el.ambientVolumeValue.textContent = `${state.preferences.ambientVolume}%`;
    themeRadios.forEach((radio) => { radio.checked = radio.value === state.preferences.theme; });
  }
  function savePreferences() { persist(); applyTheme(); renderSettings(); updateAmbientGain(); }
  function openSettings() { renderSettings(); if (typeof el.settingsDialog.showModal === 'function') el.settingsDialog.showModal(); else toast('Settings dialog is not supported in this browser.', 'warning'); }
  function closeSettings() { if (el.settingsDialog.open) el.settingsDialog.close(); }
  el.settingsButton.addEventListener('click', openSettings); el.closeSettings.addEventListener('click', closeSettings); el.settingsDone.addEventListener('click', closeSettings);
  el.settingsDialog.addEventListener('click', (event) => { if (event.target === el.settingsDialog) closeSettings(); });
  el.alertsToggle.addEventListener('change', () => { state.preferences.alertsEnabled = el.alertsToggle.checked; savePreferences(); toast(state.preferences.alertsEnabled ? 'Voice alerts enabled.' : 'Voice alerts muted.', 'info'); });
  el.alertVolume.addEventListener('input', () => { state.preferences.alertVolume = clamp(el.alertVolume.value, 0, 100, 55); el.alertVolumeValue.textContent = `${state.preferences.alertVolume}%`; savePreferencesDebounced(); });
  el.alertVolume.addEventListener('change', () => savePreferencesDebounced.flush());
  el.ambientToggle.addEventListener('change', () => { state.preferences.ambientEnabled = el.ambientToggle.checked; savePreferences(); if (state.preferences.ambientEnabled) { unlockAudio(); startAmbient(); toast('Ambient sound enabled.', 'success'); } else { stopAmbient(); toast('Ambient sound off.', 'info'); } });
  el.ambientType.addEventListener('change', () => { state.preferences.ambientType = el.ambientType.value; persist(); restartAmbient(); });
  el.ambientVolume.addEventListener('input', () => { state.preferences.ambientVolume = clamp(el.ambientVolume.value, 0, 100, 28); el.ambientVolumeValue.textContent = `${state.preferences.ambientVolume}%`; savePreferencesDebounced(); updateAmbientGain(); });
  el.ambientVolume.addEventListener('change', () => savePreferencesDebounced.flush());
  themeRadios.forEach((radio) => radio.addEventListener('change', () => { state.preferences.theme = radio.value; savePreferences(); toast(`Theme changed to ${radio.parentElement.querySelector('span:last-child').textContent}.`, 'success'); }));

  // ---------- Welcome / onboarding ----------
  function markOnboarded() { try { localStorage.setItem(KEYS.onboarded, 'yes'); } catch (error) { storageAvailable = false; } }
  function showWelcome(force = false) {
    if (!force) { try { if (localStorage.getItem(KEYS.onboarded) === 'yes') return; } catch (error) { /* show welcome when storage is unavailable */ } }
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
    persist(); renderFocusTask();
    el.taskSaveStatus.textContent = 'Saved on this device';
    if (showToast) toast('Task locked in!', 'success');
  }
  el.taskInput.addEventListener('input', () => {
    state.taskNote = el.taskInput.value.slice(0, 120);
    el.taskCount.textContent = `${el.taskInput.value.length}/120`;
    el.taskSaveStatus.textContent = 'Saving…';
    renderFocusReminder();
    saveFocusNoteDebounced();
  });
  el.taskInput.addEventListener('change', () => saveFocusNote(true));
  el.clearTask.addEventListener('click', () => { saveFocusNoteDebounced.cancel(); el.taskInput.value = ''; state.taskNote = ''; persist(); renderFocusTask(); el.taskInput.focus(); toast('Focus note cleared.', 'info'); });
  el.activeTaskSelect.addEventListener('change', () => { const id = el.activeTaskSelect.value || null; state.activeTaskId = id; persist(); renderTasks(); const task = state.tasks.find((item) => item.id === id); if (task) toast(`“${task.title}” linked to your timer.`, 'success'); });
  el.start.addEventListener('click', startTimer); el.pause.addEventListener('click', pauseTimer); el.reset.addEventListener('click', resetTimer); el.anotherSession.addEventListener('click', () => { resetTimer(); startTimer(); });
  el.startBreak.addEventListener('click', beginBreak); el.skipBreak.addEventListener('click', skipBreak);
  document.addEventListener('pointerdown', unlockAudio, { once: true }); document.addEventListener('keydown', unlockAudio, { once: true });

  // Handle a page sleeping, refreshing, or crossing a local date boundary.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopTicker();
      saveFocusNoteDebounced.flush();
      savePreferencesDebounced.flush();
      return;
    }
    timerTick();
    if (state.timer.status === 'running' && ticker === null) startTicker();
    refreshLocalDay(); renderStats(); renderTaskSelect();
  });
  window.setInterval(refreshLocalDay, 60000);
  window.addEventListener('pagehide', () => {
    saveFocusNoteDebounced.flush();
    savePreferencesDebounced.flush();
    persist();
  });
  window.addEventListener('pageshow', () => { if (state.timer.status === 'running') { timerTick(); if (state.timer.status === 'running' && ticker === null) startTicker(); } renderStats(); });
  window.addEventListener('storage', (event) => { if (event.key === KEYS.state && event.newValue) { try { state = normalizeState(JSON.parse(event.newValue)); renderAll(); } catch (error) { toast('Could not sync changes from another tab.', 'warning'); } } });

  if (
  'serviceWorker' in navigator &&
  (location.protocol === 'https:' ||
   location.hostname === 'localhost' ||
   location.hostname === '127.0.0.1')
) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', {
      scope: '/',
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
