# StudyPulse v1.1

**Zero-Friction Focus, Right in Your Browser.** A local-first, mobile-friendly focus cockpit built with HTML, CSS, and vanilla JavaScript. There are no accounts, paid APIs, ads, backend services, or external JavaScript libraries.

## Run it

1. Keep `index.html`, `style.css`, and `app.js` in the same folder.
2. Open `index.html` in a modern browser.
3. The welcome panel appears on first open. Choose **Start Focusing**.
4. Add a task or a focus note, then press **Start focus**.

No package installation or build step is required. The app works as a browser page. Browser audio features require a user interaction first; this is a browser autoplay restriction, not an app account or permission requirement.

## What's new in v1.1

### Welcome and help
- First-open onboarding modal with the exact tagline, feature overview, and zero-friction explanation.
- The `?` button in the header reopens the help panel at any time.
- The first-open flag is saved separately in LocalStorage.

### Voice and audio notifications
- Uses SpeechSynthesis to announce focus start, focus completion (`Take a break`), and break completion.
- Soft notification tones are generated with the Web Audio API; if speech synthesis is unavailable, the beep remains the fallback.
- Settings include a mute toggle and alert volume. No external audio files are loaded.

### Toast feedback
- Toasts are queued so they do not overlap, use success/info/warning styles, and dismiss after three seconds.
- The toast region is an accessible live region.

### Streaks
- Current and longest streaks are stored locally and displayed on the Focus and Progress screens.
- Streak dates use the browser's local calendar date. A streak remains active on the day after the last focus day; it resets only after a full missed calendar day.

### Ambient sound
- Rain, white noise, and a softly filtered café-like soundscape are synthesized in the browser with Web Audio API.
- Ambient choice and volume persist. The sound automatically lowers during breaks.
- Sound starts only after user interaction, respecting browser autoplay policies.

### Tasks
- Add, edit, delete, complete, and prioritize tasks (Low / Medium / High).
- Set estimated sessions per task and see completed session counts.
- Link one active task to the focus timer. Completed focus sessions increment the linked task's session count.
- Completed tasks are grouped separately. Task data stays in LocalStorage.

### Progress and analytics
- Lightweight Canvas chart with a 7-day / 30-day range switch.
- Total focus minutes, total sessions, current streak, and longest streak.
- Empty-state feedback when there is no focus history.

### Breathing and breaks
- A completed 25-minute focus session offers a five-minute break; the break is suggested, not forced.
- The breathing guide uses four-second inhale, hold, exhale, and hold phases.
- Users can skip the break. A gentle chime/voice announcement plays at break end when alerts are enabled.

### Themes
- Default, Cyberpunk Purple, Ocean Cyan, and Emerald Green accents.
- Theme selection is applied using CSS variables and saved locally.

## Local data and migration

All app data is stored in this browser's LocalStorage under `focusdeck.v1.1.state`; the first-open flag uses `focusdeck.v1.1.onboarded`. No names, email addresses, answers, or analytics are sent to a server. The app attempts to migrate the earlier `focusdeck.v1.state` data (timer, current note, and completed sessions) the first time v1.1 loads.

Clearing browser site data can remove locally stored tasks, preferences, streaks, and session history. The storage is browser/device-specific and is not cloud-synced.

## Feature test checklist

- **Welcome:** clear the `focusdeck.v1.1.onboarded` LocalStorage key and refresh. The modal should appear. Press `?` later to reopen it.
- **Voice/beep:** enable alerts in Settings, click Start focus, and listen for the start announcement/tone. To avoid waiting 25 minutes during testing, temporarily set `DURATIONS.focus` in `app.js` to `15` seconds, complete a session, then restore it to `25 * 60`.
- **Mute/volume:** switch Sound notifications off, or set alert volume to zero, and check that announcements/tones are muted.
- **Toast queue:** pause, reset, change a theme, or save a task quickly. Toasts should appear one at a time and disappear after three seconds.
- **Streak:** complete one focus session today; the current streak should become one. Complete another session on the same local date; it should remain one. The longest streak should be retained.
- **Ambient:** open Settings, enable Ambient audio, and switch between Rain, White noise, and Café. Adjust volume. During a break, sound should become softer.
- **Tasks:** add tasks with different priorities and estimates. Link one task to the timer, complete a focus session, and confirm its completed-session count increments. Edit, complete, and delete tasks.
- **Analytics:** finish a session, open Progress, and switch between 7 days and 30 days. The chart and summary should reflect actual locally stored sessions.
- **Break:** after a focus session completes, select Start 5-min break. Confirm the breathing phases change every four seconds. Skip the break to return to focus mode.
- **Themes:** switch all four themes in Settings and confirm the accent changes across the app and persists after refresh.
- **Persistence:** refresh during a running timer, after adding tasks, and after choosing a theme. The timer should recover from its end timestamp; tasks and preferences should remain.

## Browser notes

- Speech synthesis, Web Audio, `<dialog>`, Canvas, and LocalStorage are supported by current mainstream browsers. If audio is blocked until a gesture, interact with the page and start a timer or enable ambient sound in Settings.
- Speech and ambient playback may behave differently between browsers and mobile operating systems. The mute control disables app-generated alerts; ambient audio has its own toggle and volume.
- The chart is drawn with Canvas; no charting library or network connection is needed.
- StudyPulse has no forced installation flow. It opens directly as a browser page.

## Optional PWA/offline shell

The project includes `manifest.webmanifest`, `icon.svg`, and `sw.js`. The service worker caches the local app shell so the interface can reopen offline after its first successful visit. It registers automatically when the site is served from HTTPS or `localhost`; it is intentionally skipped for `file://` launches. This does not trigger an installation prompt or require a download.

For local service-worker testing, run this from the project folder:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`. For public deployment, use an HTTPS static host. The Google Fonts stylesheet is an optional enhancement; if offline or blocked, the system font fallbacks are used.
