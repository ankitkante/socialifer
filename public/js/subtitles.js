// Subtitles for attached videos: the strip under the videos (generate them with lyrics-video, or upload an
// SRT), one chip per language, the burned-in copies made ahead of posting, and each platform's choice.
import { $, el, readEvents, errorOf } from './dom.js';
import { SUBTITLE_LANGUAGES, isSubtitleLanguage, languageName, burnLanguage, burnTarget, parseSrt } from '/rules.js';
import { state, hooks, read, write, KEYS } from './state.js';
import { setSetting } from './fields.js';
import { isVideoFile, renderMedia } from './uploads.js';
import { openReview } from './review.js';

// Platforms with their own Subtitles choice in their tab. The rest get the default (see burnLanguage).
const CHOICE_PLATFORMS = new Set(['x', 'instagram']);

// Remembered between posts: the language spoken, which subtitles to make, and each platform's choice.
const prefs = { spoken: 'hi', own: true, english: true, choices: {}, ...read(KEYS.subtitles, {}) };
const savePrefs = () => write(KEYS.subtitles, prefs);
// A language remembered from before only Hindi and English were offered.
if (!isSubtitleLanguage(prefs.spoken)) prefs.spoken = 'hi';

export const wantedLanguages = () => (prefs.spoken === 'en'
  ? (prefs.english ? ['en'] : [])
  : [prefs.own && prefs.spoken, prefs.english && 'en'].filter(Boolean));

const videos = () => state.items.filter((i) => isVideoFile(i.file));
const deleteUpload = (id) => fetch(`/api/media/${id}`, { method: 'DELETE' }).catch(() => {});
const and = (words) => (words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : words[0] ?? '');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
// After the subtitles themselves change: the tiles' CC marks, then everything else.
const changed = () => { renderMedia(); hooks.update(); };

// The spoken language first, then English, then the rest, as the chips and tabs show them.
const rank = (lang) => (lang === prefs.spoken ? 0 : lang === 'en' ? 1 : 2);
const entriesOf = (item) => Object.values(item.subs ?? {}).sort((a, b) => rank(a.lang) - rank(b.lang) || a.lang.localeCompare(b.lang));
const readyOf = (item) => entriesOf(item).filter((s) => s.status === 'done');
const busy = (item) => ['queued', 'running'].includes(item.job?.status);

export const generating = () => videos().some(busy);
export const hasSubtitles = (item) => readyOf(item).length > 0;
export const subtitleLanguages = () => [...new Set(videos().flatMap((i) => readyOf(i).map((s) => s.lang)))]
  .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));

// ---- SRT files: uploaded by hand, generated, or saved from Review ----

function dropEntry(item, lang) {
  const entry = item.subs?.[lang];
  if (!entry) return;
  if (entry.id) deleteUpload(entry.id);
  delete item.subs[lang];
}

