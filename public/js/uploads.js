// Attached files: upload to the server, PNG/WebP to JPEG conversion, thumbnails and the media strip.
import { $, el } from './dom.js';
import { formatDuration } from '/rules.js';
import { state, hooks } from './state.js';

const THUMB_SIZE = 240;
const MAX_IMAGE_SIDE = 4096;
export const CONVERT_TO_JPEG = new Set(['image/png', 'image/webp']);
const ACCEPTED = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/quicktime']);

export const isVideoFile = (file) => file.type.startsWith('video/');

// What the shared rules need to know about each attached file.
export const mediaMeta = () => state.items.map((i) => ({
  name: i.file.name || 'pasted image', type: i.file.type, size: i.file.size, duration: i.meta?.duration,
}));

// SRT uploads count too: a post can't go while one is uploading or after one failed.
const subtitleStates = () => state.items.flatMap((i) => Object.values(i.subs ?? {}).map((s) => s.status));
export const uploadsBusy = () => state.items.some((i) => i.status === 'uploading') || subtitleStates().includes('uploading');
export const uploadsFailed = () => state.items.some((i) => i.status === 'error') || subtitleStates().includes('error');

const isSrt = (file) => /\.srt$/i.test(file.name || '');
const hasSubtitles = (item) => Object.values(item.subs ?? {}).some((s) => s.status === 'done');

// Instagram only takes JPEG and every platform accepts it, so PNG and WebP are converted on the way in.
// Transparent areas become white, and very large images are scaled to 4096px on the longest side.
export async function toJpeg(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = Object.assign(document.createElement('canvas'), {
    width: Math.round(bitmap.width * scale),
    height: Math.round(bitmap.height * scale),
  });
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not convert image'))), 'image/jpeg', 0.92));
  const name = (file.name || 'pasted-image').replace(/\.[^.]+$/, '') + '.jpg';
  return new File([blob], name, { type: 'image/jpeg' });
}

// target: the video whose row an SRT was dropped on, if any (see subtitles.js).
export async function addFiles(files, target = null) {
  hooks.edited();
  // Videos first, so subtitles dropped in the same batch find their video.
  for (let file of [...files].sort((a, b) => isSrt(a) - isSrt(b))) {
    // Browsers often give .srt files no type, so they're recognised by name.
    if (isSrt(file)) { hooks.addSubtitles(file, target); continue; }
    if (!ACCEPTED.has(file.type)) {
      hooks.setStatus(`${file.name || 'That file'} isn't supported. Use JPEG, PNG, GIF, WebP, MP4 or MOV.`, true);
      continue;
    }
    if (CONVERT_TO_JPEG.has(file.type)) {
      try { file = await toJpeg(file); } catch { /* keep the original; platform checks will flag it */ }
    }
    const item = { key: crypto.randomUUID(), file, preview: URL.createObjectURL(file), status: 'uploading', progress: 0 };
    state.items.push(item);
    upload(item);
    makeThumbnail(item);
    renderMedia();
    hooks.update();
  }
}

function upload(item) {
  const xhr = new XMLHttpRequest();
  item.xhr = xhr;
  xhr.open('POST', '/api/media');
  xhr.setRequestHeader('Content-Type', item.file.type);
  xhr.setRequestHeader('X-Filename', encodeURIComponent(item.file.name || 'pasted-image'));
  xhr.upload.onprogress = (e) => {
    if (!e.lengthComputable) return;
    item.progress = e.loaded / e.total;
    const bar = $('media').querySelector(`[data-key="${item.key}"] .progress span`);
    if (bar) bar.style.width = `${item.progress * 100}%`;
  };
  xhr.onload = () => {
    let data = {};
    try { data = JSON.parse(xhr.responseText); } catch {}
    if (xhr.status === 201) Object.assign(item, { status: 'done', id: data.id });
    else Object.assign(item, { status: 'error', error: data.error || `Upload failed (${xhr.status})` });
    renderMedia();
    hooks.update();
  };
  xhr.onerror = () => {
    Object.assign(item, { status: 'error', error: "Upload failed: couldn't reach the server. Is it still running?" });
    renderMedia();
    hooks.update();
  };
  xhr.send(item.file);
}

