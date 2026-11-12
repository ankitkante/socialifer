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
  subtitles: 'social-post:subtitles', // { spoken, own, english, choices: { x: 'en' | 'hi' | 'none', ... } }
};

export const state = {
  platforms: [], // from /api/platforms
  selected: new Set(read(KEYS.selected, [])),
  // attached files: { key, file, preview, status, progress, id, error, xhr, meta, thumb }; videos also get
  // subs: { [lang]: { lang, name, source: 'generated' | 'uploaded', status, id, lines, edited } } and job (see subtitles.js)
  items: [],
  generator: false, // whether the server can make subtitles (lyrics-video), from /api/status
  generatorProblem: null, // what to fix when LYRICS_VIDEO_DIR is set but unusable
  burns: new Map(), // `${videoId}:${srtId}` -> a copy with subtitles burned in: { status, progress, id, error }
  tracksOff: new Set(), // YouTube subtitle languages unticked for this post
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
  addSubtitles() {}, // (file, item?) an SRT dropped or picked; item is the video's row it was dropped on
  forgetSubtitles() {}, // (item) a video is being removed: stop its job and delete its SRT uploads
};

export const activeTargets = () => state.platforms.filter((p) => p.configured && state.selected.has(p.id));

export function saveSelected() {
  write(KEYS.selected, [...state.selected]);
}