async function uploadSrt(item, lang, blob, { name, source, lines, edited }) {
  item.subs ??= {};
  dropEntry(item, lang);
  const entry = { lang, name, source, status: 'uploading', lines, edited };
  item.subs[lang] = entry;
  hooks.update();
  try {
    entry.lines ??= parseSrt(await blob.text()).length;
    const res = await fetch('/api/media', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-subrip', 'X-Filename': encodeURIComponent(name) },
      body: blob,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
    Object.assign(entry, { status: 'done', id: data.id });
  } catch (err) {
    Object.assign(entry, { status: 'error', error: err.message });
  }
  // Removed, or replaced by a newer file, while it uploaded.
  if (item.subs?.[entry.lang] !== entry && entry.id) deleteUpload(entry.id);
  changed();
}

// An uploaded SRT takes the first language this video doesn't have yet; its chip has a dropdown to change it.
const freeLanguage = (item) => ['en', prefs.spoken, ...SUBTITLE_LANGUAGES.map(([c]) => c)].find((c) => !item.subs?.[c]) ?? 'en';

let pickFor = null; // { item, replace } for the hidden file input
function pickSrt(item, replace = false) {
  pickFor = { item, replace };
  $('subtitles-file').click();
}

// An SRT picked with a button, or dropped. With several videos it must be dropped on a video's row.
export function addSubtitles(file, item = null, { replace = false } = {}) {
  hooks.edited();
  const list = videos();
  if (!item) {
    if (!list.length) return hooks.setStatus('Attach the video first, then add its subtitles.', true);
    if (list.length > 1) return hooks.setStatus('Drop the SRT on the row of the video it belongs to, under Subtitles.', true);
    item = list[0];
  }
  if (replace) for (const lang of Object.keys(item.subs ?? {})) dropEntry(item, lang);
  uploadSrt(item, freeLanguage(item), file, { name: file.name || 'subtitles.srt', source: 'uploaded' });
}

function removeLanguage(item, lang) {
  hooks.edited();
  dropEntry(item, lang);
  changed();
}

function removeAll(item) {
  hooks.edited();
  for (const lang of Object.keys(item.subs ?? {})) dropEntry(item, lang);
  changed();
}

// Changing an uploaded file's language swaps it with the file that had that language, if any.
function setLanguage(item, from, to) {
  hooks.edited();
  const entry = item.subs[from];
  const other = item.subs[to];
  delete item.subs[from];
  if (other) item.subs[from] = Object.assign(other, { lang: from });
  item.subs[to] = Object.assign(entry, { lang: to });
  hooks.update();
}

// A video is being removed: stop making its subtitles and delete its SRT uploads.
export function forgetSubtitles(item) {
  if (busy(item)) stop(item);
  for (const lang of Object.keys(item.subs ?? {})) dropEntry(item, lang);
}

// ---- Generating: one job per video on the server, which runs them one at a time ----

async function generate(item, langs = wantedLanguages()) {
  if (!item.id || busy(item) || !langs.length) return;
  hooks.edited();
  // YouTube's audio language is the language spoken in the video.
  setSetting('youtube', 'audioLanguage', prefs.spoken);
  const job = { status: 'queued', subtitles: langs, files: [], applied: new Set() };
  item.job = job;
  hooks.update();
  try {
    const res = await fetch('/api/subtitles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ video: item.id, language: prefs.spoken, subtitles: langs }),
    });
    if (!res.headers.get('content-type')?.includes('ndjson')) throw await errorOf(res);
    await readEvents(res, (event) => { if (event.type === 'job') applyJob(item, job, event.job); });
    if (busy(item) && item.job === job) throw new Error('Lost the connection to the server while making the subtitles. They may still be made; check the terminal.');
  } catch (err) {
    if (item.job === job) Object.assign(job, { status: 'error', error: err.message });
  }
  hooks.update();
}

// The server sends the whole job each time; each finished language becomes a chip as soon as it's written.
function applyJob(item, job, snapshot) {
  Object.assign(job, snapshot);
  if (job.stopWanted && job.id) { job.stopWanted = false; stop(item); }
  let added = false;
  for (const f of snapshot.files) {
    if (job.applied.has(f.id)) continue;
    job.applied.add(f.id);
    if (state.items.includes(item)) {
      item.subs ??= {};
      dropEntry(item, f.lang);
      item.subs[f.lang] = { lang: f.lang, id: f.id, name: f.name, lines: f.lines, source: 'generated', status: 'done' };
      added = true;
    } else {
      deleteUpload(f.id); // the video was removed meanwhile
    }
  }
  added ? changed() : hooks.update();
}

