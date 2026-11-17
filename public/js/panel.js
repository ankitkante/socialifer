// The Post panel: readiness before posting, live progress while posting, results after.
import { $, el, logo, readEvents } from './dom.js';
import { state, hooks, saveSelected } from './state.js';
import { platformOptions, resetSettings } from './fields.js';
import { clearMedia, isVideoFile } from './uploads.js';
import { subtitlesForPost, subtitleOption } from './subtitles.js';

export function setStatus(message, isError = false) {
  const status = $('status');
  status.textContent = message;
  status.className = 'status' + (isError ? ' err' : '');
}

export function setPhase(next) {
  state.phase = next;
  $('checklist').hidden = next !== 'ready';
  $('results').hidden = next === 'ready';
  $('new-post').hidden = next !== 'done';
  if (next === 'ready') setStatus('');
  hooks.update();
}

// Any change to the post after a finished post starts a new one, so the panel goes back to readiness.
export function edited() {
  if (state.phase === 'done') setPhase('ready');
}

// readiness: [{ p, started, problems, notes, summary, subtitles? }]; reason: why Post is disabled ('' when it
// isn't); note: shown under an enabled Post button; generating: subtitles are being made.
export function renderPanel(readiness, { blocked, reason, reasonIsError, note = '', generating = false }) {
  const title = $('panel-title');
  const rows = state.lastRows;
  const finished = rows.filter((r) => r.state !== 'working').length;
  const failed = rows.filter((r) => r.state === 'fail' || r.state === 'unknown').length;
  if (state.phase === 'posting') {
    Object.assign(title, { textContent: `Posting… ${finished} of ${rows.length} done`, className: 'panel-title' });
  } else if (state.phase === 'done') {
    Object.assign(title, failed
      ? { textContent: `${failed} of ${rows.length} didn't post`, className: 'panel-title err' }
      : { textContent: `Posted to ${rows.length} platform${rows.length > 1 ? 's' : ''}`, className: 'panel-title ok' });
  } else {
    Object.assign(title, {
      textContent: !readiness.length ? 'Choose where to post' : generating ? 'Making subtitles' : blocked ? 'Not ready yet' : 'Ready to post',
      className: 'panel-title',
    });
  }

  if (state.phase === 'ready') {
    $('checklist').replaceChildren(...(readiness.length ? readiness.map((r) => {
      // What the platform does with the subtitles comes first, unless something needs fixing.
      const sub = r.started && !r.problems.length ? r.subtitles : null;
      const working = sub && (sub.waiting || sub.busy);
      const kind = !r.started ? '' : r.problems.length ? 'issue' : working || sub?.error || r.notes.length ? 'note' : 'ready';
      const label = !r.started ? '' : r.problems.length ? `${r.problems.length} issue${r.problems.length > 1 ? 's' : ''}`
        : sub?.waiting ? 'Waiting' : working ? 'Working' : sub?.error || r.notes.length ? 'Note' : '✓ Ready';
      const detail = r.problems[0] ?? sub?.text ?? r.notes[0] ?? (r.started ? r.summary : 'Waiting for your post');
      const what = el('span', { className: 'what' }, el('strong', { textContent: r.p.name }), el('span', { textContent: detail }));
      if (sub?.busy && typeof sub.progress === 'number') {
        const bar = el('div', { className: 'bar' }, el('span'));
        bar.firstChild.style.width = `${Math.round(sub.progress * 100)}%`;
        what.append(bar);
      }
      const button = el('button', { type: 'button', title: [...r.problems, ...r.notes].join('\n') },
        logo(r.p.id), what, el('span', { className: 'state', textContent: label }));
      button.addEventListener('click', () => hooks.selectTab(r.p.id, { scroll: true }));
      return el('li', { className: kind }, button);
    }) : [el('li', { className: 'empty', textContent: 'Select a platform in "Post to" to get started.' })]));
  }

  const postBtn = $('post');
  const failedBefore = state.phase === 'done' && failed > 0;
  postBtn.disabled = state.posting || Boolean(reason);
  postBtn.hidden = state.phase === 'posting' || (state.phase === 'done' && !failedBefore);
  const reasonEl = $('post-reason');
  reasonEl.textContent = reason || (state.phase === 'ready' ? note : '');
  reasonEl.className = 'reason' + (reason && reasonIsError ? ' err' : '');
  reasonEl.hidden = !reasonEl.textContent || postBtn.hidden;

  // The phone bar mirrors the panel's summary and button.
  $('bar-count').textContent = $('post-label').textContent;
  $('bar-state').textContent = state.phase === 'ready'
    ? reason || (readiness.some((r) => r.notes.length) ? '✓ Ready, with notes' : '✓ Ready')
    : title.textContent;
  $('bar-post').disabled = postBtn.disabled;
  $('bar-post').hidden = postBtn.hidden;
}

