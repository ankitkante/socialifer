// What the web page's status dots and the phone app's Laptop screen show.
import { publicBaseUrl } from './media.js';
import { canCompress } from './publish.js';
import { checkGenerator } from './subtitler.js';

// Whether the tunnel actually reaches this server: fetch our own health file through it.
// Cached briefly, since the page asks every minute and the phone every 5 seconds.
// reachable is null until the first check finishes.
let tunnelCheck = { at: 0, reachable: null, running: null };
async function tunnelReachable(wait) {
  const base = publicBaseUrl();
  if (!base) return false;
  if (Date.now() - tunnelCheck.at >= 20_000 && !tunnelCheck.running) {
    tunnelCheck.running = (async () => {
      let reachable = false;
      try {
        const res = await fetch(`${base}/media/health`, { signal: AbortSignal.timeout(5000) });
        reachable = res.status === 204;
      } catch {}
      tunnelCheck = { at: Date.now(), reachable, running: null };
    })();
  }
  if (wait && tunnelCheck.running) await tunnelCheck.running;
  return tunnelCheck.reachable;
}

// wait: false answers at once with the last tunnel check (the phone gives up on a call after 5 seconds,
// as long as a hanging tunnel check can take).
export async function laptopStatus({ wait = true } = {}) {
  const { tool, problem } = await checkGenerator();
  return {
    ffmpeg: canCompress,
    // subtitlesProblem: what to fix when TRANSCRIBE_DIR is set but unusable; null when it's fine or not set.
    subtitles: Boolean(tool),
    subtitlesProblem: problem ?? null,
    tunnel: { configured: Boolean(publicBaseUrl()), reachable: await tunnelReachable(wait) },
  };
}
