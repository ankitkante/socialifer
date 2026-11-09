// The Post panel: readiness before posting, live progress while posting, results after.
import { $, el, logo } from './dom.js';
import { state, hooks, saveSelected } from './state.js';
import { platformOptions, resetSettings } from './fields.js';
import { clearMedia, isVideoFile } from './uploads.js';

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
  if (next !== 'done') $('substack-reminder').hidden = true;
  if (next === 'ready') setStatus('');
  hooks.update();
}

// Any change to the post after a finished post starts a new one, so the panel goes back to readiness.
export function edited() {
  if (state.phase === 'done') setPhase('ready');
}

// readiness: [{ p, started, problems, notes }]; reason: why Post is disabled ('' when it isn't).
export function renderPanel(readiness, { blocked, reason, reasonIsError }) {
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
      textContent: !readiness.length ? 'Choose where to post' : blocked ? 'Not ready yet' : 'Ready to post',
      className: 'panel-title',
    });
  }

  if (state.phase === 'ready') {
    $('checklist').replaceChildren(...(readiness.length ? readiness.map((r) => {
      const kind = !r.started ? '' : r.problems.length ? 'issue' : r.notes.length ? 'note' : 'ready';
      const label = !r.started ? '' : r.problems.length ? `${r.problems.length} issue${r.problems.length > 1 ? 's' : ''}`
        : r.notes.length ? 'Note' : '✓ Ready';
      const detail = r.problems[0] ?? r.notes[0] ?? (r.started ? r.summary : 'Waiting for your post');
      const button = el('button', { type: 'button', title: [...r.problems, ...r.notes].join('\n') },
        logo(r.p.id),
        el('span', { className: 'what' }, el('strong', { textContent: r.p.name }), el('span', { textContent: detail })),
        el('span', { className: 'state', textContent: label }),
      );
      button.addEventListener('click', () => hooks.selectTab(r.p.id, { scroll: true }));
      return el('li', { className: kind }, button);
    }) : [el('li', { className: 'empty', textContent: 'Select a platform in "Post to" to get started.' })]));
  }

  const postBtn = $('post');
  const failedBefore = state.phase === 'done' && failed > 0;
  postBtn.disabled = state.posting || Boolean(reason);
  postBtn.hidden = state.phase === 'posting' || (state.phase === 'done' && !failedBefore);
  const reasonEl = $('post-reason');
  reasonEl.textContent = reason;
  reasonEl.className = 'reason' + (reasonIsError ? ' err' : '');
  reasonEl.hidden = !reason || postBtn.hidden;

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

// Reads the server's stream of { type: 'status' | 'result' | 'done' } events, one JSON object per line.
async function readEvents(res, onEvent) {
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) onEvent(JSON.parse(line));
    }
  }
}

// Shown once a text or image post (no video) is out somewhere. The text is copied now, because a
// successful post clears the box.
function showSubstackReminder(text) {
  const copy = $('substack-copy');
  copy.textContent = 'Copy text';
  copy.hidden = !text.trim();
  copy.onclick = async () => {
    try {
      await navigator.clipboard.writeText(text);
      copy.textContent = 'Copied';
    } catch {
      copy.textContent = "Couldn't copy";
    }
  };
  $('substack-reminder').hidden = false;
}

// targets: the platforms to post to; text: the main post exactly as typed.
export async function post(targets, text) {
  if ($('post').disabled) return;
  const remindSubstack = !state.items.some((i) => isVideoFile(i.file));
  state.posting = true;
  const rows = targets.map((p) => ({ id: p.id, name: p.name, state: 'working', step: '' }));
  const row = (id) => rows.find((r) => r.id === id);
  state.lastRows = rows;
  renderResults();
  setPhase('posting');
  setStatus('You can leave this page open. Slow steps, like video processing, show above.');

  let done = false;
  try {
    const res = await fetch('/api/post', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        platforms: targets.map((p) => p.id),
        media: state.items.map((i) => ({ id: i.id, duration: i.meta?.duration })),
        options: platformOptions({ forSend: true }),
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
  if (remindSubstack && rows.some((r) => r.state === 'ok')) showSubstackReminder(text);
  const failed = rows.filter((r) => r.state === 'fail');
  const warnings = rows.reduce((n, r) => n + (r.warnings?.length ?? 0), 0);
  const warned = warnings ? `, with ${warnings} warning${warnings > 1 ? 's' : ''}` : '';
  if (failed.length === 0) {
    // Start the next post clean: no text, files or one-off settings (remembered ones stay).
    $('text').value = '';
    $('text').dispatchEvent(new Event('autosize'));
    state.overrides = {};
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