function stop(item) {
  const job = item.job;
  if (!job) return;
  if (!job.id) { job.stopWanted = true; return; } // the server hasn't named the job yet
  fetch(`/api/subtitles/${job.id}/stop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
}

// What a running job shows: a label, the steps with ticks, and how far along the whole job is (0 to 1).
// Progress only arrives once per minute or so of audio, so short clips move a step at a time.
function jobView(item) {
  const job = item.job;
  const langs = job.subtitles;
  const done = job.files.map((f) => f.lang);
  if (job.status === 'queued') {
    const ahead = videos().findIndex((v) => v.id && v.id === job.after);
    return { label: ahead >= 0 ? `Waiting · starts after video ${ahead + 1}` : 'Waiting for other subtitles to finish', fraction: 0, done };
  }
  const loaded = ['transcribe', 'translate', 'cached'].includes(job.stage);
  const writing = loaded && !done.includes(job.lang);
  const fraction = ((loaded ? 1 : 0) + done.length + (writing ? job.progress ?? 0 : 0)) / (1 + langs.length);
  const steps = [`Loading model${loaded ? ' ✓' : ''}`, ...langs.map((l) => `${languageName(l)}${done.includes(l) ? ' ✓' : ''}`)].join(' · ');
  return { label: loaded ? `Writing ${languageName(job.lang)}` : 'Loading model', steps, fraction, done };
}

// ---- The strip under the videos ----

const button = (text, onClick, className = 'btn') => {
  const b = el('button', { type: 'button', className, textContent: text });
  b.addEventListener('click', onClick);
  return b;
};

function progressBar(item) {
  const bar = el('div', { className: 'bar' }, el('span'));
  bar.dataset.job = item.key;
  return bar;
}

function languageQuestions(several) {
  const spoken = el('select', { ariaLabel: several ? 'Language spoken in the videos' : 'Language spoken in the video' },
    ...SUBTITLE_LANGUAGES.map(([value, label]) => el('option', { value, textContent: label })));
  spoken.value = prefs.spoken;
  spoken.addEventListener('change', () => {
    prefs.spoken = spoken.value;
    savePrefs();
    // YouTube's audio language follows the video's.
    setSetting('youtube', 'audioLanguage', spoken.value);
    hooks.update();
  });
  const box = (label, key) => {
    const input = el('input', { type: 'checkbox', checked: prefs[key] });
    input.addEventListener('change', () => { prefs[key] = input.checked; savePrefs(); hooks.update(); });
    return el('label', { className: 'check' }, input, label);
  };
  const make = prefs.spoken === 'en' ? [box('English', 'english')] : [box(languageName(prefs.spoken), 'own'), box('English', 'english')];
  return el('div', { className: 'strip-row questions' },
    el('label', { className: 'question' }, several ? 'Videos are in' : 'Video is in', spoken),
    el('div', { className: 'question' }, el('span', { textContent: 'Make subtitles in' }), ...make));
}

function chip(item, s, { removable = true } = {}) {
  const status = s.status === 'uploading' ? ' · uploading…' : s.status === 'error' ? ` · ${s.error}` : '';
  const parts = [];
  if (s.source === 'uploaded') {
    const select = el('select', { ariaLabel: `Language of ${s.name}` },
      ...SUBTITLE_LANGUAGES.map(([value, label]) => el('option', { value, textContent: label })));
    select.value = s.lang;
    select.addEventListener('change', () => setLanguage(item, s.lang, select.value));
    parts.push(el('span', { textContent: s.name + status }), select);
  } else {
    parts.push(el('span', { textContent: `${languageName(s.lang)}${s.lines !== undefined ? ` · ${plural(s.lines, 'line')}` : ''}${status}` }));
  }
  if (removable) {
    const remove = el('button', { type: 'button', className: 'chip-remove', textContent: '×', ariaLabel: `Remove ${languageName(s.lang)} subtitles` });
    remove.addEventListener('click', () => removeLanguage(item, s.lang));
    parts.push(remove);
  }
  return el('span', { className: 'sub-chip' + (s.source === 'uploaded' ? ' file' : '') + (s.status === 'error' ? ' error' : '') }, ...parts);
}

// LYRICS_VIDEO_DIR is set but unusable: say why Generate is missing, where the user is looking for it.
const setupProblem = () => (!state.generator && state.generatorProblem
  ? [el('p', { className: 'hint error', textContent: `Generate isn't available: ${state.generatorProblem}` })]
  : []);

const jobError = (item) => (item.job?.status === 'error'
  ? [el('p', { className: 'hint error', textContent: `Couldn't make the subtitles: ${item.job.error}` })]
  : []);

// One video (screens 1, 2, 3 and 8).
function single(item) {
  const head = el('div', { className: 'strip-row spread' }, el('strong', { className: 'strip-title', textContent: 'Subtitles' }));

  if (busy(item)) {
    const view = jobView(item);
    const lang = item.job.lang ?? item.job.subtitles[0];
    head.append(button(item.job.status === 'queued' ? 'Cancel' : `Stop ${languageName(lang)}`, () => stop(item), 'link muted'));
    const kept = view.done.map(languageName);
    return [
      head,
      ...(readyOf(item).length ? [el('div', { className: 'strip-row' }, ...readyOf(item).map((s) => chip(item, s, { removable: false })))] : []),
      progressBar(item),
      el('div', { className: 'strip-row spread' },
        el('strong', { className: 'stage', textContent: view.label }),
        el('span', { className: 'hint', textContent: view.steps ?? '' })),
      ...(kept.length ? [el('p', { className: 'hint', textContent: `Stopping keeps ${and(kept)}.` })] : []),
    ];
  }

  const entries = entriesOf(item);
  if (entries.length) {
    const uploaded = entries.some((s) => s.source === 'uploaded');
    const missing = wantedLanguages().filter((l) => !item.subs[l]);
    const actions = [button('Review lines', () => review(item), 'btn')];
    if (uploaded) {
      if (state.generator && item.id && missing.length) actions.push(button(`Generate ${and(missing.map(languageName))}`, () => generate(item, missing), 'link'));
      actions.push(button('Upload another SRT', () => pickSrt(item), 'link'));
    } else {
      actions.push(button('Replace with SRT', () => pickSrt(item, true), 'link'));
    }
    return [
      head,
      el('div', { className: 'strip-row' }, ...entries.map((s) => chip(item, s))),
      el('div', { className: 'strip-row' }, ...actions),
      ...jobError(item),
    ];
  }

  const rows = [head];
  if (state.generator) rows.push(languageQuestions(false));
  const actions = [];
  if (state.generator) {
    const go = button('Generate', () => generate(item), 'btn primary');
    go.disabled = !item.id || !wantedLanguages().length;
    actions.push(go);
  }
  actions.push(button('Upload SRT', () => pickSrt(item), 'btn'));
  if (state.generator) {
    actions.push(el('span', { className: 'hint', textContent: !item.id ? 'Generate starts once the video has uploaded.' : 'Takes a few minutes. You can keep writing.' }));
  }
  rows.push(el('div', { className: 'strip-row' }, ...actions), ...jobError(item), ...setupProblem());
  return rows;
}

// Several videos (screen 7): the questions once, then a row per video with its own status and actions.
function several(list) {
  const pending = list.filter((i) => i.id && !busy(i) && !hasSubtitles(i));
  const head = el('div', { className: 'strip-row spread' }, el('strong', { className: 'strip-title', textContent: 'Subtitles' }));
  if (state.generator) {
    const all = button('Generate for all', () => pending.forEach((i) => generate(i)), 'btn primary');
    all.disabled = !pending.length || !wantedLanguages().length;
    head.append(all);
  }
  const rows = list.map((item, i) => {
    const info = [el('strong', { className: 'video-name', textContent: `${i + 1} · ${item.file.name}` })];
    const actions = [];
    if (busy(item)) {
      const view = jobView(item);
      if (item.job.status === 'running') {
        info.push(progressBar(item), el('span', { className: 'hint', textContent: view.label }));
        actions.push(button('Cancel', () => stop(item), 'link muted'));
      } else {
        info.push(el('span', { className: 'hint', textContent: view.label }));
        actions.push(button('Upload SRT', () => { stop(item); pickSrt(item); }, 'btn'), button('Skip', () => stop(item), 'link muted'));
      }
    } else if (entriesOf(item).length) {
      info.push(el('div', { className: 'strip-row' }, ...entriesOf(item).map((s) => chip(item, s))));
      actions.push(button('Review lines', () => review(item), 'btn'), button('Remove', () => removeAll(item), 'link muted'));
    } else {
      if (state.generator) {
        const go = button('Generate', () => generate(item), 'btn');
        go.disabled = !item.id || !wantedLanguages().length;
        actions.push(go);
      }
      actions.push(button('Upload SRT', () => pickSrt(item), 'btn'));
    }
    info.push(...jobError(item));
    const thumb = el('div', { className: 'mini' }, ...(item.thumb ? [el('img', { src: item.thumb, alt: '' })] : []));
    const row = el('div', { className: 'video-row' }, thumb, el('div', { className: 'video-info' }, ...info), ...actions);
    // An SRT dropped here belongs to this video; the composer's drop handler reads this.
    row.addEventListener('drop', (e) => { e.subtitleItem = item; });
    return row;
  });
  return [head, ...(state.generator ? [languageQuestions(true)] : []), ...setupProblem(), ...rows];
}

// Rebuilt only when what it shows changes, so an open dropdown isn't closed by typing or progress.
export function renderStrip() {
  const box = $('subtitles');
  const list = videos();
  const signature = list.length ? JSON.stringify([state.generator, state.generatorProblem, prefs, list.map((i) => [
    i.key, i.id, i.thumb ? 1 : 0, i.file.name,
    // Progress only moves the bar, without a rebuild.
    i.job && [i.job.status, i.job.stage, i.job.lang, i.job.files.length, i.job.error, i.job.after],
    entriesOf(i).map((s) => [s.lang, s.name, s.status, s.id, s.lines, s.error, s.source]),
  ])]) : '';
  if (box.dataset.signature !== signature) {
    box.dataset.signature = signature;
    box.hidden = !list.length;
    box.replaceChildren(...(list.length === 1 ? single(list[0]) : list.length ? several(list) : []));
  }
  for (const bar of box.querySelectorAll('.bar[data-job]')) {
    const item = list.find((i) => i.key === bar.dataset.job);
    if (item?.job) bar.firstChild.style.width = `${Math.round(jobView(item).fraction * 100)}%`;
  }
}

// ---- Review ----

function review(item, { lang, mode } = {}) {
  const entries = readyOf(item);
  if (!entries.length) return;
  openReview({
    item,
    entries,
    lang: entries.some((s) => s.lang === lang) ? lang : entries[0].lang,
    mode: mode ?? 'burned',
    // Edits become a new upload of the app's copy; the user's own file is never changed.
    onSave: (l, text, edited) => {
      const entry = item.subs[l];
      return uploadSrt(item, l, new Blob([text], { type: 'application/x-subrip' }), {
        name: entry.name, source: entry.source, lines: entry.lines, edited: (entry.edited ?? 0) + edited,
      });
    },
  });
}

// ---- Burned-in copies: made as soon as a platform needs one, and reused by the server when posting ----

// maxBytes: the size limit the copy must also fit (burnTarget), as the post will ask for it.
function burn(videoId, srtId, maxBytes) {
  const key = `${videoId}:${srtId}:${maxBytes ?? ''}`;
  let job = state.burns.get(key);
  if (!job) {
    job = { status: 'rendering', progress: 0 };
    state.burns.set(key, job);
    queueMicrotask(() => renderBurn(job, videoId, srtId, maxBytes));
  }
  return job;
}

async function renderBurn(job, videoId, srtId, maxBytes) {
  try {
    const res = await fetch('/api/subtitled', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ video: videoId, subtitles: srtId, maxBytes }),
    });
    if (!res.headers.get('content-type')?.includes('ndjson')) throw await errorOf(res);
    await readEvents(res, (event) => {
      if (event.type === 'progress') { job.progress = event.progress; hooks.update(); }
      if (event.type === 'done') Object.assign(job, { status: 'done', id: event.id });
      if (event.type === 'error') Object.assign(job, { status: 'error', error: event.error });
    });
    if (job.status === 'rendering') throw new Error('Lost the connection to the server.');
  } catch (err) {
    Object.assign(job, { status: 'error', error: err.message });
  }
  hooks.update();
}

