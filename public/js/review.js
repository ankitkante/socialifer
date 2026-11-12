// Review lines: the video beside its subtitle lines, one tab per language. The line being spoken is
// highlighted, clicking a line jumps there, and only the text can be changed, never the timing.
import { $, el } from './dom.js';
import { languageName, parseSrt, formatSrt, separateCues, formatDuration } from '/rules.js';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// item: the video; entries: its subtitles [{ lang, id, source }]; mode: 'burned' or 'track';
// onSave(lang, srtText, editedCount) stores an edited language and resolves when it's saved.
export function openReview({ item, entries, lang, mode, onSave }) {
  const dialog = $('review');
  const vertical = !item.meta || item.meta.height >= item.meta.width;
  const texts = {}; // lang -> Promise of { cues, edits }
  let current = lang;
  let view = mode;
  let active = -1;
  let unsaved = 0; // edited lines not saved with Done yet

  // The same lines the platforms get: overlapping ones are trimmed, as for burning in and YouTube.
  const load = (l) => (texts[l] ??= fetch(`/media/${entries.find((s) => s.lang === l).id}.srt`)
    .then((res) => { if (!res.ok) throw new Error('The subtitles file has expired. Remove it and add it again.'); return res.text(); })
    .then((srt) => {
      const cues = parseSrt(separateCues(srt));
      return { cues, edits: cues.map((c) => c.text) };
    }));
  const editedIn = (data) => data.cues.filter((c, i) => data.edits[i] !== c.text).length;

  const video = el('video', { controls: true, playsInline: true, preload: 'metadata', src: item.preview });
  const caption = el('span');
  const cueBox = el('div', { className: 'review-cue', hidden: true }, caption);
  const shade = el('div', { className: 'review-shade' });
  const stage = el('div', { className: 'review-stage' + (vertical ? ' vertical' : '') }, video, shade, cueBox);
  if (item.meta?.width) stage.style.aspectRatio = `${item.meta.width} / ${item.meta.height}`;
  // Burned-in text is sized and placed as a share of the picture's height, like libass does (see media.js).
  const sizer = new ResizeObserver(() => stage.style.setProperty('--h', `${stage.clientHeight}px`));
  sizer.observe(stage);

  const modes = [['burned', 'Burned in'], ['track', 'YouTube track']].map(([value, label]) => {
    const b = el('button', { type: 'button', textContent: label });
    b.addEventListener('click', () => { view = value; applyMode(); });
    b.dataset.mode = value;
    return b;
  });
  const shadeHint = el('p', { className: 'hint', textContent: 'Shaded: covered by Reels and Shorts buttons.' });
  const list = el('div', { className: 'review-lines' });
  const note = el('span', { className: 'hint' });
  const tabs = entries.map((s) => {
    const tab = el('button', { type: 'button', className: 'tab', role: 'tab', textContent: languageName(s.lang) });
    tab.addEventListener('click', () => { current = s.lang; showLanguage(); });
    tab.dataset.lang = s.lang;
    return tab;
  });

  function applyMode() {
    stage.dataset.mode = view;
    for (const b of modes) b.setAttribute('aria-pressed', String(b.dataset.mode === view));
    // Reels and Shorts draw their buttons over the bottom of vertical videos, which matters for burned-in text.
    shade.hidden = shadeHint.hidden = !(view === 'burned' && vertical);
  }

  async function updateNote() {
    let total = 0;
    for (const promise of Object.values(texts)) total += editedIn(await promise.catch(() => ({ cues: [], edits: [] })));
    unsaved = total;
    const own = entries.some((s) => s.source === 'uploaded');
    note.textContent = total
      ? `${plural(total, 'line')} edited. ${own ? "Your own SRT file isn't changed." : "Only the app's copy changes."}`
      : 'Click a line to jump there, and type to fix it.';
  }

  async function showLanguage() {
    for (const tab of tabs) tab.setAttribute('aria-selected', String(tab.dataset.lang === current));
    active = -1;
    list.replaceChildren(el('p', { className: 'hint', textContent: 'Loading the lines…' }));
    let data;
    try {
      data = await load(current);
    } catch (err) {
      list.replaceChildren(el('p', { className: 'hint error', textContent: err.message }));
      return;
    }
    list.replaceChildren(...data.cues.map((c, i) => {
      const time = `${Math.floor(c.start / 60000)}:${((c.start % 60000) / 1000).toFixed(1).padStart(4, '0')}`;
      const input = el('input', { value: data.edits[i], ariaLabel: `Line at ${time}` });
      input.addEventListener('input', () => {
        data.edits[i] = input.value;
        if (i === active) caption.textContent = input.value;
        updateNote();
      });
      // Clicking a line jumps the video there.
      input.addEventListener('focus', () => { video.currentTime = c.start / 1000 + 0.01; });
      return el('div', { className: 'review-line' }, el('span', { className: 't', textContent: time }), input);
    }));
    follow();
  }

  // Highlights the line being spoken, keeps it in view, and shows it on the video.
  async function follow() {
    const data = await texts[current]?.catch(() => null);
    if (!data) return;
    const t = video.currentTime * 1000;
    const at = data.cues.findIndex((c) => t >= c.start && t < c.end);
    caption.textContent = at >= 0 ? data.edits[at] : '';
    cueBox.hidden = at < 0 || !caption.textContent.trim();
    if (at === active) return;
    list.children[active]?.classList.remove('on');
    active = at;
    const row = list.children[at];
    if (row) {
      row.classList.add('on');
      row.scrollIntoView({ block: 'nearest' });
    }
  }
  video.addEventListener('timeupdate', follow);
  video.addEventListener('seeked', follow);

  const download = el('button', { type: 'button', className: 'btn', textContent: 'Download SRT' });
  download.addEventListener('click', async () => {
    const data = await load(current);
    const url = URL.createObjectURL(new Blob([formatSrt(data.cues.map((c, i) => ({ ...c, text: data.edits[i] })))], { type: 'application/x-subrip' }));
    const stem = item.file.name.replace(/\.[^.]+$/, '');
    el('a', { href: url, download: `${stem}.${current}.srt` }).click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  });

  const done = el('button', { type: 'button', className: 'btn primary', textContent: 'Done' });
  done.addEventListener('click', async () => {
    done.disabled = true;
    done.textContent = 'Saving…';
    for (const [l, promise] of Object.entries(texts)) {
      const data = await promise.catch(() => null);
      const edited = data ? editedIn(data) : 0;
      if (edited) await onSave(l, formatSrt(data.cues.map((c, i) => ({ ...c, text: data.edits[i] }))), edited);
    }
    dialog.close();
  });

  // Closing without Done drops the edits, so with unsaved ones it asks first; Keep editing is the default.
  const question = el('p', { id: 'review-discard-question' });
  const keep = el('button', { type: 'button', className: 'btn primary', textContent: 'Keep editing', autofocus: true });
  const discard = el('button', { type: 'button', className: 'btn', textContent: 'Discard' });
  const confirm = el('dialog', { className: 'confirm' }, question, el('div', { className: 'review-actions' }, discard, keep));
  confirm.setAttribute('role', 'alertdialog');
  confirm.setAttribute('aria-labelledby', question.id);
  keep.addEventListener('click', () => confirm.close());
  discard.addEventListener('click', () => { confirm.close(); dialog.close(); });
  function requestClose() {
    if (!unsaved) return dialog.close();
    question.textContent = `Discard ${plural(unsaved, 'edited line')}?`;
    confirm.showModal();
    keep.focus();
  }
  const close = el('button', { type: 'button', className: 'btn icon', ariaLabel: 'Close', textContent: '×' });
  close.addEventListener('click', requestClose);
  // Escape closes a dialog by itself; with unsaved edits it asks instead. (Escape in the question keeps editing.)
  dialog.oncancel = (e) => {
    if (e.target !== dialog || !unsaved) return;
    e.preventDefault();
    requestClose();
  };
  dialog.onclose = () => { sizer.disconnect(); video.pause(); video.removeAttribute('src'); video.load(); };

  const length = item.meta?.duration ? ` · ${formatDuration(item.meta.duration)}` : '';
  dialog.replaceChildren(
    el('div', { className: 'review-head' },
      el('div', {}, el('strong', { textContent: 'Subtitles' }), el('span', { className: 'hint', textContent: `${item.file.name}${length}` })),
      close),
    el('div', { className: 'review-tabs', role: 'tablist', ariaLabel: 'Language' }, ...tabs),
    el('div', { className: 'review-body' },
      el('div', { className: 'review-video' + (vertical ? ' vertical' : '') }, stage,
        el('div', { className: 'seg', role: 'group', ariaLabel: 'Preview as' }, ...modes), shadeHint),
      list),
    el('div', { className: 'review-foot' }, note, el('div', { className: 'review-actions' }, download, done)),
    confirm,
  );
  applyMode();
  updateNote();
  dialog.showModal();
  showLanguage();
}