function once(target, event) {
  return new Promise((resolve, reject) => {
    target.addEventListener(event, resolve, { once: true });
    target.addEventListener('error', () => reject(new Error('Could not read the file')), { once: true });
  });
}

// Renders a small JPEG preview. Browsers often leave a <video> blank until it plays, so for
// videos we seek a little way in and capture that frame; images are downscaled the same way.
async function makeThumbnail(item) {
  const draw = (source, width, height) => {
    const scale = Math.min(1, THUMB_SIZE / Math.min(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85);
  };
  try {
    if (isVideoFile(item.file)) {
      const video = Object.assign(document.createElement('video'), { muted: true, playsInline: true, preload: 'auto', src: item.preview });
      await once(video, 'loadedmetadata');
      // Width 0 means the browser can't decode this codec (e.g. some iPhone HEVC .mov files).
      if (!video.videoWidth) throw new Error('Unsupported codec');
      item.meta = { width: video.videoWidth, height: video.videoHeight, duration: video.duration };
      video.currentTime = Math.min(1, video.duration / 2);
      await once(video, 'seeked');
      item.thumb = draw(video, video.videoWidth, video.videoHeight);
      video.removeAttribute('src');
      video.load();
    } else {
      const bitmap = await createImageBitmap(item.file);
      item.meta = { width: bitmap.width, height: bitmap.height };
      item.thumb = draw(bitmap, bitmap.width, bitmap.height);
      bitmap.close();
    }
  } catch {
    item.thumbFailed = true;
  }
  renderMedia();
  hooks.update();
}

export function removeItem(item) {
  hooks.edited();
  item.xhr?.abort();
  if (item.id) fetch(`/api/media/${item.id}`, { method: 'DELETE' }).catch(() => {});
  URL.revokeObjectURL(item.preview);
  // A video's subtitles go with it.
  hooks.forgetSubtitles(item);
  state.items = state.items.filter((i) => i !== item);
  renderMedia();
  hooks.update();
}

export function clearMedia() {
  for (const item of [...state.items]) {
    item.xhr?.abort();
    if (item.id) fetch(`/api/media/${item.id}`, { method: 'DELETE' }).catch(() => {});
    URL.revokeObjectURL(item.preview);
    hooks.forgetSubtitles(item);
  }
  state.items = [];
  renderMedia();
}

export function renderMedia() {
  const videos = state.items.filter((i) => isVideoFile(i.file));
  $('media').replaceChildren(...state.items.map((item) => {
    const video = isVideoFile(item.file);
    const preview = item.thumb
      ? el('img', { src: item.thumb, alt: item.file.name })
      : item.thumbFailed
        ? el('div', { className: 'placeholder' }, el('strong', { textContent: video ? 'VIDEO' : 'IMAGE' }), item.file.name || 'pasted image')
        : el('div', { className: 'placeholder' });
    const remove = el('button', { className: 'remove', type: 'button', textContent: '×', title: 'Remove', ariaLabel: `Remove ${item.file.name}` });
    remove.addEventListener('click', () => removeItem(item));
    const pending = !item.thumb && !item.thumbFailed;
    const thumb = el('div', {
      className: 'thumb' + (item.status === 'error' ? ' error' : '') + (pending ? ' loading' : ''),
      title: item.file.name,
    }, preview, remove);
    thumb.dataset.key = item.key;
    if (item.status === 'error') thumb.dataset.error = item.error;
    const badge = video ? (item.meta ? `▶ ${formatDuration(item.meta.duration)}` : 'VIDEO') : item.file.type === 'image/gif' ? 'GIF' : '';
    if (badge && !item.thumbFailed) thumb.append(el('span', { className: 'badge', textContent: badge }));
    // With several videos, numbers match the rows under Subtitles; CC marks a video that has subtitles.
    if (video && videos.length > 1) thumb.append(el('span', { className: 'num', textContent: String(videos.indexOf(item) + 1) }));
    if (video && hasSubtitles(item)) thumb.append(el('span', { className: 'cc', textContent: 'CC', title: 'Has subtitles' }));
    if (item.status === 'uploading') {
      const bar = el('span');
      bar.style.width = `${item.progress * 100}%`;
      thumb.append(el('div', { className: 'progress' }, bar));
    }
    return thumb;
  }));
}
