// Social Post's page: the platform picker, per-platform tabs (fields, errors, previews), and wiring.
import { $, el, logo, truncate, BRAND_COLORS } from './dom.js';
import { countFor, problemsFor, adjustmentsFor, resolveTitle, effectiveText, splitThread } from '/rules.js';
import { state, hooks, activeTargets, saveSelected, write, KEYS } from './state.js';
import { FIELDS, fieldsOf, loadSettings, platformOptions, mirrored, fieldUploading, renderField } from './fields.js';
import { addFiles, mediaMeta, uploadsBusy, uploadsFailed, isVideoFile } from './uploads.js';
import { renderPreview, hasPreview } from './previews.js';
import {
  addSubtitles, forgetSubtitles, initSubtitles, renderStrip, renderChoice, subtitleStatus, generating,
} from './subtitles.js';
import { setStatus, setPhase, edited, renderPanel, post } from './panel.js';
import { initTheme, startStatus } from './status.js';

const textEl = $('text');

// ---- Platform picker ----

function renderPicker() {
  const configured = state.platforms.filter((p) => p.configured);
  const unconfigured = state.platforms.filter((p) => !p.configured);

  $('platforms').replaceChildren(...configured.map((p) => {
    const pill = el('button', { type: 'button', className: 'pill', title: `Post to ${p.name}` },
      logo(p.id), p.name, el('span', { className: 'issue-dot', hidden: true, title: 'Has an issue' }));
    pill.style.setProperty('--pill', BRAND_COLORS[p.id] ?? 'var(--text)');
    pill.dataset.id = p.id;
    pill.addEventListener('click', () => {
      edited();
      state.selected.has(p.id) ? state.selected.delete(p.id) : state.selected.add(p.id);
      saveSelected();
      update();
    });
    return pill;
  }));

  const setupItems = () => unconfigured.map((p) => el('div', { className: 'setup-item' },
    el('strong', {}, logo(p.id), p.name),
    el('code', { textContent: p.envVars.join(', ') }),
  ));
  $('setup-list').replaceChildren(...setupItems());
  $('first-run-list').replaceChildren(...setupItems());
  const toggle = $('setup-toggle');
  toggle.hidden = unconfigured.length === 0;
  toggle.textContent = `+ Set up more (${unconfigured.length})`;
}

function setSetupOpen(open) {
  $('setup-panel').hidden = !open;
  $('setup-toggle').setAttribute('aria-expanded', String(open));
  $('setup-toggle').textContent = open ? 'Hide platforms' : `+ Set up more (${state.platforms.filter((p) => !p.configured).length})`;
}

// ---- Tabs ----

function renderTabs(targets) {
  const tabs = [{ id: 'all', name: 'All' }, ...targets];
  $('tabbar').replaceChildren(...tabs.map((t) => {
    const tab = el('button', { type: 'button', className: 'tab', role: 'tab', id: `tabbtn-${t.id}` },
      t.id === 'all' ? '' : logo(t.id), t.name, t.id === 'all' ? '' : el('span', { className: 'tab-badge', hidden: true }));
    tab.setAttribute('aria-controls', `tab-${t.id}`);
    tab.dataset.id = t.id;
    tab.addEventListener('click', () => selectTab(t.id));
    return tab;
  }));
}

