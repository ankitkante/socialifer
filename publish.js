// What the web page and the phone app are told about each platform.
import { publicBaseUrl, videoTools } from './media.js';

// With ffmpeg installed, videos too big for a platform are compressed instead of rejected.
export const canCompress = Boolean(await videoTools());

export function describe(p) {
  return {
    id: p.id,
    name: p.name,
    limit: p.limit,
    media: p.media,
    title: p.title ?? null,
    textForbids: p.textForbids ?? '',
    threads: Boolean(p.threads),
    subtitleTracks: Boolean(p.subtitleTracks),
    envVars: p.envVars,
    configured: p.isConfigured(),
    publicUrlReady: Boolean(publicBaseUrl()),
    canCompress,
  };
}
