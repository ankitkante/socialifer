// Per-platform fields: the FIELDS lists, their saved values, and the controls in each platform's tab.
import { el } from './dom.js';
import { effectiveText, LANGUAGES as ALL_LANGUAGES, SUBTITLE_LANGUAGES } from '/rules.js';
import { state, hooks, read, write, KEYS } from './state.js';
import { CONVERT_TO_JPEG, toJpeg, mediaMeta } from './uploads.js';

const YOUTUBE_CATEGORIES = [
  ['1', 'Film & Animation'], ['2', 'Autos & Vehicles'], ['10', 'Music'], ['15', 'Pets & Animals'], ['17', 'Sports'],
  ['19', 'Travel & Events'], ['20', 'Gaming'], ['22', 'People & Blogs'], ['23', 'Comedy'], ['24', 'Entertainment'],
  ['25', 'News & Politics'], ['26', 'Howto & Style'], ['27', 'Education'], ['28', 'Science & Technology'], ['29', 'Nonprofits & Activism'],
];
const LANGUAGES = [['', 'Not set'], ...ALL_LANGUAGES];
// The audio language follows "Video is in", so it offers the same languages subtitles support.
const AUDIO_LANGUAGES = [['', 'Not set'], ...SUBTITLE_LANGUAGES];
const singleVideo = ({ media, values }) => media.length === 1 && media[0].type.startsWith('video/') && values.postAs !== 'story';
const hasImage = ({ media }) => media.some((m) => !m.type.startsWith('video/'));

// Each platform's tab is built from this list. `sticky` values are remembered between posts; `when`
// hides (and stops sending) fields that don't apply to what's attached; `beforeText` goes above the
// platform's text box; `textLabel` names that box.
export const FIELDS = {
  youtube: {
    textLabel: 'Description',
    main: [
      { key: 'title', type: 'text', label: 'Title', wide: true, beforeText: true },
      { key: 'privacy', type: 'select', label: 'Visibility', sticky: true, initial: 'public',
        choices: [['public', 'Public'], ['unlisted', 'Unlisted'], ['private', 'Private']] },
      { key: 'publishAt', type: 'datetime-local', label: 'Schedule (optional)' },
      { key: 'audioLanguage', type: 'select', label: 'Audio language', sticky: true, initial: '', choices: AUDIO_LANGUAGES,
        hint: "Set from the video's language under Subtitles." },
      { key: 'category', type: 'select', label: 'Category', initial: '', choices: [['', 'YouTube default (People & Blogs)'], ...YOUTUBE_CATEGORIES] },
      { key: 'tags', type: 'text', label: 'Tags', placeholder: 'Comma-separated, e.g. lyric video, hindi song' },
      { key: 'thumbnail', type: 'image', label: 'Custom thumbnail', wide: true,
        hint: 'JPEG or PNG, ideally 1280×720, up to 2 MB. Needs a phone-verified channel.' },
      { key: 'madeForKids', type: 'check', label: 'Made for kids', sticky: true },
      { key: 'synthetic', type: 'check', label: 'Altered or synthetic content (realistic AI-generated or edited footage)' },
    ],
    more: [
      { key: 'recordingDate', type: 'date', label: 'Recording date' },
      { key: 'language', type: 'select', label: 'Title and description language', sticky: true, initial: 'en', choices: LANGUAGES },
    ],
    info: 'Until your Google API project passes YouTube\'s audit, uploads stay private whatever you choose here (see README).',
  },
  instagram: {
    textLabel: 'Caption',
    main: [
      { key: 'postAs', type: 'select', label: 'Post as', initial: 'feed', choices: [['feed', 'Post or Reel'], ['story', 'Story']] },
      { key: 'coverSeconds', type: 'number', label: 'Cover frame (seconds into the video)', placeholder: '0', when: singleVideo },
      { key: 'shareToFeed', type: 'check', label: 'Also share to Feed (your profile grid and followers\' home feeds)', sticky: true, initial: true, when: singleVideo },
      { key: 'cover', type: 'image', label: 'Or upload a cover image', hint: 'Replaces the frame above.', wide: true, when: singleVideo },
      { key: 'altText', type: 'text', label: 'Alt text (images)', wide: true, placeholder: 'Describe the image for people using screen readers', when: hasImage },
      { key: 'aiGenerated', type: 'check', label: 'Label as AI-generated' },
    ],
    more: [
      { key: 'audioName', type: 'text', label: 'Audio name (Reels)', placeholder: 'Original audio', when: singleVideo },
      { key: 'trial', type: 'select', label: 'Trial reel', initial: 'off', when: singleVideo, choices: [
        ['off', 'Off'], ['manual', 'Show to non-followers first; I\'ll share it later'], ['auto', 'Show to non-followers first; share it if it does well']] },
    ],
    info: '@mentions in the caption link to those accounts and notify them. Music from Instagram\'s library, filters and stickers can\'t be added through the API.',
  },
  x: {
    textLabel: 'Post',
    main: [
      { key: 'thread', type: 'check', label: 'Split long posts into a numbered thread', sticky: true, initial: true },
      { key: 'altText', type: 'text', label: 'Alt text (images)', placeholder: 'Describe the image', when: hasImage },
      { key: 'madeWithAi', type: 'check', label: 'Label as made with AI' },
    ],
  },
};