function selectTab(id, { scroll = false } = {}) {
  state.tab = id;
  write(KEYS.tab, id);
  applyTab();
  if (scroll) $('platform-settings').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function applyTab() {
  for (const tab of $('tabbar').children) {
    const on = tab.dataset.id === state.tab;
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
  }
  $('tab-all').hidden = state.tab !== 'all';
  for (const section of $('platform-sections').children) section.hidden = section.dataset.id !== state.tab;
}

// Left/right arrows move between tabs, as in any tab list.
$('tabbar').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const tabs = [...$('tabbar').children];
  const next = tabs[(tabs.findIndex((t) => t.dataset.id === state.tab) + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
  selectTab(next.dataset.id);
  next.focus();
});

// ---- One tab per platform: its text, fields, messages and preview ----

// Which field a problem belongs to, so it can show right under that field.
const PROBLEM_FIELDS = [
  [/^(Needs a title|Title is too long)/, 'title'],
  [/^Tags/, 'tags'],
  [/schedule time/i, 'publishAt'],
  [/thumbnail/i, 'thumbnail'],
  [/cover image/i, 'cover'],
  [/cover frame/i, 'coverSeconds'],
  [/^Trial reels/, 'trial'],
  [/^Alt text/, 'altText'],
  [/^(Text is too long|Too long for one post|Too long even for a thread|Can't contain|Add some text)/, 'text'],
];
const fieldForProblem = (message) => PROBLEM_FIELDS.find(([re]) => re.test(message))?.[1];

function renderSections(targets) {
  $('platform-sections').replaceChildren(...targets.map((p) => {
    const spec = FIELDS[p.id];
    // The box shows the main post until it's edited; then it's this platform's own text.
    const box = el('textarea', {
      value: p.id in state.overrides ? state.overrides[p.id] : mirrored(p.id, textEl.value),
      placeholder: 'Type in "Your post" above, or here for this platform only',
      className: 'platform-text',
    });
    box.addEventListener('input', () => { edited(); state.overrides[p.id] = box.value; update(); });
    const reset = el('button', { type: 'button', className: 'link reset', textContent: '↺ Use main post', title: 'Follow the main post again' });
    reset.addEventListener('click', () => {
      delete state.overrides[p.id];
      box.value = mirrored(p.id, textEl.value);
      update();
    });

    const textField = el('label', { className: 'field wide' }, spec?.textLabel ?? 'Text', box, el('span', { className: 'field-error', hidden: true }));
    textField.dataset.key = 'text';
    const before = spec?.main.filter((f) => f.beforeText) ?? [];
    const fieldsCol = el('div', { className: 'section-fields' },
      el('ul', { className: 'messages' }),
      ...(before.length ? [el('div', { className: 'fields' }, ...before.map((f) => renderField(p.id, f)))] : []),
      textField,
    );
    // The platform's Subtitles field (subtitles.js fills it in when a video has subtitles).
    const subtitleSlot = el('div', { className: 'subtitle-choice' });
    if (spec) {
      fieldsCol.append(el('div', { className: 'fields' }, ...spec.main.filter((f) => !f.beforeText).map((f) => renderField(p.id, f))), subtitleSlot);
      if (spec.more?.length) {
        fieldsCol.append(el('details', { className: 'more' }, el('summary', { textContent: 'More options' }),
          el('div', { className: 'fields' }, ...spec.more.map((f) => renderField(p.id, f)))));
      }
      if (spec.info) fieldsCol.append(el('p', { className: 'hint', textContent: spec.info }));
    } else {
      fieldsCol.append(subtitleSlot);
    }

    const section = el('div', { className: 'tab-panel', role: 'tabpanel', id: `tab-${p.id}` },
      el('div', { className: 'section-head' },
        el('h2', {}, logo(p.id), p.name),
        el('div', { className: 'right' }, reset, el('span', { className: 'count' }))),
      el('div', { className: 'section-body' + (hasPreview(p.id) ? ' with-preview' : '') }, fieldsCol, el('div', { className: 'preview-slot' })),
    );
    section.setAttribute('aria-labelledby', `tabbtn-${p.id}`);
    section.dataset.id = p.id;
    return section;
  }));
}

// "312 / 280" normally; "312 · 2 posts" when X will split it into a thread.
function counter(p, text, options = {}) {
  const n = countFor(p.id, text);
  const parts = p.threads && options.thread && n > p.limit ? splitThread(p.id, text, p.limit).length : 1;
  if (parts > 1) return { textContent: `${n.toLocaleString()} · ${parts} posts`, className: 'count' };
  return { textContent: `${n.toLocaleString()} / ${p.limit.toLocaleString()}`, className: 'count' + (n > p.limit ? ' over' : n > p.limit * 0.9 ? ' near' : '') };
}

function updateSection(p, { text, own, options, media, problems, notes }) {
  const section = $('platform-sections').querySelector(`[data-id="${p.id}"]`);
  if (!section) return;
  Object.assign(section.querySelector('.section-head .count'), counter(p, own, options[p.id]));

  // Boxes that haven't been edited follow the main post as it's typed.
  const box = section.querySelector('.platform-text');
  const editedBox = p.id in state.overrides;
  const mirror = mirrored(p.id, textEl.value);
  if (!editedBox && box.value !== mirror) box.value = mirror;
  section.querySelector('.reset').hidden = !editedBox;

  const title = section.querySelector('[data-key="title"] input');
  if (title) {
    const fallback = resolveTitle(text, '');
    title.placeholder = fallback ? `Defaults to: ${fallback}` : 'Defaults to the first line of your post';
  }

  // Fields that don't apply to what's attached are hidden.
  for (const f of fieldsOf(p.id)) {
    const node = section.querySelector(`[data-key="${f.key}"]`);
    if (node) node.hidden = f.when ? !f.when({ media, values: state.settings[p.id] }) : false;
  }

  // Each problem goes under its field when it has one; the rest, and notes, go at the top.
  for (const node of section.querySelectorAll('[data-key]')) {
    node.classList.remove('invalid');
    const error = node.querySelector(':scope > .field-error');
    if (error) { error.hidden = true; error.textContent = ''; }
  }
  const general = [];
  for (const message of problems) {
    const node = section.querySelector(`[data-key="${fieldForProblem(message)}"]`);
    const error = node?.querySelector(':scope > .field-error');
    if (!error || node.hidden) { general.push(message); continue; }
    node.classList.add('invalid');
    error.hidden = false;
    error.textContent = error.textContent ? `${error.textContent} ${message}.` : `${message}.`;
  }
  section.querySelector('.messages').replaceChildren(
    ...general.map((m) => el('li', { className: 'problem', textContent: m })),
    ...notes.map((m) => el('li', { className: 'note', textContent: m })),
  );

  const slot = section.querySelector('.preview-slot');
  const preview = renderPreview(p.id, { text, options, items: state.items, platform: p });
  slot.replaceChildren(...(preview ? [preview] : []));
  renderChoice(p, section.querySelector('.subtitle-choice'));
}

function updateTabBadge(id, { started, problems, notes }) {
  const badge = $('tabbar').querySelector(`[data-id="${id}"] .tab-badge`);
  if (!badge) return;
  badge.hidden = !started;
  if (problems.length) Object.assign(badge, { className: 'tab-badge issue', textContent: `! ${problems.length}`, title: `${problems.length} issue${problems.length > 1 ? 's' : ''}` });
  else if (notes.length) Object.assign(badge, { className: 'tab-badge note', textContent: 'i', title: 'Has a note' });
  else Object.assign(badge, { className: 'tab-badge ready', textContent: '✓', title: 'Ready' });
}

// A one-line description of what each platform will get, for the All tab and the checklist.
function summaryFor(p, text, options, media) {
  const o = options[p.id] ?? {};
  const own = effectiveText(text, o, p.id);
  if (p.id === 'youtube') {
    const title = resolveTitle(text, o.title);
    return title ? `Title: "${truncate(title, 48).text}${truncate(title, 48).cut ? '…' : ''}"` : 'Needs a title';
  }
  if (p.id === 'instagram') {
    const kind = o.postAs === 'story' ? 'Story' : media.length > 1 ? `Carousel of ${media.length}` : media[0]?.type.startsWith('video/') ? 'Reel' : 'Post';
    return `${kind}${own ? `, ${countFor(p.id, own)}-character caption` : ''}`;
  }
  if (p.threads && o.thread && countFor(p.id, own) > p.limit) return `Thread of ${splitThread(p.id, own, p.limit).length} posts`;
  return `${countFor(p.id, own).toLocaleString()} / ${p.limit.toLocaleString()} characters`;
}

function renderSummaryList(readiness) {
  $('summary-list').replaceChildren(...readiness.map((r) => {
    const button = el('button', { type: 'button' },
      el('strong', {}, logo(r.p.id), r.p.name),
      el('span', { textContent: r.problems[0] ?? r.summary }));
    button.addEventListener('click', () => selectTab(r.p.id));
    return el('li', {}, button);
  }));
}

// ---- Re-render everything that depends on the post ----

function update() {
  const text = textEl.value.trim();
  const media = mediaMeta();
  const options = platformOptions();
  const targets = activeTargets();

  for (const pill of $('platforms').children) pill.setAttribute('aria-pressed', String(state.selected.has(pill.dataset.id)));

  $('platform-settings').hidden = targets.length === 0;
  const key = targets.map((p) => p.id).join(',');
  if (state.sectionsKey !== key) {
    renderTabs(targets);
    renderSections(targets);
    state.sectionsKey = key;
  }
  if (state.tab !== 'all' && !targets.some((p) => p.id === state.tab)) state.tab = 'all';
  applyTab();

  const readiness = [];
  const subtitles = subtitleStatus(targets);
  for (const p of targets) {
    const own = effectiveText(text, options[p.id], p.id);
    // An empty composer can't be posted anyway, so don't greet the user with warnings.
    const started = Boolean(text || media.length || options[p.id]?.text?.trim() || options[p.id]?.title?.trim());
    const problems = started ? problemsFor(p, text, media, options[p.id]) : [];
    const notes = adjustmentsFor(p, media, options[p.id], text);
    const entry = { p, started, problems, notes, summary: summaryFor(p, text, options, media), subtitles: subtitles.get(p.id) };
    readiness.push(entry);
    updateSection(p, { text, own, options, media, problems, notes });
    updateTabBadge(p.id, entry);
    const dot = $('platforms').querySelector(`[data-id="${p.id}"] .issue-dot`);
    if (dot) dot.hidden = !problems.length;
  }
  for (const pill of $('platforms').children) {
    if (!state.selected.has(pill.dataset.id)) pill.querySelector('.issue-dot').hidden = true;
  }
  renderSummaryList(readiness);

  const anyText = text || targets.some((p) => options[p.id]?.text?.trim());
  const issues = readiness.filter((r) => r.problems.length);
  const issueCount = issues.reduce((n, r) => n + r.problems.length, 0);
  // Why Post is disabled, in plain words; red only when there's something to fix.
  const making = generating();
  const severalVideos = state.items.filter((i) => isVideoFile(i.file)).length > 1;
  const reason = uploadsFailed() ? 'Remove the files that failed to upload'
    : uploadsBusy() || fieldUploading() ? 'Uploading your files…'
    : making ? (severalVideos ? "Posting opens once every video's subtitles are done or skipped."
      : 'Posting opens once the subtitles are done, or cancel them to post without.')
    : targets.length === 0 ? 'Select at least one platform'
    : !anyText && state.items.length === 0 ? 'Write something, or add a photo or video'
    : issueCount ? `Fix ${issueCount} issue${issueCount > 1 ? 's' : ''} on ${issues.map((r) => r.p.name).join(' and ')}, or untick ${issues.length > 1 ? 'them' : 'it'}`
    : '';
  $('post-label').textContent = targets.length > 1 ? `Post to ${targets.length} platforms` : targets.length === 1 ? `Post to ${targets[0].name}` : 'Post';
  // Posting while subtitles are still being burned in is fine: those platforms wait for their copy.
  const burning = readiness.filter((r) => r.subtitles?.busy).map((r) => r.p.name);
  const note = burning.length ? `${burning.length > 1 ? `${burning.slice(0, -1).join(', ')} and ${burning.at(-1)}` : burning[0]} finish adding subtitles before ${burning.length > 1 ? 'they post' : 'it posts'}.` : '';
  renderPanel(readiness, { blocked: issueCount > 0, reason, reasonIsError: issueCount > 0 || uploadsFailed(), note, generating: making });
  renderStrip();
}

// ---- Wiring ----

hooks.update = update;
hooks.edited = edited;
hooks.setStatus = setStatus;
hooks.selectTab = selectTab;
hooks.addSubtitles = addSubtitles;
hooks.forgetSubtitles = forgetSubtitles;

const doPost = () => post(activeTargets(), textEl.value);

// The main box grows with its text, up to 60% of the window.
function autosize() {
  textEl.style.height = 'auto';
  textEl.style.height = `${Math.min(textEl.scrollHeight, window.innerHeight * 0.6)}px`;
}

textEl.addEventListener('input', () => { edited(); autosize(); update(); });
textEl.addEventListener('autosize', autosize);
textEl.addEventListener('paste', (e) => {
  const files = [...e.clipboardData.files];
  if (files.length) { e.preventDefault(); addFiles(files); }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); doPost(); }
  if (e.key === 'Escape' && !$('setup-panel').hidden) setSetupOpen(false);
});
$('post').addEventListener('click', doPost);
$('bar-post').addEventListener('click', doPost);
$('bar-summary').addEventListener('click', () => $('post-panel').scrollIntoView({ behavior: 'smooth', block: 'start' }));
$('new-post').addEventListener('click', () => { setPhase('ready'); textEl.focus(); });
$('attach').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', (e) => { addFiles([...e.target.files]); e.target.value = ''; });
initSubtitles();
$('setup-toggle').addEventListener('click', () => setSetupOpen($('setup-panel').hidden));
$('setup-close').addEventListener('click', () => setSetupOpen(false));

const composer = $('composer');
let dragDepth = 0;
composer.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; composer.classList.add('dragging'); });
composer.addEventListener('dragover', (e) => e.preventDefault());
composer.addEventListener('dragleave', () => { if (--dragDepth === 0) composer.classList.remove('dragging'); });
composer.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  composer.classList.remove('dragging');
  // An SRT dropped on a video's row under Subtitles goes to that video (set by the row's own handler).
  addFiles([...e.dataTransfer.files], e.subtitleItem);
});

// ---- Start ----

initTheme();
loadSettings();
try {
  state.platforms = await (await fetch('/api/platforms')).json();
} catch {
  setStatus("Couldn't reach the Social Post server. Check that it's running (npm start), then refresh.", true);
}
const configured = state.platforms.filter((p) => p.configured);
renderPicker();
if (state.platforms.length && !configured.length) {
  // Nothing set up yet: show how to set up a platform instead of the composer.
  $('layout').hidden = true;
  $('bottom-bar').hidden = true;
  $('first-run').hidden = false;
}
startStatus(configured.some((p) => p.media.needsPublicUrl));
autosize();
setPhase('ready');
