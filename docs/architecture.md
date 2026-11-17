# Architecture

## Overview

```
Browser (public/index.html, styles.css, js/*.js)
  │  GET  /               page (plus /styles.css and /js/<name>.js)
  │  GET  /rules.js       shared validation module
  │  GET  /api/status     ffmpeg available? tunnel reachable?
  │  GET  /api/platforms  platform list, limits, media rules, configured?
  │  POST /api/media      raw file body → { id, name, type, size }
  │  DELETE /api/media/:id
  │  POST /api/subtitled  { video, subtitles, maxBytes? } → NDJSON progress, then the burned-in copy's id
  │  POST /api/subtitles  { video, language, subtitles: [lang] } → NDJSON job snapshots (transcribe)
  │  POST /api/subtitles/<id>/stop
  │  POST /api/post       { text, platforms: [id], media: [mediaId], options, subtitles?: { videoId: { lang: srtId } } }
  ▼
server.js ──► publish(): Promise.allSettled over selected platforms
                 │  for each: isConfigured? → problemsFor()? → platform.post(text, media, options[id])
                 ▼
            platforms/<name>.js ──► platform APIs (fetch)
                 ▲
Platform fetchers (Threads, Instagram) ── GET /media/<id>.<ext> ── via TUNNEL_URL tunnel
```

Each platform posts independently and in parallel, inside its own logging context (`log.js`), so one platform failing never blocks the others and every log line says which post and platform it belongs to. The response is streamed as one JSON event per line: live `status` events with each platform's current step (and a 0 to 1 `progress` when the step reports one), a `result` event per platform as soon as it finishes (`{ id, name, ok, url, warnings, error }`), and a final `done` event.

## Posting flow

1. The page loads `/api/platforms` and renders a pill per configured platform (the others are listed under **Set up more**). It keeps the selection, the open tab and the theme in `localStorage` (`social-post:selected`, `social-post:tab`, `social-post:theme`).
2. On every keystroke or media change, the page runs `countFor` and `problemsFor` from `public/rules.js` for each platform. It shows the problems as tab badges, under the field they concern and in the Post panel's checklist, updates the previews, and disables Post while any *selected* platform has a problem, while a file is uploading, or while a file failed to upload.
3. `POST /api/post` trims the text, resolves media ids to files, and re-runs `problemsFor` for each platform on the server.
4. `platform.post()` uploads media, waits for processing where the API needs it (`poll()` in `platforms/http.js`, 10-minute default timeout), then creates the post.
5. If every platform succeeds, the page clears the text and deletes the uploads. If some fail, it keeps the post and narrows the selection to the failed platforms so the user can retry just those.

The server's request timeout only covers receiving the request, so a slow video post can run for minutes without being cut off. The browser's `fetch` has no timeout.

## Media lifecycle

- **Upload:** the browser sends `POST /api/media` with the raw file as the body (`XMLHttpRequest`, for progress events), `Content-Type` set to the file's MIME type, and `X-Filename` URI-encoded. `media.js` streams it to `uploads/<id>` through a size-limiting transform (`MAX_UPLOAD_MB`, default 1024), then writes `uploads/<id>.json` metadata. Allowed types are listed in `EXTENSIONS` in `media.js`: JPEG, PNG, GIF, WebP, MP4, MOV and SRT subtitles (`application/x-subrip`).
- **Use:** `getMedia(id)` returns metadata plus `path`, `blob()` (file-backed, via `fs.openAsBlob`, so large videos aren't loaded into memory), `buffer()`, and `url`.
- **Length:** the browser reads each video's duration when it is attached and sends it with the post as `media: [{ id, duration }]`. If ffprobe is installed, the server reads the real duration and uses that instead.
- **Compression:** after a platform passes `problemsFor`, `mediaFor()` in `server.js` swaps any video over that platform's `videoMB` for `fitVideo(m, maxBytes)`. That runs ffmpeg once per original and target size (concurrent platforms with the same limit share the run), writes the copy as a new upload with `derivedFrom` in its metadata, and retries once at 85% if the first pass overshoots. Copies are deleted with their original or by the 24-hour cleanup. The UI shows these as notes (`adjustmentsFor`), not problems.
- **Public serving:** `GET/HEAD /media/<id>.<ext>` streams the file with Range support. The extension is cosmetic; some fetchers expect one. `/media/health` answers 204, so `/api/status` can check that the tunnel reaches this server.
- **Subtitles:** `subtitler.js` runs transcribe's `subtitles.py` (contract: transcribe's AGENTS.md) with `--out-dir uploads/transcripts/<sha256 of the video>/`. Each SRT it writes is saved as a new upload (`saveFile` in `media.js`) and removed from that folder; the transcripts stay for 24 hours after their last use. Edits from Review lines are uploaded by the page as another SRT. Burned-in copies (`burnSubtitles`) are cached per video, SRT and size target. Whisper runs and burn-ins take turns (`work.js`), Whisper first.
- **Deletion:** the browser deletes files on removal or after a fully successful post. Anything older than 24 hours is removed when the server starts and every hour after.

## Security model

There's one user on one machine, and there's no login, so the protection comes from where requests are allowed to come from:

- The server binds to `127.0.0.1`.
- **Host allowlist:** everything except `/media/*` requires `Host` to be `localhost:PORT` or `127.0.0.1:PORT`. This defeats DNS rebinding.
- **Tunnel detection:** requests carrying `X-Forwarded-For` or `Forwarded` are rejected outside `/media/*`. This matters because some tunnels rewrite `Host` to `localhost`.
- **CSRF:** the write endpoints require non-simple content types (`application/json`, `image/*`, `video/*`, `application/x-subrip`) and the server sends no CORS headers, so cross-origin pages can't trigger them.
- **Public media:** files under `/media/` are reachable by anyone who knows the 128-bit random id, but only while `TUNNEL_URL`'s tunnel is running and for at most 24 hours.
- Credentials stay in `.env` (gitignored) and are only read on the server.

## Shared rules (`public/rules.js`)

This file is imported by both the server (`import ... from './public/rules.js'`) and the browser (`/rules.js`), so it must stay environment-neutral: no Node or DOM APIs beyond `Intl.Segmenter`.

- `countFor(id, text)` counts grapheme clusters, so an emoji counts as 1. On X and Mastodon every `http(s)://` URL counts as 23 characters.
- `problemsFor(platform, text, media)` returns human-readable problems: text length, missing required media, too many images, videos or files, mixing images and videos, a missing public URL, image type, and file size. `platform` is the `/api/platforms` shape: `{ id, limit, media, publicUrlReady }`.
- Sizes use decimal MB (1 MB = 1,000,000 bytes), as the platforms state their limits.
