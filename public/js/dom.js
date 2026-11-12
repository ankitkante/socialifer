// Small DOM helpers shared by the page's modules.

export const $ = (id) => document.getElementById(id);

export function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

// Brand colours for the logos. X and Threads are black, so they follow the text colour instead.
export const BRAND_COLORS = {
  youtube: '#FF0000', instagram: '#E4405F', linkedin: '#0A66C2', discord: '#5865F2',
  facebook: '#0866FF', bluesky: '#0285FF', mastodon: '#6364FF', telegram: '#26A5E4',
};

export function logo(id) {
  const span = el('span', { className: 'logo', ariaHidden: 'true' });
  span.style.setProperty('--icon', `url(/icons/${id}.svg)`);
  if (BRAND_COLORS[id]) span.style.setProperty('--brand', BRAND_COLORS[id]);
  return span;
}

const segmenter = new Intl.Segmenter();

// Shortens text to n characters (as people count them, so emoji stay whole).
export function truncate(text, n) {
  const parts = [...segmenter.segment(text)].map((s) => s.segment);
  return parts.length <= n ? { text, cut: false } : { text: parts.slice(0, n).join('').trimEnd(), cut: true };
}

// Reads a server stream of JSON events, one object per line (posting, burning in, making subtitles).
export async function readEvents(res, onEvent) {
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

// A plain message from a JSON error response, for requests that answer with a stream when they work.
export async function errorOf(res) {
  const data = await res.json().catch(() => ({}));
  return new Error(data.error || `The server returned an error (HTTP ${res.status}). Check the terminal.`);
}
