// "When" on the Review step: the next free time, or a time you pick with the day strip and its warnings.
// Also the schedule the Calendar and Posts read, and the strip the Move dialog reuses.
import { $, el } from './dom.js';
import { nextFreeTime, slotProblems, outsideHours, dayStrip, formatTime, formatDay, SCHEDULE } from '/rules.js';
import { state, hooks } from './state.js';

// The laptop's posts, refreshed when the Review step, the Calendar or Posts open, and every minute while they show.
export const schedule = { posts: [], loaded: false, error: '' };

export async function loadSchedule() {
  try {
    const res = await fetch('/api/schedule');
    if (!res.ok) throw new Error();
    schedule.posts = (await res.json()).posts;
    schedule.loaded = true;
    schedule.error = '';
  } catch {
    schedule.error = "Couldn't load the schedule from the server. Check that it's running.";
  }
  hooks.scheduleChanged();
}

export const timeOf = (p) => p.postedAt ?? p.at;

// Posts holding a time, for the slot rules (not cancelled ones); leave out the post being moved.
export const takenSlots = (except) => schedule.posts
  .filter((p) => p.id !== except && p.state !== 'cancelled' && Number.isFinite(timeOf(p)))
  .map((p) => ({ id: p.id, at: timeOf(p), kind: p.kind, platforms: p.platforms }));

// ---- Dates as the browser's date and time inputs want them ----

const pad = (n) => String(n).padStart(2, '0');
export const dayValue = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const timeValue = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const fromInputs = (day, time) => (day && time ? new Date(`${day}T${time}`).getTime() : NaN);

const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

// "Today, 6:00 PM", "Tomorrow, 9:00 AM", "Thu 19 Nov, 3:30 PM".
export function whenLabel(ms) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const day = sameDay(ms, Date.now()) ? 'Today' : sameDay(ms, tomorrow.getTime()) ? 'Tomorrow' : formatDay(ms);
  return `${day}, ${formatTime(ms)}`;
}

// Within a minute counts as now: the post goes straight out, with live progress.
const SOON_MS = 60_000;

// ---- The day strip ----

// One day's posting hours: free (green), too close to another post (orange), the posts there already, and the
// picked time. Clicking it picks that time, to the nearest 5 minutes. platforms: where this post goes.
export function strip(taken, kind, day, picked, onPick, platforms = []) {
  const s = dayStrip(taken, kind, day, platforms);
  const span = s.end - s.start;
  const pos = (ms) => `${((ms - s.start) / span) * 100}%`;
  const bar = el('div', { className: 'strip-bar' + (s.full ? ' full' : '') });
  for (const r of s.tooClose) {
    const range = el('span', { className: 'strip-range' });
    Object.assign(range.style, { left: pos(r.from), width: `${((r.to - r.from) / span) * 100}%` });
    bar.append(range);
  }
  for (const p of s.posts) {
    const mark = el('span', { className: `strip-post ${p.kind}`, title: `${p.kind === 'text' ? 'Text post' : p.kind === 'video' ? 'Video' : 'Image post'} at ${formatTime(p.at)}` });
    mark.style.left = pos(p.at);
    bar.append(mark);
  }
  if (Number.isFinite(picked) && picked >= s.start && picked <= s.end) {
    const mark = el('span', { className: 'strip-pick', title: `Your time: ${formatTime(picked)}` });
    mark.style.left = pos(picked);
    bar.append(mark);
  }
  if (onPick) {
    bar.classList.add('clickable');
    bar.title = 'Click to pick a time';
    bar.addEventListener('click', (e) => {
      const box = bar.getBoundingClientRect();
      const at = s.start + ((e.clientX - box.left) / box.width) * span;
      onPick(Math.round(at / 300_000) * 300_000);
    });
  }
  const hours = el('div', { className: 'strip-hours' });
  for (let h = SCHEDULE.startHour; h <= SCHEDULE.endHour; h += 3) {
    const at = new Date(s.start).setHours(h);
    const label = el('span', { textContent: formatTime(at).replace(':00', '') });
    label.style.left = pos(at);
    hours.append(label);
  }
  const legend = el('div', { className: 'strip-legend' },
    el('span', { className: 'key free', textContent: 'Free' }),
    el('span', { className: 'key close', textContent: 'Too close to a post' }),
    el('span', { className: 'key post', textContent: 'Post' }),
    el('span', { className: 'key pick', textContent: 'Your time' }));
  return el('div', { className: 'strip-day' }, bar, hours, legend,
    ...(s.full ? [el('p', { className: 'hint', textContent: `This day already has ${SCHEDULE.perDay[kind]} ${kind === 'video' ? 'videos' : 'image posts'}.` })] : []));
}

