// The header: the theme toggle and the tunnel and ffmpeg status dots.
import { $, el } from './dom.js';
import { state, hooks, read, write, KEYS } from './state.js';

// 'system' follows the operating system; 'light' and 'dark' override it (see styles.css).
export function initTheme() {
  const apply = (theme) => {
    if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
    for (const button of $('theme-toggle').querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(button.dataset.theme === theme));
    }
  };
  apply(read(KEYS.theme, 'system'));
  $('theme-toggle').addEventListener('click', (e) => {
    const theme = e.target.closest('button')?.dataset.theme;
    if (!theme) return;
    write(KEYS.theme, theme);
    apply(theme);
  });
}

function dot(kind, label, tip) {
  return el('span', { className: `status-dot ${kind}`, textContent: label, title: tip });
}

// needsTunnel: whether any set-up platform downloads media through the tunnel (Instagram, Threads).
async function refresh(needsTunnel) {
  let status;
  try {
    status = await (await fetch('/api/status')).json();
  } catch {
    $('topbar-status').replaceChildren(dot('warn', 'Server not reachable', 'Is the Socialifer server still running? Start it with npm start.'));
    return;
  }
  const dots = [];
  if (needsTunnel || status.tunnel.configured) {
    const { configured, reachable } = status.tunnel;
    dots.push(!configured
      ? dot('', 'No tunnel', 'TUNNEL_URL isn\'t set, so Instagram and Threads can\'t download images and videos. See the README.')
      : reachable
        ? dot('ok', 'Tunnel connected', 'Instagram and Threads can download your media through TUNNEL_URL.')
        : dot('warn', 'Tunnel not reachable', 'TUNNEL_URL is set but doesn\'t reach this server. Is cloudflared running, and does TUNNEL_URL match its address?'));
  }
  dots.push(status.ffmpeg
    ? dot('ok', 'ffmpeg ready', 'Videos too big for a platform are compressed to fit, and subtitles can be burned in.')
    : dot('', 'No ffmpeg', 'Videos too big for a platform are rejected for it, and subtitles can\'t be burned in. Install ffmpeg (see README).'));
  dots.push(status.subtitles
    ? dot('ok', 'Subtitles ready', 'Generate makes subtitles on this PC with the transcribe project (Whisper).')
    : status.subtitlesProblem
      ? dot('warn', 'Subtitles not set up', status.subtitlesProblem)
      : dot('', 'No subtitle generator', 'To generate subtitles, set up transcribe and set TRANSCRIBE_DIR in .env (see "Generating subtitles" in the README). Uploading an SRT works without it.'));
  $('topbar-status').replaceChildren(...dots);
  // Generate only shows when the server can run it; when it's set up wrongly, the strip says why.
  const problem = status.subtitlesProblem ?? null;
  if (state.generator !== Boolean(status.subtitles) || state.generatorProblem !== problem) {
    state.generator = Boolean(status.subtitles);
    state.generatorProblem = problem;
    hooks.update();
  }
}

export function startStatus(needsTunnel) {
  refresh(needsTunnel);
  setInterval(() => refresh(needsTunnel), 60_000);
}