export const fieldsOf = (id) => [...(FIELDS[id]?.main ?? []), ...(FIELDS[id]?.more ?? [])];
const initialOf = (f) => f.initial ?? (f.type === 'check' ? false : '');

export function loadSettings() {
  const saved = read(KEYS.settings, {});
  for (const id of Object.keys(FIELDS)) {
    state.settings[id] = {};
    for (const f of fieldsOf(id)) {
      state.settings[id][f.key] = f.sticky && saved[id]?.[f.key] !== undefined ? saved[id][f.key] : initialOf(f);
    }
  }
}

function saveSettings() {
  const sticky = {};
  for (const id of Object.keys(FIELDS)) {
    sticky[id] = Object.fromEntries(fieldsOf(id).filter((f) => f.sticky).map((f) => [f.key, state.settings[id][f.key]]));
  }
  write(KEYS.settings, sticky);
}

// Sets a field from elsewhere on the page (YouTube's audio language follows "Video is in"), and redraws the tabs.
export function setSetting(id, key, value) {
  const f = fieldsOf(id).find((field) => field.key === key);
  if (!f || !state.settings[id]) return;
  state.settings[id][key] = value;
  if (f.sticky) saveSettings();
  state.sectionsKey = '';
}

// After a successful post, everything that isn't sticky goes back to its starting value.
export function resetSettings() {
  for (const id of Object.keys(FIELDS)) {
    for (const f of fieldsOf(id)) {
      if (f.sticky) continue;
      const value = state.settings[id][f.key];
      if (f.type === 'image' && value?.id) fetch(`/api/media/${value.id}`, { method: 'DELETE' }).catch(() => {});
      state.settings[id][f.key] = initialOf(f);
    }
  }
}

// What's sent (forSend: image fields as upload ids) or checked (image fields as { type, size }).
export function platformOptions({ forSend = false } = {}) {
  const options = {};
  const media = mediaMeta();
  for (const p of state.platforms) {
    const own = { ...(state.settings[p.id] ?? {}) };
    for (const f of fieldsOf(p.id)) {
      // Fields hidden for what's attached (e.g. a Reel cover with no video) aren't sent or checked.
      if (f.when && !f.when({ media, values: own })) { delete own[f.key]; continue; }
      if (f.type === 'image') own[f.key] = own[f.key]?.id ? (forSend ? own[f.key].id : own[f.key]) : undefined;
    }
    // Only platforms whose box was edited get their own text; the rest follow the main post.
    if (p.id in state.overrides) own.text = state.overrides[p.id];
    options[p.id] = own;
  }
  return options;
}

// What an unedited platform box shows: the main post, or on YouTube everything after the title line.
export const mirrored = (id, mainText) => effectiveText(mainText, { title: state.settings[id]?.title }, id);

