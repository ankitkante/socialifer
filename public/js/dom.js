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
