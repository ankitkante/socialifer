// The laptop's status (from /app/hello), as the web page's status dots show it.

// Platforms that fail without the tunnel, because they fetch media from a public URL (Instagram, Threads).
function needTunnel(platforms) {
  const names = platforms.filter((p) => p.configured && p.media?.needsPublicUrl).map((p) => p.name);
  return names.length ? names.join(' and ') : 'Instagram';
}

// null for a laptop running a server from before the status was sent.
export function tunnelProblem(status) {
  if (!status) return null;
  if (!status.tunnel.configured) return 'tunnel not set up';
  if (status.tunnel.reachable === false) return 'tunnel down';
  return null;
}

// [{ ok, text }], one per status dot; ok is null while it's still being checked.
export function statusLines(status, platforms) {
  if (!status) return [];
  const { tunnel } = status;
  const failing = `${needTunnel(platforms)} posts will fail`;
  return [
    !tunnel.configured ? { ok: false, text: `Tunnel not set up: ${failing}` }
      : tunnel.reachable === null ? { ok: null, text: 'Checking the tunnel…' }
      : tunnel.reachable ? { ok: true, text: 'Tunnel connected' }
      : { ok: false, text: `Tunnel not reachable: ${failing}` },
    status.ffmpeg ? { ok: true, text: 'ffmpeg ready' }
      : { ok: false, text: "ffmpeg not found: videos too big for a platform can't be compressed" },
    status.subtitles ? { ok: true, text: 'Subtitles ready' }
      : { ok: false, text: status.subtitlesProblem ?? 'Subtitles not set up (LYRICS_VIDEO_DIR)' },
  ];
}
