# AGENTS.md

Guidance for coding agents (and humans) working on this repo. Read this first, then [docs/architecture.md](docs/architecture.md) and [docs/platforms.md](docs/platforms.md) as needed.

## What this is

A local, single-user web app: one page where you write a post, attach images or videos, and publish to several social platforms at once. The server is plain Node.js and runs on `127.0.0.1`. Credentials come from `.env`.

## Commands

```sh
npm start     # node --env-file-if-exists=.env server.js  -> http://localhost:3000
npm run dev   # same, restarting on file changes
npm test      # node --test; offline, no credentials needed
npm run youtube-auth   # one-time Google sign-in; writes YOUTUBE_REFRESH_TOKEN into .env
```

Requires Node 22.9+ (`--env-file-if-exists`, `fs.openAsBlob`, global `fetch`/`FormData`/`Blob`).

## Layout

| Path | Role |
|---|---|
| `server.js` | HTTP server: routing, host/forwarding guard, `/api/*` endpoints, fan-out to platforms |
| `media.js` | Upload storage in `uploads/`, public `/media/*` serving (with Range), 24h cleanup |
| `public/index.html` | The page's markup only (no build step) |
| `public/styles.css` | All styles; light and dark tokens on `:root`, `data-theme` on `<html>` overrides the system theme |
| `public/js/` | The page's ES modules: `main.js` (picker, tabs, per-platform sections, field errors, wiring), `fields.js` (`FIELDS`, saved settings, controls), `uploads.js` (attachments, JPEG conversion, thumbnails), `previews.js` (YouTube/Instagram/X preview cards), `panel.js` (Post panel, posting and its NDJSON stream), `status.js` (theme toggle, status dots), `state.js` (shared state and `hooks`), `dom.js` (helpers). Served by name from `/js/<name>.js` only |
| `public/icons/` | Platform logos from Simple Icons (CC0), one `<id>.svg` per platform. LinkedIn comes from v10.0.0, because later versions removed it at LinkedIn's request |
| `public/rules.js` | **Shared by browser and server**: character counting and per-platform validation |
| `platforms/*.js` | One module per platform; `index.js` lists them in display order |
| `platforms/http.js` | `request()` (fetch + error extraction + timeout), `poll()`, `env()` helpers |
| `scripts/youtube-auth.js` | Standalone OAuth loopback + PKCE flow for YouTube |
| `test/` | `node:test` suites |
| `.env.example` | Every supported setting, with where to get each credential |

## Conventions

- **No dependencies.** Use Node built-ins only. Don't add npm packages without asking the user.
- ES modules, 2-space indent, single quotes, semicolons. Comments explain *why* (API quirks, limits), not what.
- Platform API quirks live in the platform module, next to the code they affect, with a short comment.
- Error messages are shown to the user verbatim, so write them as plain sentences that say what to do.

### Errors, logging and progress

- **Throw `ApiError`** (from `platforms/http.js`) for expected failures: API errors, network problems, our own checks. The server shows its message to the user, prefixed with the current step. **Any other error is treated as a bug**: the user sees "Something went wrong in the app…" and the stack trace goes to the terminal.
- **`request()`** turns network failures into readable messages ("The connection to api.x.com was dropped (ECONNRESET)" instead of "fetch failed"), logs each failed request with the platform's full response, and hides tokens (`redactUrl`). Pass `retries` only for requests that are safe to repeat (status polls, re-sending an upload chunk); `headers` can be a function when every attempt needs a fresh signature (X's OAuth).
- **Call `step('Uploading the video')`** (from `log.js`) when a platform starts something slow or failure-prone. It's logged as `[post 7] YouTube: …`, streamed to the page as live status, and names the step in the error if it fails. Use `{ quiet: true }` for very frequent steps, such as each upload part, and `{ progress }` (0 to 1) when the step knows how far along it is; the page shows it as a progress bar (X's upload parts, ffmpeg compression).
- **`POST /api/post` streams NDJSON**: `{ type: 'status', id, step, progress? }`, `{ type: 'result', … }` per platform as it finishes, then `{ type: 'done', results }`. Errors before posting starts are a normal JSON error response. If the stream breaks, the page marks unfinished platforms as "unknown" and warns against retrying blindly.

`GET /api/status` returns `{ ffmpeg, tunnel: { configured, reachable } }` for the header's status dots. Reachability is checked by fetching `TUNNEL_URL/media/health` (answered with 204 by `serveMedia`), cached for 20 seconds.

## Platform module contract

```js
export default {
  id: 'example',              // stable; used in localStorage and API calls
  name: 'Example',            // shown in the UI
  limit: 500,                 // max characters (counted by countFor in public/rules.js)
  media: {                    // read by problemsFor in public/rules.js
    maxImages, maxVideos, maxItems, mix,     // counts; mix = images and videos together
    imageMB, videoMB,                        // decimal MB, null = unchecked
    videoMinSeconds?, videoMaxSeconds?,      // length limits; omit when unsure rather than guess
    carouselVideoMaxSeconds?,                // stricter length in multi-file posts (Instagram)
    videoMaxSecondsHint?,                    // appended to the "too long" message, e.g. how to raise it
    imageTypes?, imageTypesLabel?,           // restrict image MIME types
    requiresMedia?, needsPublicUrl?,         // e.g. Instagram
  },
  title?: { max: 100 },       // platform needs a title (YouTube); see resolveTitle in rules.js
  textForbids?: '<>',         // characters the platform rejects in title/text
  threads?: true,             // long text may be split into a numbered thread (X); see splitThread in rules.js
  mediaOptions?: ['thumbnail'], // option fields holding an uploaded image id; the server swaps in the file
  envVars: ['EXAMPLE_TOKEN'], // required settings; shown when unconfigured
  isConfigured: () => hasEnv(...),
  async post(text, media, options) { return { url, warnings? } }, // url may be null; throw Error on failure.
                              // warnings: things that failed after the post went live (thumbnail, first comment)
};
```