export const fieldUploading = () => Object.values(state.settings).some((s) => Object.values(s).some((v) => v?.uploading));

// Uploads an image picked for a field (thumbnail, cover). PNG/WebP become JPEG like other images.
async function pickFieldImage(id, key, file) {
  hooks.edited();
  const previous = state.settings[id][key];
  if (previous?.id) fetch(`/api/media/${previous.id}`, { method: 'DELETE' }).catch(() => {});
  if (!file.type.startsWith('image/')) { hooks.setStatus(`${file.name} isn't an image.`, true); return; }
  if (CONVERT_TO_JPEG.has(file.type)) {
    try { file = await toJpeg(file); } catch {}
  }
  const value = { uploading: true, name: file.name, type: file.type, size: file.size, preview: URL.createObjectURL(file) };
  // Size and shape, for the preview's thumbnail notes.
  try {
    const bitmap = await createImageBitmap(file);
    Object.assign(value, { width: bitmap.width, height: bitmap.height });
    bitmap.close();
  } catch {}
  state.settings[id][key] = value;
  state.sectionsKey = '';
  hooks.update();
  try {
    const res = await fetch('/api/media', {
      method: 'POST',
      headers: { 'Content-Type': file.type, 'X-Filename': encodeURIComponent(file.name) },
      body: file,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
    Object.assign(value, { uploading: false, id: data.id });
  } catch (err) {
    state.settings[id][key] = '';
    hooks.setStatus(err.message, true);
  }
  state.sectionsKey = '';
  hooks.update();
}

// One control. Every field gets a hidden error line under it, filled in by main.js's checks.
export function renderField(id, f) {
  const values = state.settings[id];
  const set = (value) => {
    hooks.edited();
    values[f.key] = value;
    if (f.sticky) saveSettings();
    hooks.update();
  };
  let control;
  if (f.type === 'check') {
    const box = el('input', { type: 'checkbox', checked: Boolean(values[f.key]) });
    box.addEventListener('change', () => set(box.checked));
    control = el('label', { className: 'field check' }, box, f.label);
  } else if (f.type === 'select') {
    const select = el('select', {}, ...f.choices.map(([value, label]) => el('option', { value, textContent: label })));
    select.value = values[f.key];
    select.addEventListener('change', () => set(select.value));
    control = el('label', { className: 'field' }, f.label, select);
  } else if (f.type === 'image') {
    const value = values[f.key];
    const input = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', hidden: true });
    input.addEventListener('change', () => input.files[0] && pickFieldImage(id, f.key, input.files[0]));
    const choose = el('button', { type: 'button', className: 'attach', textContent: value ? 'Replace image' : 'Choose image' });
    choose.addEventListener('click', () => input.click());
    const parts = [choose, input];
    if (value) {
      const remove = el('button', { type: 'button', className: 'link', textContent: 'Remove' });
      remove.addEventListener('click', () => {
        if (value.id) fetch(`/api/media/${value.id}`, { method: 'DELETE' }).catch(() => {});
        state.sectionsKey = '';
        set('');
      });
      parts.unshift(el('img', { src: value.preview || '', alt: '' }));
      parts.push(el('span', { textContent: value.uploading ? 'Uploading…' : value.name }), remove);
    }
    control = el('div', { className: 'field' }, f.label, el('div', { className: 'image-field' }, ...parts));
  } else {
    const input = f.type === 'textarea' ? el('textarea', { className: 'small' }) : el('input', { type: f.type, autocomplete: 'off' });
    if (f.type === 'number') Object.assign(input, { min: 0, step: 0.1, inputMode: 'decimal' });
    Object.assign(input, { value: values[f.key] ?? '', placeholder: f.placeholder ?? '' });
    input.addEventListener('input', () => set(input.value));
    control = el('label', { className: 'field' }, f.label, input);
  }
  if (f.wide) control.classList.add('wide');
  if (f.hint) control.append(el('span', { className: 'field-hint', textContent: f.hint }));
  control.append(el('span', { className: 'field-error', hidden: true }));
  control.dataset.key = f.key;
  return control;
}
