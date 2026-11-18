// Calendar and Posts: every post the laptop keeps (from this page and the phone), waiting or finished, and the
// changes a waiting one allows: Move, Post now, Edit (text and settings) and Cancel. Anything already on a
// platform is changed there; YouTube's link opens YouTube Studio.
import { $, el, logo, truncate } from './dom.js';
import { formatTime, formatDay, problemsFor } from '/rules.js';
import { FIELDS, fieldsOf } from '/fields.js';
import { state } from './state.js';
import { schedule, loadSchedule, timeOf, whenLabel, picker, dayValue, timeValue, fromInputs } from './when.js';

const DAY_MS = 24 * 60 * 60 * 1000;
let weekStart = mondayOf(Date.now());
let openId = null; // the post shown in the side panel
let note = ''; // what the last change said (YouTube keeps its own time…)

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
  if (action === 'cancel' && !data.post) openId = null;
  await loadSchedule();
  return data;
}

function act(p, action, label, { confirm: ask } = {}) {
  const button = el('button', { type: 'button', className: action === 'cancel' ? 'secondary small danger' : 'secondary small', textContent: label });
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
  const how = p.when === 'picked' ? 'Time you picked' : p.when === 'now' ? 'Posted straight away' : 'Next free time';
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
  if (p.state === 'waiting') {
    parts.push(el('div', { className: 'detail-actions' },
      act(p, 'move', 'Move'), act(p, 'now', 'Post now', { confirm: 'Post this now?' }), act(p, 'edit', 'Edit'),
      act(p, 'cancel', 'Cancel', { confirm: onYoutube ? 'Cancel the other platforms? YouTube keeps its video.' : 'Cancel this post? It will be deleted.' })));
  } else if (p.state !== 'posting') {
    parts.push(el('p', { className: 'hint', textContent: 'Already on the platforms: change it there.' }));
  }
  if (note) parts.push(el('p', { className: 'status', textContent: note }));
  return parts;
}

function showDetail(aside) {
  const p = schedule.posts.find((x) => x.id === openId);
  aside.hidden = !p;
  if (p) aside.replaceChildren(...detail(p));
}

function card(p, { withDay = false } = {}) {
  const status = statusOf(p);
  const t = p.state === 'waiting' ? p.at : timeOf(p);
  const button = el('button', { type: 'button', className: `post-card ${status.className}${p.id === openId ? ' open' : ''}` },
    el('span', { className: 'card-top' },
      el('b', { textContent: withDay ? whenLabel(t) : formatTime(t) }),
      el('span', { className: 'logos' }, ...p.platforms.map(logo))),
    el('span', { className: 'card-text', textContent: snippet(p, withDay ? 120 : 60) }),
    el('span', { className: `badge ${status.className}`, textContent: `${kindLabel[p.kind]} · ${status.text}` }));
  button.addEventListener('click', () => { openId = p.id; note = ''; render(); });
  return button;
}

// ---- Calendar: a week, Monday first ----

export function renderCalendar() {
  const end = addDays(weekStart, 7);
  const today = new Date().toDateString();
  $('calendar-title').textContent = `${formatDay(weekStart)} to ${formatDay(addDays(weekStart, 6))}`;
  $('calendar-note').textContent = schedule.error || 'Posts go out 9 AM to 11 PM. Text posts are kept 1 hour apart; image and video posts 4 hours apart, at most 2 of each a day; a text post and an image or video post on the same platform 1 hour apart.';
  const posts = schedule.posts.filter((p) => { const t = p.state === 'waiting' ? p.at : timeOf(p); return t >= weekStart && t < end; });
  $('week').replaceChildren(...[0, 1, 2, 3, 4, 5, 6].map((i) => {
    const day = addDays(weekStart, i);
    const own = posts.filter((p) => new Date(p.state === 'waiting' ? p.at : timeOf(p)).toDateString() === new Date(day).toDateString())
      .sort((a, b) => (a.state === 'waiting' ? a.at : timeOf(a)) - (b.state === 'waiting' ? b.at : timeOf(b)));
    return el('section', { className: 'day' + (new Date(day).toDateString() === today ? ' today' : '') + (day + DAY_MS <= Date.now() ? ' past' : '') },
      el('h2', { textContent: formatDay(day) }),
      ...(own.length ? own.map((p) => card(p)) : [el('p', { className: 'hint', textContent: 'Nothing' })]));
  }));
  showDetail($('calendar-detail'));
}

$('calendar-prev').addEventListener('click', () => { weekStart = addDays(weekStart, -7); renderCalendar(); });
$('calendar-next').addEventListener('click', () => { weekStart = addDays(weekStart, 7); renderCalendar(); });
$('calendar-today').addEventListener('click', () => { weekStart = mondayOf(Date.now()); renderCalendar(); });

// ---- Posts: waiting first (soonest first), then finished (newest first) ----

export function renderPosts() {
  const waiting = schedule.posts.filter((p) => p.state === 'waiting' || p.state === 'posting').sort((a, b) => a.at - b.at);
  const finished = schedule.posts.filter((p) => p.state === 'done' || p.state === 'unknown').sort((a, b) => timeOf(b) - timeOf(a));
  $('posts-note').textContent = schedule.error || 'Waiting posts are kept on the laptop and can be changed until they go out. Drafts stay where you write them.';
  const list = (title, posts, empty) => el('section', { className: 'post-list' },
    el('h2', { textContent: `${title} (${posts.length})` }),
    ...(posts.length ? posts.map((p) => card(p, { withDay: true })) : [el('p', { className: 'hint', textContent: empty })]));
  $('post-lists').replaceChildren(
    list('Waiting', waiting, 'Nothing waiting. Posts you schedule show here.'),
    list('Finished', finished, 'Nothing posted yet.'));
  showDetail($('posts-detail'));
}

function render() {
  if (state.view === 'calendar') renderCalendar();
  if (state.view === 'posts') renderPosts();
}