// The languages YouTube gets as tracks: every language its video has, minus the ones unticked.
const trackLanguages = () => {
  const video = videos()[0];
  return video ? readyOf(video).map((s) => s.lang).filter((l) => !state.tracksOff.has(l)) : [];
};
const choiceOf = (p) => (CHOICE_PLATFORMS.has(p.id) ? prefs.choices[p.id] : undefined);

// What each platform will do with the subtitles, for the Post panel: Map id -> { text, progress?, busy?,
// waiting?, error? }. Starts any burned-in copy that's needed and not made yet.
export function subtitleStatus(targets) {
  const status = new Map();
  const list = videos();
  if (generating()) {
    const waiting = list.map((v, i) => (busy(v) ? i + 1 : 0)).filter(Boolean);
    const text = list.length > 1 ? `Waiting for subtitles on ${waiting.length > 1 ? 'videos' : 'video'} ${and(waiting.map(String))}` : 'Waiting for subtitles';
    for (const p of targets) status.set(p.id, { text, waiting: true });
    return status;
  }
  const langs = subtitleLanguages();
  if (!langs.length) return status;
  const shared = new Map(); // the burned copies' key -> the first platform using them
  for (const p of targets) {
    if (p.subtitleTracks) {
      const tracks = trackLanguages();
      if (tracks.length) status.set(p.id, { text: `${and(tracks.map(languageName))} track${tracks.length > 1 ? 's' : ''}` });
      continue;
    }
    const lang = burnLanguage(choiceOf(p), langs);
    const pairs = lang ? list.filter((v) => v.id && v.subs?.[lang]?.status === 'done')
      .map((v) => [v.id, v.subs[lang].id, burnTarget(p, v.file)]) : [];
    if (!pairs.length) continue;
    const key = pairs.map((pair) => pair.join(':')).join(',');
    const jobs = pairs.map(([videoId, srtId, maxBytes]) => burn(videoId, srtId, maxBytes));
    const failed = jobs.find((j) => j.status === 'error');
    const rendering = jobs.some((j) => j.status === 'rendering');
    if (shared.has(key)) {
      status.set(p.id, { text: `Same video as ${shared.get(key)}`, busy: rendering, error: failed?.error });
      continue;
    }
    shared.set(key, p.name);
    status.set(p.id, failed
      ? { text: `Couldn't add the subtitles: ${failed.error}`, error: failed.error }
      : rendering
        ? { text: `Adding ${languageName(lang)} subtitles`, busy: true, progress: jobs.reduce((n, j) => n + j.progress, 0) / jobs.length }
        : { text: `${languageName(lang)} subtitles added` });
  }
  return status;
}