// One row per platform: 'working' with its current step (and a bar) while posting, then 'ok' or
// 'fail'. 'unknown' means the page lost the server before hearing back, so the post may or may not be out.
const ICONS = { working: '…', ok: '✓', fail: '✕', unknown: '?' };

function renderResults() {
  $('results').replaceChildren(...state.lastRows.map((r) => {
    let detail;
    if (r.state === 'ok') {
      const copy = el('button', { type: 'button', className: 'copy', textContent: 'Copy link' });
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(r.url);
          copy.textContent = 'Copied';
        } catch {
          copy.textContent = "Couldn't copy";
        }
      });
      detail = r.url
        ? el('div', { className: 'links' }, el('a', { href: r.url, target: '_blank', rel: 'noopener', textContent: 'View post' }), copy)
        : el('div', { className: 'detail', textContent: 'Posted' });
    } else if (r.state === 'working') {
      const bar = el('div', { className: 'bar' + (typeof r.progress === 'number' ? '' : ' indeterminate') }, el('span'));
      if (typeof r.progress === 'number') bar.firstChild.style.width = `${Math.round(r.progress * 100)}%`;
      detail = el('div', {}, el('div', { className: 'detail', textContent: r.step ? `${r.step}…` : 'Starting…' }), bar);
    } else {
      detail = el('div', { className: 'detail', textContent: r.error });
    }
    const percent = r.state === 'working' && typeof r.progress === 'number' ? ` · ${Math.round(r.progress * 100)}%` : '';
    return el('li', { className: r.state },
      el('span', { className: 'icon', textContent: ICONS[r.state] }),
      el('div', { className: 'body' },
        el('div', { className: 'name' }, logo(r.id), r.name + percent),
        detail,
        ...(r.warnings ?? []).map((w) => el('div', { className: 'warning', textContent: `⚠ ${w}` })),
      ),
    );
  }));
}

function copyButton(label, value) {
  const button = el('button', { type: 'button', className: 'copy', textContent: label });
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(value);
      button.textContent = 'Copied';
    } catch {
      button.textContent = "Couldn't copy";
    }
  });
  return button;
}