// Picking a day and time with the strip and its warnings. Used by Review (here) and the Move dialog.
// value: { day, time }; onChange(value) when either changes. except: the post being moved; platforms: where it goes.
export function picker(value, kind, { except, platforms = [], onChange }) {
  const taken = takenSlots(except);
  const at = fromInputs(value.day, value.time);
  const day = el('input', { type: 'date', value: value.day, min: dayValue(Date.now()) });
  const time = el('input', { type: 'time', value: value.time, step: 300 });
  day.addEventListener('change', () => onChange({ ...value, day: day.value }));
  time.addEventListener('change', () => onChange({ ...value, time: time.value }));
  const check = slotProblems(taken, kind, at, Date.now(), platforms);
  if (check.warnings.length || check.past || check.outside) time.classList.add('warn');
  const notes = [];
  if (check.invalid) notes.push(el('p', { className: 'hint', textContent: 'Choose a day and a time.' }));
  else if (check.past) notes.push(el('p', { className: 'when-warning err', textContent: 'That time has passed. Pick a later time.' }));
  else if (check.outside) {
    const next = el('button', { type: 'button', className: 'link', textContent: whenLabel(check.nextFree) });
    next.addEventListener('click', () => onChange({ day: dayValue(check.nextFree), time: timeValue(check.nextFree) }));
    notes.push(el('div', { className: 'when-warning err' }, check.outside, ' Next free time: ', next, '.'));
  }
  else if (check.warnings.length) {
    const next = el('button', { type: 'button', className: 'link', textContent: whenLabel(check.nextFree) });
    next.addEventListener('click', () => onChange({ day: dayValue(check.nextFree), time: timeValue(check.nextFree) }));
    notes.push(el('div', { className: 'when-warning' }, check.warnings.join(' '), ' Next free time: ', next, '.'));
  }
  const dayMs = Number.isFinite(at) ? at : fromInputs(value.day, '12:00');
  return el('div', { className: 'when-pick' },
    el('div', { className: 'fields' },
      el('label', { className: 'field' }, 'Day', day),
      el('label', { className: 'field' }, 'Time', time)),
    ...(Number.isFinite(dayMs) ? [strip(taken, kind, dayMs, at, (ms) => onChange({ day: value.day, time: timeValue(ms) }), platforms)] : []),
    ...notes);
}

// ---- The When choice on the Review step ----

const LEAD_MS = 5 * 60_000;
// Where Pick a time starts: the next free time at least 5 minutes ahead, on a 5-minute mark (as in the app).
function firstPick(kind, platforms) {
  return nextFreeTime(takenSlots(), kind, Math.ceil((Date.now() + LEAD_MS) / LEAD_MS) * LEAD_MS, platforms);
}

// What Post does: { now: post straight away, at, mode, label for the button, blocked: why it can't }.
export function whenChoice(kind, platforms = []) {
  const w = state.when;
  // Immediately: straight away, whatever the posting hours and gaps (decided 2026-11-19).
  if (w.mode === 'now') return { mode: 'now', at: Date.now(), now: true };
  if (w.mode === 'picked') {
    const at = fromInputs(w.day, w.time);
    if (!Number.isFinite(at)) return { mode: 'picked', blocked: 'Choose a day and a time' };
    if (at <= Date.now()) return { mode: 'picked', blocked: 'That time has passed. Pick a later time.' };
    if (outsideHours(at)) return { mode: 'picked', blocked: outsideHours(at) };
    return { mode: 'picked', at, now: false, label: `Schedule for ${whenLabel(at)}` };
  }
  const at = nextFreeTime(takenSlots(), kind, Date.now(), platforms);
  if (at - Date.now() < SOON_MS) return { mode: 'auto', at, now: true };
  return { mode: 'auto', at, now: false, label: `Post at ${whenLabel(at)}` };
}

export function renderWhen(kind, { youtubeVideo, platforms }) {
  const box = $('when');
  const w = state.when;
  const next = nextFreeTime(takenSlots(), kind, Date.now(), platforms);
  const nextText = next - Date.now() < SOON_MS ? 'Now' : whenLabel(next);
  const option = (mode, title, detail) => {
    const radio = el('input', { type: 'radio', name: 'when', checked: w.mode === mode });
    radio.addEventListener('change', () => {
      w.mode = mode;
      // A fresh start each time, at least 5 minutes ahead: an old or "now" time would already have passed.
      if (mode === 'picked') { const start = firstPick(kind, platforms); Object.assign(w, { day: dayValue(start), time: timeValue(start) }); }
      hooks.update();
    });
    return el('label', { className: 'when-option' + (w.mode === mode ? ' on' : '') }, radio,
      el('span', {}, el('b', { textContent: title }), detail ? el('span', { textContent: detail }) : ''));
  };
  const parts = [el('span', { className: 'label', textContent: 'When' }), option('auto', 'Next free time', nextText)];
  const pick = option('picked', 'Pick a time');
  if (w.mode === 'picked') {
    const wrap = el('div', { className: 'when-picked' }, pick, picker(w, kind, { platforms, onChange: (v) => { Object.assign(w, v); hooks.update(); } }));
    if (youtubeVideo) wrap.append(el('p', { className: 'hint', textContent: 'YouTube is uploaded right away and goes public at this time.' }));
    parts.push(wrap);
  } else {
    parts.push(pick);
  }
  parts.push(option('now', 'Immediately', 'Goes out now, whatever the posting hours and gaps'));
  if (schedule.error) parts.push(el('p', { className: 'hint error', textContent: schedule.error }));
  box.replaceChildren(...parts);
}
