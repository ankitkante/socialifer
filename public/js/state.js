// Shared page state. Modules read and change it, then call hooks.update() to re-render.

export function read(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export const KEYS = {
  selected: 'social-post:selected',
  settings: 'social-post:settings',
  tab: 'social-post:tab',
  theme: 'social-post:theme',
};

export const state = {
  platforms: [], // from /api/platforms
  selected: new Set(read(KEYS.selected, [])),
  items: [], // attached files: { key, file, preview, status, progress, id, error, xhr, meta, thumb }
  settings: {}, // per-platform field values, see fields.js
  overrides: {}, // per-platform text for boxes the user has edited; others mirror the main post
  tab: read(KEYS.tab, 'all'),
  posting: false,
  phase: 'ready', // the Post panel: 'ready' (checklist), 'posting' (live rows), 'done' (results)
  lastRows: [], // the last post's per-platform rows
  sectionsKey: '', // which platforms the tabs were built for; '' forces a rebuild
};

// Set by main.js; lets the other modules trigger a re-render without importing it.
export const hooks = {
  update() {},
  edited() {},
  setStatus() {},
  selectTab() {},
};

export const activeTargets = () => state.platforms.filter((p) => p.configured && state.selected.has(p.id));

export function saveSelected() {
  write(KEYS.selected, [...state.selected]);
}