// The reminder to post on Substack by hand. text is passed in because a successful post clears the box.
// files: the videos saved for it (null for a post without video); an empty list means saving them failed.
// It closes only with Done: Escape is refused, and if the browser closes it anyway (Chrome does on a
// second Escape), it opens again.
function showSubstackReminder(text, files = null) {
  const dialog = $('substack-reminder');
  $('substack-copy').replaceWith(Object.assign(copyButton('Copy text', text), { id: 'substack-copy', hidden: !text.trim() }));
  const list = $('substack-files');
  list.hidden = !files;
  if (files) {
    const many = files.length > 1;
    list.replaceChildren(
      el('p', { textContent: files.length
        ? `Upload ${many ? 'these videos' : 'this video'} in Substack. ${many ? 'They\'re' : 'It\'s'} deleted from here when you click Done:`
        : "Couldn't save a copy of the video for Substack (the terminal says why). Upload the one you added instead." }),
      ...files.map((path) => el('div', { className: 'substack-file' }, el('code', { textContent: path }), copyButton('Copy path', path))),
    );
  }
  let done = false;
  dialog.oncancel = (event) => event.preventDefault();
  dialog.onclose = () => { if (!done) dialog.showModal(); };
  $('substack-done').onclick = () => {
    done = true;
    dialog.close();
    // Nothing to tell the user if this fails: the server logs it, and the file just stays.
    if (files?.length) {
      fetch('/api/kept/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files }) }).catch(() => {});
    }
  };
  if (!dialog.open) dialog.showModal();
}

// targets: the platforms to post to; text: the main post exactly as typed.
export async function post(targets, text) {
  if ($('post').disabled) return;
  const hasVideo = state.items.some((i) => isVideoFile(i.file));
  // Retrying the failed platforms is the same post, so Substack was already reminded about.
  const retry = state.phase === 'done';
  state.posting = true;
  const rows = targets.map((p) => ({ id: p.id, name: p.name, state: 'working', step: '' }));
  const row = (id) => rows.find((r) => r.id === id);
  state.lastRows = rows;
  renderResults();
  setPhase('posting');
  setStatus('You can leave this page open. Slow steps, like video processing, show above.');
  // Text and images: the reminder doesn't wait for the platforms. Videos: it waits for the saved copy.
  if (!retry && !hasVideo) showSubstackReminder(text);
  let saved = [];

  let done = false;
  // Each platform's subtitles choice travels with its other options.
  const options = platformOptions({ forSend: true });
  for (const p of targets) Object.assign(options[p.id] ??= {}, subtitleOption(p));
  const subtitles = subtitlesForPost();
  try {
    const res = await fetch('/api/post', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        platforms: targets.map((p) => p.id),
        media: state.items.map((i) => ({ id: i.id, duration: i.meta?.duration })),
        options,
        ...(subtitles && { subtitles }),
      }),
    });
    // Problems found before posting starts (an expired file, a bad request) come back as plain JSON.
    if (!res.headers.get('content-type')?.includes('ndjson')) {
      let data = {};
      try { data = await res.json(); } catch {}
      throw Object.assign(new Error(data.error || `The server returned an error (HTTP ${res.status}). Check the terminal.`), { beforePosting: true });
    }
    await readEvents(res, (event) => {
      if (event.type === 'status') Object.assign(row(event.id), { step: event.step, progress: event.progress });
      if (event.type === 'result') Object.assign(row(event.id), { ...event, state: event.ok ? 'ok' : 'fail' });
      if (event.type === 'substack') saved = event.files;
      if (event.type === 'done') done = true;
      renderResults();
      hooks.update();
    });
    if (!done) throw new Error('lost');
  } catch (err) {
    state.posting = false;
    if (err.beforePosting) {
      setPhase('ready');
      setStatus(err.message, true);
    } else {
      // The page lost the server mid-post. Anything still in progress may or may not have gone out,
      // so say so rather than inviting a retry that could post twice.
      for (const r of rows) {
        if (r.state === 'working') Object.assign(r, { state: 'unknown', error: 'Unknown: the connection to the server was lost. Check this platform before retrying.' });
      }
      renderResults();
      setPhase('done');
      setStatus('Lost the connection to the server. Some posts may already be published, so check each platform before retrying. Details are in the terminal.', true);
    }
    return;
  }

  state.posting = false;
  if (!retry && hasVideo && rows.some((r) => r.state === 'ok')) showSubstackReminder(text, saved);
  const failed = rows.filter((r) => r.state === 'fail');
  const warnings = rows.reduce((n, r) => n + (r.warnings?.length ?? 0), 0);
  const warned = warnings ? `, with ${warnings} warning${warnings > 1 ? 's' : ''}` : '';
  if (failed.length === 0) {
    // Start the next post clean: no text, files or one-off settings (remembered ones stay).
    $('text').value = '';
    $('text').dispatchEvent(new Event('autosize'));
    state.overrides = {};
    state.tracksOff.clear();
    resetSettings();
    state.sectionsKey = '';
    clearMedia();
    setPhase('done');
    setStatus(`Done${warned}. Start typing, or click New post, to write the next one.`);
  } else {
    // Keep the text and media so you can fix the problem and retry just the failed platforms.
    state.selected = new Set(failed.map((r) => r.id));
    saveSelected();
    setPhase('done');
    setStatus(`Your post was kept${warned}, and only the failed platforms are still selected, so the button above retries just those.`, true);
  }
}