// Sent with the post: { videoId: { lang: srtId } } for every video with subtitles.
export function subtitlesForPost() {
  const map = {};
  for (const v of videos()) {
    const ready = readyOf(v);
    if (v.id && ready.length) map[v.id] = Object.fromEntries(ready.map((s) => [s.lang, s.id]));
  }
  return Object.keys(map).length ? map : null;
}

// Each platform's choice, sent as options[id].subtitles: YouTube's ticked languages, or a language or 'none'.
export function subtitleOption(p) {
  if (p.subtitleTracks) return { subtitles: trackLanguages() };
  const choice = choiceOf(p);
  return choice ? { subtitles: choice } : {};
}

// ---- The Subtitles field in a platform's tab (screens 5 and 6) ----

export function renderChoice(p, slot) {
  const list = videos();
  const langs = p.subtitleTracks ? (list[0] ? readyOf(list[0]).map((s) => s.lang) : []) : CHOICE_PLATFORMS.has(p.id) ? subtitleLanguages() : [];
  const signature = JSON.stringify([langs, [...state.tracksOff], choiceOf(p)]);
  if (slot.dataset.signature === signature) return;
  slot.dataset.signature = signature;
  if (!langs.length) return slot.replaceChildren();
  const video = list.find((v) => readyOf(v).length);

  if (p.subtitleTracks) {
    const boxes = langs.map((lang) => {
      const input = el('input', { type: 'checkbox', checked: !state.tracksOff.has(lang) });
      input.addEventListener('change', () => {
        hooks.edited();
        input.checked ? state.tracksOff.delete(lang) : state.tracksOff.add(lang);
        hooks.update();
      });
      return el('label', { className: 'field check' }, input, `${languageName(lang)} track`);
    });
    const preview = button('Preview with CC', () => review(video, { lang: trackLanguages()[0], mode: 'track' }), 'link small');
    return slot.replaceChildren(el('div', { className: 'field subtitle-field' },
      el('span', { textContent: 'Subtitles' }), ...boxes,
      el('p', { className: 'hint' }, 'Viewers turn them on with CC. ', preview)));
  }

  const select = el('select', { id: `subtitles-${p.id}` },
    ...(langs.length > 1 ? langs.map((l) => el('option', { value: l, textContent: `Burned in · ${languageName(l)}` })) : [el('option', { value: langs[0], textContent: 'Burned in' })]),
    el('option', { value: 'none', textContent: 'None' }));
  select.value = burnLanguage(choiceOf(p), langs) ?? 'none';
  select.addEventListener('change', () => {
    hooks.edited();
    prefs.choices[p.id] = select.value;
    savePrefs();
    hooks.update();
  });
  const preview = button('Preview video', () => review(video, { lang: select.value, mode: 'burned' }), 'link small');
  preview.hidden = select.value === 'none';
  slot.replaceChildren(el('div', { className: 'field subtitle-field' },
    el('label', { htmlFor: select.id, textContent: 'Subtitles' }), select,
    el('p', { className: 'hint' }, 'Choose None if the video already has subtitles. ', preview)));
}

// The hidden file input behind Upload SRT, Replace with SRT and Upload another SRT.
export function initSubtitles() {
  $('subtitles-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file && pickFor && state.items.includes(pickFor.item)) addSubtitles(file, pickFor.item, { replace: pickFor.replace });
    pickFor = null;
  });
}
