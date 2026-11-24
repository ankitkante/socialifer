// Per-platform fields: their saved values and the controls in each platform's tab. The lists are in /fields.js.
import { el } from './dom.js';
import { effectiveText } from '/rules.js';
import { FIELDS, fieldsOf, initialOf, savedOr } from '/fields.js';
import { backgroundCss, slideBackground, slideStyle } from '/slides.js';
import { state, hooks, read, write, KEYS } from './state.js';
import { CONVERT_TO_JPEG, toJpeg, mediaMeta } from './uploads.js';

export { FIELDS, fieldsOf };

export function loadSettings() {
  const saved = read(KEYS.settings, {});
  for (const id of Object.keys(FIELDS)) {
    state.settings[id] = {};
    for (const f of fieldsOf(id)) {
      state.settings[id][f.key] = f.sticky ? savedOr(f, saved[id]?.[f.key]) : initialOf(f);
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

// A small drawing of a slide style on the chosen background: lines of text, or a big first line for the cover.
function styleThumb(styleId, backgroundId) {
  const style = slideStyle(styleId);
  const thumb = el('span', { className: `style-thumb ${style.align}` });
  Object.assign(thumb.style, backgroundCss(backgroundId, 116));
  thumb.style.color = slideBackground(backgroundId).text;
  const bars = style.cover ? ['80%', '55%'] : ['80%', '70%', '76%', '44%'];
  thumb.append(...bars.map((width) => el('i', { className: style.cover ? 'big' : '', style: `width: ${width}` })));
  if (style.cover) thumb.append(el('i', { className: 'small', style: 'width: 30%' }));
  return thumb;
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
  if (f.type === 'slideStyle' || f.type === 'slideBackground') {
    const swatches = f.type === 'slideBackground';
    const label = el('span', {}, f.label, swatches ? el('strong', { className: 'picked', textContent: ` · ${slideBackground(values[f.key]).name}` }) : '');
    control = el('div', { className: 'field' }, label, el('div', { className: swatches ? 'swatches' : 'slide-styles' },
      ...f.choices.map(([value, name]) => {
        const button = swatches
          ? el('button', { type: 'button', className: 'swatch', title: name })
          : el('button', { type: 'button', className: 'slide-style' }, styleThumb(value, values.slideBackground), el('span', { textContent: name }));
        if (swatches) {
          Object.assign(button.style, backgroundCss(value, 44));
          button.setAttribute('aria-label', name);
        }
        button.setAttribute('aria-pressed', String(values[f.key] === value));
        // Rebuilt, so the other picker's thumbnails take the new choice.
        button.addEventListener('click', () => { state.sectionsKey = ''; set(value); });
        return button;
      })));
  } else if (f.type === 'check') {
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