`options` holds per-platform extras that the UI sends as `options[platformId]` in `POST /api/post`, and it's passed both to `problemsFor` and to `post()`:
- `options[id].text`: the platform's own text, present only if the user edited that platform's box in its tab (an empty string means no text). Unedited boxes just mirror the main post and send nothing. The server resolves it with `effectiveText()` and passes the result to `post()` as `text`, so platform modules never need to look at it. `problemsFor` takes the *main* text plus `options` and resolves it the same way.
- **Platform fields** (YouTube's title, tags, schedule and thumbnail; Instagram's Story, cover, collaborators and first comment; X's thread, poll and reply settings) are declared in `FIELDS` in `public/js/fields.js`. Each entry has a `key`, `type` (text, textarea, select, check, number, date, datetime-local, image, poll), a `label`, and optionally `sticky` (remembered between posts), `when` (hidden and *not sent* when it doesn't apply), `initial` and `hint`. Values reach the server as `options[platformId][key]` and are checked by `FIELD_CHECKS` in `public/rules.js`. To add a field: add it to `FIELDS`, add any check to `FIELD_CHECKS`, and read it in the platform's `post()`.

`media` items passed to `post()` are `{ id, name, type, size, duration, path, url, blob(), buffer() }`. `url` is the public URL (only set when `TUNNEL_URL` is configured). `duration` is in seconds, from ffprobe if installed, else from the browser, else `null`. A video over the platform's `videoMB` has already been swapped for a compressed copy (see `fitVideo` in `media.js`) when ffmpeg is available, so modules don't handle compression. Upload media in order and sequentially. To add a platform, create the module, register it in `platforms/index.js`, add its settings to `.env.example`, and add a row to `docs/platforms.md` and the README table.

## Invariants: don't break these

1. **Local only.** The server binds to `127.0.0.1`. Everything except `GET/HEAD /media/*` must reject requests whose `Host` isn't `localhost:PORT`/`127.0.0.1:PORT` **or** that carry `X-Forwarded-For`/`Forwarded` (that's how a tunnel is detected). This blocks DNS rebinding and stops `TUNNEL_URL` tunnels from exposing the posting API.
2. **No simple cross-site requests.** `POST /api/post` requires `application/json` and `POST /api/media` requires an `image/*`/`video/*` type, so browsers must preflight and other websites can't post on the user's behalf. There are deliberately no CORS headers.
3. **Media ids are 128-bit random hex** and validated with `/^[a-f0-9]{32}$/` before touching the filesystem.
4. **Server re-validates everything** the UI checks (`problemsFor`); the UI is a convenience, not the gate.
5. **Secrets never reach the browser.** `/api/platforms` returns only names of env vars, never values.

## Testing

`npm test` covers the shared rules (lengths, compression notes, per-platform text), X's OAuth 1.0a signature (against X's published example), Bluesky facet byte ranges, LinkedIn escaping, and the server's endpoints and guards (it starts the server on a random port). `test/compress.test.js` generates a video and compresses it with the real ffmpeg; it's skipped when ffmpeg isn't installed. Platform `post()` flows can be traced offline by replacing `globalThis.fetch` with a stub that logs calls, which is how they were checked during development.

**Nothing has been tested against live platform APIs yet** (as of 2026-11-04). See the "Verification status" section of [docs/platforms.md](docs/platforms.md) before assuming a platform works, and update it when someone confirms one live.

## Decisions on record

- **Substack: not supported.** It has no official posting API. An unofficial route exists (session cookie + internal `/api/v1/comment/feed` for Notes), but it may break without notice and may violate their terms. The user chose to skip it unless an official way appears.
- **Instagram and Threads media need `TUNNEL_URL`**, because Meta fetches media from a URL. Instagram's resumable upload (direct video upload) is only available to Facebook Login for Business apps, and images still need a URL, so the tunnel approach was chosen for both.
- **Alt text on X and Instagram only.** Bluesky, Mastodon and LinkedIn also support it; adding it there is a possible follow-up.
- **Ideas for later** (Instagram carousel from text, scheduling in the app, a logo, drafts and history) are listed in the README's "Ideas for later" section. Discuss them with the user before building any of them.
- **ffmpeg is optional**, not a dependency. It is found on PATH, in `FFMPEG_DIR`, or in winget's Links folder (`%LOCALAPPDATA%\Microsoft\WinGet\Links`), because VS Code terminals opened before an install don't see the new PATH. Without it, oversized videos are rejected per platform as before.
- **Videos are compressed, never trimmed.** A video that is too long for a platform is a problem the user must fix; only size is adjusted automatically. Compression targets the platform's `videoMB` with H.264/AAC, scaling so the shorter side is at most 1080 px (`SCALE` in `media.js`), and refusing to go below 400 kbps video (`compressionBitrate` in `public/rules.js`).
- **YouTube uploads start private** until the user's Google Cloud project passes YouTube's API audit. This can't be worked around in code; the UI and README say so. Shorts are not a separate upload type.
- **X limit defaults to 280**; `X_CHAR_LIMIT` exists for Premium accounts (up to 25,000).
