// Calendar and Posts: every post the laptop keeps (from this page and the phone), waiting, finished or cancelled,
// and the changes a waiting one allows: Post now, Move, Edit (text and settings) and Cancel. Any post can be
// deleted for good. Anything already on a platform is changed there; YouTube's link opens YouTube Studio.
import { $, el, logo, truncate } from './dom.js';
import { formatTime, formatDay, problemsFor, sideBySide, SCHEDULE } from '/rules.js';
import { FIELDS, fieldsOf } from '/fields.js';
import { state } from './state.js';
import { schedule, loadSchedule, timeOf, whenLabel, picker, dayValue, timeValue, fromInputs } from './when.js';

const DAY_MS = 24 * 60 * 60 * 1000;
let weekStart = mondayOf(Date.now());
let openId = null; // the post shown in the side panel
let note = ''; // what the last change said (YouTube keeps its own time…)
let filter = 'all'; // Posts: all, waiting, finished or cancelled

function mondayOf(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

const addDays = (ms, n) => { const d = new Date(ms); d.setDate(d.getDate() + n); return d.getTime(); };

// ---- What a post is ----

const youtubeAhead = (p) => p.youtube === 'done' && p.state === 'waiting';

function statusOf(p) {
  if (p.state === 'cancelled') return { className: 'cancelled', text: 'Cancelled' };
  if (p.state === 'waiting') return { className: 'waiting', text: p.at <= Date.now() ? 'Going out now' : 'Waiting' };
  if (p.state === 'posting') return { className: 'posting', text: 'Posting' };
  if (p.state === 'unknown') return { className: 'fail', text: 'Unknown' };
  const results = p.results ?? [];
  const failed = results.filter((r) => !r.ok).length;
  if (p.platforms.length === 1 && p.platforms[0] === 'youtube' && p.at > Date.now() && results[0]?.ok) {
    return { className: 'waiting', text: 'Scheduled on YouTube' };
  }
  if (!failed) return { className: 'ok', text: 'Posted' };
  return { className: 'fail', text: failed === results.length ? 'Failed' : `${failed} failed` };
}

const nameOf = (id) => state.platforms.find((p) => p.id === id)?.name ?? id;
const snippet = (p, n) => {
  const text = p.text || Object.values(p.options ?? {}).find((o) => o.text)?.text || p.files.map((f) => f.name).join(', ') || 'No text';
  const t = truncate(text.replace(/\s+/g, ' '), n);
  return t.cut ? `${t.text}…` : t.text;
};
const kindLabel = { text: 'Text', image: 'Image', video: 'Video' };

// A YouTube watch or Shorts link → its page in YouTube Studio, where an uploaded video is changed.
function studioLink(url) {
  const id = /(?:v=|youtu\.be\/|shorts\/)([\w-]{6,})/.exec(url ?? '')?.[1];
  return id ? `https://studio.youtube.com/video/${id}/edit` : 'https://studio.youtube.com/';
}

// ---- Changing a waiting post ----

async function change(p, action, body = {}) {
  const res = await fetch(action === 'edit' ? `/api/schedule/${p.id}` : `/api/schedule/${p.id}/${action}`, {
    method: action === 'edit' ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `The server returned an error (HTTP ${res.status}). Check the terminal.`);
  note = data.note ?? '';
  if ((action === 'cancel' || action === 'delete') && !data.post) openId = null;
  await loadSchedule();
  return data;
}

function act(p, action, label, { confirm: ask, primary = false } = {}) {
  const kind = primary ? 'primary' : action === 'cancel' || action === 'delete' ? 'secondary danger' : 'secondary';
  const button = el('button', { type: 'button', className: `${kind} wide-action`, textContent: label });
  button.addEventListener('click', async () => {
    if (action === 'move') return openMove(p);
    if (action === 'edit') return openEdit(p);
    if (ask && !window.confirm(ask)) return;
    button.disabled = true;
    try {
      await change(p, action);
    } catch (err) {
      note = err.message;
      render();
    }
  });
  return button;
}

function openMove(p) {
  const dialog = $('move-dialog');
  let value = { day: dayValue(p.at), time: timeValue(p.at) };
  const draw = () => $('move-body').replaceChildren(picker(value, p.kind, { except: p.id, platforms: p.platforms, onChange: (v) => { value = v; draw(); } }));
  draw();
  $('move-status').textContent = '';
  $('move-cancel').onclick = () => dialog.close();
  $('move-save').onclick = async () => {
    const at = fromInputs(value.day, value.time);
    try {
      await change(p, 'move', { at });
      dialog.close();
    } catch (err) {
      Object.assign($('move-status'), { textContent: err.message, className: 'status err' });
    }
  };
  dialog.showModal();
}

// One control for a platform field, bound to values (no image fields: the files stay as they are).
function control(f, values) {
  let input;
  if (f.type === 'check') {
    input = el('input', { type: 'checkbox', checked: Boolean(values[f.key]) });
    input.addEventListener('change', () => { values[f.key] = input.checked; });
    return el('label', { className: 'field check' }, input, f.label);
  }
  if (f.type === 'select') {
    input = el('select', {}, ...f.choices.map(([value, label]) => el('option', { value, textContent: label })));
    input.value = values[f.key] ?? f.initial ?? '';
  } else {
    input = f.type === 'textarea' ? el('textarea', { className: 'small' }) : el('input', { type: f.type, autocomplete: 'off' });
    Object.assign(input, { value: values[f.key] ?? '', placeholder: f.placeholder ?? '' });
  }
  input.addEventListener(f.type === 'select' ? 'change' : 'input', () => { values[f.key] = input.value; });
  return el('label', { className: 'field' + (f.wide ? ' wide' : '') }, f.label, input);
}

function openEdit(p) {
  const dialog = $('edit-dialog');
  const media = p.media.map((n) => p.files[n]);
  const options = structuredClone(p.options ?? {});
  const main = el('textarea', { value: p.text });
  const parts = [el('label', { className: 'field wide' }, 'Your post', main)];
  if (p.files.length) parts.push(el('p', { className: 'hint', textContent: `Files can't be changed: ${p.files.map((f) => f.name).join(', ')}` }));
  if (p.youtube === 'done') parts.push(el('p', { className: 'when-warning', textContent: 'YouTube already has this video. Changes here reach the other platforms; change YouTube in YouTube Studio.' }));
  for (const id of p.platforms) {
    const values = options[id] ??= {};
    const fields = fieldsOf(id).filter((f) => f.type !== 'image' && (!f.when || f.when({ media, values })));
    const own = typeof values.text === 'string'
      ? [(() => {
        const box = el('textarea', { value: values.text });
        box.addEventListener('input', () => { values.text = box.value; });
        return el('label', { className: 'field wide' }, `${FIELDS[id]?.textLabel ?? 'Text'} (${nameOf(id)} only)`, box);
      })()]
      : [];
    if (!fields.length && !own.length) continue;
    parts.push(el('section', { className: 'edit-platform' }, el('h3', {}, logo(id), nameOf(id)),
      el('div', { className: 'fields' }, ...own, ...fields.map((f) => control(f, values)))));
  }
  $('edit-body').replaceChildren(...parts);
  $('edit-status').textContent = '';
  $('edit-cancel').onclick = () => dialog.close();
  $('edit-save').onclick = async () => {
    const text = main.value.trim();
    // The same checks as the server, so problems show here first.
    const problems = p.platforms.flatMap((id) => {
      const platform = state.platforms.find((x) => x.id === id);
      // Image fields hold { file: n }; they're checked by that file's type and size, as on the server.
      const own = Object.fromEntries(Object.entries(options[id] ?? {}).map(([key, v]) => [key, Number.isInteger(v?.file) ? p.files[v.file] : v]));
      return platform ? problemsFor(platform, text, media, own).map((m) => `${platform.name}: ${m}`) : [];
    });
    if (problems.length) return Object.assign($('edit-status'), { textContent: problems.join('. '), className: 'status err' });
    try {
      await change(p, 'edit', { text, options });
      dialog.close();
    } catch (err) {
      Object.assign($('edit-status'), { textContent: err.message, className: 'status err' });
    }
  };
  dialog.showModal();
}

// ---- The side panel: one post in full ----

function detail(p) {
  const status = statusOf(p);
  const when = p.state === 'waiting' ? `${p.at <= Date.now() ? 'Now' : whenLabel(p.at)}` : whenLabel(timeOf(p));
  const how = p.when === 'picked' ? 'Time you picked' : p.when === 'now' ? 'Immediately' : 'Next free time';
  const parts = [
    el('div', { className: 'detail-head' },
      el('span', { className: `badge ${status.className}`, textContent: status.text }),
      el('button', { type: 'button', className: 'icon-button', textContent: '×', ariaLabel: 'Close', onclick: () => { openId = null; render(); } })),
    el('strong', { className: 'detail-when', textContent: when }),
    el('p', { className: 'hint', textContent: `${how} · ${kindLabel[p.kind]} · from the ${p.source === 'web' ? 'web page' : 'phone'}` }),
  ];
  if (p.moved) parts.push(el('p', { className: 'when-warning', textContent: `Moved here: its time, ${whenLabel(p.moved.from)}, passed while the laptop was off.` }));
  parts.push(el('p', { className: 'detail-text', textContent: p.text || 'No main text' }));
  if (p.files.length) parts.push(el('p', { className: 'hint', textContent: `${p.filesRemoved ? 'Posted with' : 'Files'}: ${p.files.map((f) => f.name).join(', ')}` }));

  const results = new Map((p.results ?? []).map((r) => [r.id, r]));
  parts.push(el('ul', { className: 'detail-platforms' }, ...p.platforms.map((id) => {
    const r = results.get(id);
    const live = p.steps?.[id];
    const label = id === 'youtube' && youtubeAhead(p) ? `On YouTube, public ${whenLabel(p.at)}` : 'View post';
    const line = r?.ok ? (r.url ? el('a', { href: r.url, target: '_blank', rel: 'noopener', textContent: label }) : 'Posted')
      : live ? `${live.step}…` : p.state === 'waiting' ? 'Waiting' : '';
    return el('li', { className: r ? (r.ok ? 'ok' : 'fail') : '' }, logo(id), el('span', {}, el('b', { textContent: nameOf(id) }), ' ',
      r && !r.ok ? el('span', { className: 'err', textContent: r.error }) : line));
  })));

  // Steps a platform left to do by hand (YouTube: make a private video public).
  for (const r of results.values()) {
    if (r.ok && r.todo) {
      parts.push(el('div', { className: 'studio' }, el('p', { textContent: r.todo.text }),
        el('a', { href: r.todo.url, target: '_blank', rel: 'noopener', textContent: r.todo.label })));
    }
  }
  const onYoutube = results.get('youtube')?.ok && !results.get('youtube').todo;
  if (onYoutube) {
    parts.push(el('div', { className: 'studio' },
      el('p', { textContent: 'YouTube already has this video. Change its time, text or settings in YouTube Studio.' }),
      el('a', { href: studioLink(results.get('youtube').url), target: '_blank', rel: 'noopener', textContent: 'Open in YouTube Studio' })));
  }
  const remove = act(p, 'delete', 'Delete post', { confirm: "Delete this post everywhere, from this page and the phone? It can't be undone." });
  if (p.state === 'waiting') {
    parts.push(el('div', { className: 'detail-actions' },
      act(p, 'now', 'Post now', { confirm: 'Post this now?', primary: true }), act(p, 'move', 'Move to another time…'), act(p, 'edit', 'Edit text and settings'),
      act(p, 'cancel', 'Cancel post', { confirm: onYoutube ? 'Cancel the other platforms? YouTube keeps its video.' : 'Cancel this post? It stays in Posts, marked cancelled.' }),
      remove));
  } else if (p.state === 'cancelled') {
    parts.push(el('p', { className: 'hint', textContent: "Cancelled: it didn't go out." }), el('div', { className: 'detail-actions' }, remove));
  } else if (p.state !== 'posting') {
    parts.push(el('p', { className: 'hint', textContent: 'Already on the platforms: change it there.' }), el('div', { className: 'detail-actions' }, remove));
  }
  if (note) parts.push(el('p', { className: 'status', textContent: note }));
  return parts;
}

// empty: what the panel shows with no post selected (the Calendar's summary), or nothing to hide it.
function showDetail(aside, empty = null) {
  const p = schedule.posts.find((x) => x.id === openId);
  aside.hidden = !p && !empty;
  if (p) aside.replaceChildren(...detail(p));
  else if (empty) aside.replaceChildren(...empty);
}

// ---- Calendar: a week, Monday first, as a grid of days by hours (the Scheduling mockup's Web Calendar) ----

const HOUR_PX = 40;
const HOUR_MS = 60 * 60 * 1000;
const at = (p) => (p.state === 'waiting' || p.state === 'cancelled' ? p.at : timeOf(p));
// Three looks only (decided 2026-11-19): scheduled, posted (✓, or ✕ when a platform failed) and cancelled.
// Everything else (who picked the time, where it came from) is in the post's details.
const lookOf = (p) => (p.state === 'cancelled' ? 'cancelled' : p.state === 'waiting' || p.state === 'posting' ? 'scheduled' : 'posted');

function event(p, top, place) {
  const status = statusOf(p);
  const look = lookOf(p);
  const media = p.kind === 'image' || p.kind === 'video';
  const mark = look === 'posted' ? (status.className === 'fail' ? '✕ ' : '✓ ') : '';
  const width = 100 / place.cols;
  const button = el('button', {
    type: 'button', className: `event ${look}${media ? '' : ' chip'}${status.className === 'fail' ? ' failed' : ''}${p.id === openId ? ' open' : ''}`,
    title: `${formatTime(at(p))} · ${kindLabel[p.kind]} · ${p.platforms.map(nameOf).join(', ')} · ${status.text}`,
  },
  el('b', { textContent: `${mark}${formatTime(at(p))} ${kindLabel[p.kind]}` }),
  ...(media ? [el('span', { textContent: p.platforms.map(nameOf).join(', ') })] : [el('span', { textContent: ` · ${p.platforms.map(nameOf).join(', ')}` })]));
  Object.assign(button.style, { top: `${top}px`, left: `calc(${place.col * width}% + 4px)`, width: `calc(${width}% - 6px)` });
  button.addEventListener('click', () => { openId = p.id; note = ''; render(); });
  return button;
}

export function renderCalendar() {
  const end = addDays(weekStart, 7);
  const now = Date.now();
  const first = new Date(weekStart);
  const last = new Date(addDays(weekStart, 6));
  $('calendar-title').textContent = first.getMonth() === last.getMonth()
    ? `${first.getDate()} – ${last.getDate()} ${MONTHS[first.getMonth()]}`
    : `${first.getDate()} ${MONTHS[first.getMonth()].slice(0, 3)} – ${last.getDate()} ${MONTHS[last.getMonth()].slice(0, 3)}`;
  $('calendar-today').disabled = weekStart === mondayOf(now);
  $('calendar-note').textContent = schedule.error || '';
  const posts = schedule.posts.filter((p) => Number.isFinite(at(p)) && at(p) >= weekStart && at(p) < end);
  // 9 AM to 11 PM, wider when a post is outside them (one sent Immediately at night).
  const hourOf = (p) => new Date(at(p)).getHours();
  const startHour = Math.min(SCHEDULE.startHour, ...posts.map(hourOf));
  const endHour = Math.max(SCHEDULE.endHour, ...posts.map((p) => hourOf(p) + 1));
  const height = (endHour - startHour) * HOUR_PX;
  const y = (ms) => { const d = new Date(ms); return (d.getHours() - startHour + d.getMinutes() / 60) * HOUR_PX; };

  const head = el('div', { className: 'grid-row grid-head' }, el('span'), ...[0, 1, 2, 3, 4, 5, 6].map((i) => {
    const day = addDays(weekStart, i);
    const today = new Date(day).toDateString() === new Date(now).toDateString();
    return el('span', { className: `grid-day${today ? ' today' : ''}`, textContent: `${formatDay(day).split(' ').slice(0, 2).join(' ')}${today ? ' · today' : ''}` });
  }));
  const axis = el('div', { className: 'grid-axis', style: `height: ${height}px` });
  for (let h = startHour; h <= endHour; h += 2) {
    axis.append(el('span', { className: 'grid-hour', style: `top: ${(h - startHour) * HOUR_PX}px`, textContent: formatTime(new Date(weekStart).setHours(h, 0, 0, 0)).replace(':00', '') }));
  }
  const columns = [0, 1, 2, 3, 4, 5, 6].map((i) => {
    const day = addDays(weekStart, i);
    const today = new Date(day).toDateString() === new Date(now).toDateString();
    const col = el('div', { className: `grid-col${today ? ' today' : ''}${day + DAY_MS <= now ? ' past' : ''}`, style: `height: ${height}px` });
    for (let h = startHour; h <= endHour; h += 2) col.append(el('span', { className: 'grid-line', style: `top: ${(h - startHour) * HOUR_PX}px` }));
    const own = posts.filter((p) => new Date(at(p)).toDateString() === new Date(day).toDateString()).sort((a, b) => at(a) - at(b));
    const boxes = own.map((p) => { const top = y(at(p)); return { top, bottom: top + (p.kind === 'text' ? 24 : 44) }; });
    sideBySide(boxes).forEach((place, n) => col.append(event(own[n], boxes[n].top, place)));
    if (today && y(now) >= 0 && y(now) <= height) col.append(el('span', { className: 'grid-now', style: `top: ${y(now)}px` }));
    return col;
  });
  const body = el('div', { className: 'grid-row grid-body' }, axis, ...columns);
  $('week').replaceChildren(el('div', { className: 'grid' }, head, body));
  showDetail($('calendar-detail'), summary(now));
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// The side panel with nothing selected: today's counts and what's waiting (as in the mockup).
function summary(now) {
  const today = schedule.posts.filter((p) => p.state !== 'cancelled' && Number.isFinite(at(p)) && new Date(at(p)).toDateString() === new Date(now).toDateString());
  const count = (kind) => today.filter((p) => p.kind === kind).length;
  const waiting = schedule.posts.filter((p) => p.state === 'waiting').sort((a, b) => a.at - b.at);
  return [
    el('p', { className: 'hint', textContent: 'Click a post to see it in full and change it.' }),
    el('p', {}, el('b', { textContent: 'Today: ' }), `videos ${count('video')} of ${SCHEDULE.perDay.video}, images ${count('image')} of ${SCHEDULE.perDay.image}`),
    el('p', {}, el('b', { textContent: 'Waiting: ' }), waiting.length ? `${waiting.length} post${waiting.length > 1 ? 's' : ''} · next ${whenLabel(waiting[0].at)}` : 'nothing'),
  ];
}

$('calendar-prev').addEventListener('click', () => { weekStart = addDays(weekStart, -7); renderCalendar(); });
$('calendar-next').addEventListener('click', () => { weekStart = addDays(weekStart, 7); renderCalendar(); });
$('calendar-today').addEventListener('click', () => { weekStart = mondayOf(Date.now()); renderCalendar(); });

// ---- Posts: filter pills (All, Waiting, Finished, Cancelled), waiting soonest first, the rest newest first ----

const FILTERS = [
  ['all', 'All', () => true],
  ['waiting', 'Waiting', (p) => p.state === 'waiting' || p.state === 'posting'],
  ['finished', 'Finished', (p) => p.state === 'done' || p.state === 'unknown'],
  ['cancelled', 'Cancelled', (p) => p.state === 'cancelled'],
];

function row(p) {
  const status = statusOf(p);
  const t = at(p);
  const button = el('button', { type: 'button', className: `post-row ${status.className}${p.id === openId ? ' open' : ''}` },
    el('span', { className: 'row-text', textContent: snippet(p, 140) }),
    el('span', { className: `row-status ${status.className}` },
      el('span', { className: 'logos' }, ...p.platforms.map(logo)),
      `${status.className === 'ok' ? '✓ ' : ''}${Number.isFinite(t) ? whenLabel(t) : ''} · ${status.text}`));
  button.addEventListener('click', () => { openId = p.id; note = ''; render(); });
  return button;
}

export function renderPosts() {
  const waitingFirst = (a, b) => {
    const wa = a.state === 'waiting' || a.state === 'posting';
    const wb = b.state === 'waiting' || b.state === 'posting';
    if (wa !== wb) return wa ? -1 : 1;
    return wa ? a.at - b.at : (at(b) ?? 0) - (at(a) ?? 0);
  };
  $('posts-note').textContent = schedule.error || 'Waiting posts are kept on the laptop and can be changed until they go out.';
  const pills = el('div', { className: 'filter-pills', role: 'group', ariaLabel: 'Show' }, ...FILTERS.map(([id, label, test]) => {
    const n = schedule.posts.filter(test).length;
    const pill = el('button', { type: 'button', className: `filter-pill${filter === id ? ' on' : ''}`, textContent: id === 'all' ? label : `${label} ${n}` });
    pill.setAttribute('aria-pressed', String(filter === id));
    pill.addEventListener('click', () => { filter = id; renderPosts(); });
    return pill;
  }));
  const shown = schedule.posts.filter(FILTERS.find(([id]) => id === filter)[2]).sort(waitingFirst);
  $('post-lists').replaceChildren(pills, shown.length
    ? el('div', { className: 'post-rows' }, ...shown.map(row))
    : el('p', { className: 'hint', textContent: filter === 'all' ? 'No posts yet. Posts you schedule or post show here.' : 'Nothing here.' }));
  showDetail($('posts-detail'));
}

function render() {
  if (state.view === 'calendar') renderCalendar();
  if (state.view === 'posts') renderPosts();
}
