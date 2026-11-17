# AGENTS.md

Guidance for coding agents (and humans) working on this repo. Read this first, then the file under "More docs" that matches the task.

## What this is

A local, single-user web app: one page where you write a post, attach images or videos, and publish to several social platforms at once. The server is plain Node.js and runs on `127.0.0.1`. Credentials come from `.env`.

## Commands

```sh
npm start     # node --env-file-if-exists=.env server.js  -> http://localhost:3000
npm run dev   # same, restarting on file changes
npm test      # node --test; offline, no credentials needed
npm run youtube-auth   # one-time Google sign-in; writes YOUTUBE_REFRESH_TOKEN into .env
npm run tunnel         # cloudflared quick tunnel; writes its new address to TUNNEL_URL in .env (restart the server after)
npm run sp-mobile-app  # Expo's dev server for the phone app in mobile/ (open it in Expo Go)
npm run sp-mobile-apk  # builds an installable APK of the phone app on Expo's servers (EAS; needs an Expo login)
```

Requires Node 22.9+ (`--env-file-if-exists`, `fs.openAsBlob`, global `fetch`/`FormData`/`Blob`).

## Layout

| Path | Role |
|---|---|
| `server.js` | HTTP server: routing, host/forwarding guard, `/api/*` endpoints, fan-out to platforms |
| `publish.js` | `publish()`: posting to the selected platforms (checks, compression, burn-ins, results), used by `/api/post` and the phone queue; also `describe`, `canCompress`, `failureMessage` |
| `phone.js` | The phone app's server on `PHONE_PORT` (Wi-Fi): signature check, pairing key in `phone/pairing.json`, the pairing QR code, `/app/*` endpoints |
| `queue.js` | Phone posts on the laptop: `queue/<id>/` (`post.json` and files by index), checked on arrival, posted one at a time through `publish()`, kept until the phone collects the results (7 days at most) |
| `mobile/` | The phone app (Expo, Android). `App.js` (screens, the 5-second laptop check); `src/Posts.js` (the list), `src/Compose.js` (writing, checks from `rules.js`), `src/Fields.js` (a card per platform: count, problems, own text, `FIELDS` controls), `src/Preview.js` (YouTube/Instagram/X previews, following `public/js/previews.js`), `src/Finished.js` (results, Send again), `src/Substack.js` ("Finish by hand": the Substack reminder, platforms' items, the dialog after Post), `src/options.js` (defaults, sticky values, what's checked and sent), `src/store.js` (posts in the app's document folder, media copies, cached platforms), `src/handover.js` (sending ready posts, collecting results), `src/laptop.js` (pairing, signed calls and uploads), `src/log.js` (the activity log, sent to the laptop), `src/status.js` (the laptop's status lines and the tunnel warning), `src/sign.js` (must match `signature()` in `phone.js`), `src/Logo.js` (platform logos from `public/icons`, and `BrandMark`), `src/ui.js` (colours, `Button`, and the `Text`/`TextInput` every screen imports instead of React Native's, which set Inter by weight). Inter's four weights are in `assets/fonts`. `metro.config.js` lets it import `public/`, and `svg-transformer.js` makes an imported `.svg` its text. `eas.json` and `plugins/allow-http.js` are for the APK build. Follow `mobile/AGENTS.md` (Expo's own guidance) there |
| `media.js` | Upload storage in `uploads/`, public `/media/*` serving (with Range), 24h cleanup, and ffmpeg copies: compressed (`fitVideo`) and with burned-in subtitles (`burnSubtitles`) |
| `public/index.html` | The page's markup only (no build step) |
| `public/styles.css` | All styles; light and dark tokens on `:root`, `data-theme` on `<html>` overrides the system theme |
| `public/fonts/` | Inter and Noto Sans Devanagari (variable woff2, SIL Open Font License), bundled so every PC shows the brand fonts; served by name from `STATIC_FILES` |
| `subtitler.js` | Generating subtitles: runs transcribe's `subtitles.py` (`TRANSCRIBE_DIR`), turns each SRT it writes into an upload, keeps transcripts by video content, and stops a run left by a dead server |
| `work.js` | One heavy job at a time (Whisper, then subtitle burn-ins) |
| `status.js` | `laptopStatus()`: ffmpeg, subtitles and tunnel, for `/api/status` and the phone's `/app/hello` |
| `public/js/` | The page's ES modules: `main.js` (picker, tabs, per-platform sections, field errors, wiring), `fields.js` (saved settings and controls; the lists are in `public/fields.js`), `uploads.js` (attachments, JPEG conversion, thumbnails), `subtitles.js` (the Subtitles strip, generating, SRT uploads, burned-in copies, each platform's subtitles choice), `review.js` (the Review lines dialog), `previews.js` (YouTube/Instagram/X preview cards), `panel.js` (Post panel, posting and its NDJSON stream), `status.js` (theme toggle, status dots), `state.js` (shared state and `hooks`), `dom.js` (helpers, NDJSON reader). Served by name from `/js/<name>.js` only |
| `public/icons/` | Platform logos from Simple Icons (CC0), one `<id>.svg` per platform. LinkedIn comes from v10.0.0, because later versions removed it at LinkedIn's request |
| `public/rules.js` | **Shared by browser, server and phone app**: character counting and per-platform validation |
| `public/fields.js` | **Shared by browser and phone app**: `FIELDS` (each platform's extra fields), `fieldsOf`, `initialOf`. Plain data, no page code; served at `/fields.js` |
| `platforms/*.js` | One module per platform; `index.js` lists them in display order |
| `platforms/http.js` | `request()` (fetch + error extraction + timeout), `poll()`, `env()` helpers |
| `scripts/youtube-auth.js` | Standalone OAuth loopback + PKCE flow for YouTube |
| `scripts/tunnel.js` | Runs `cloudflared tunnel --url`, finds the `trycloudflare.com` address in its log and saves it as `TUNNEL_URL` |
| `brand/` | The Socialifer brand: logo SVGs, app icons, favicons, PNG exports in `png/`, and colours, fonts and voice in its README. The web page serves its favicons from here (`/favicon.ico`, `/favicon.svg`); its header mark is inline in `index.html`, the app's is `BrandMark` in `mobile/src/Logo.js`, and the app's icons in `mobile/assets` are copies of `png/` files |
| `website/` | socialifer.com: home, privacy policy, terms, 404, SEO files. Plain HTML for Cloudflare Pages; see [docs/website.md](docs/website.md). The privacy policy must match what the app does |
| `test/` | `node:test` suites |
| `.env.example` | Every supported setting, with where to get each credential |

## Conventions

- **No dependencies.** Use Node built-ins only. Don't add npm packages without asking the user. The one exception is `qrcode` (the pairing code). The phone app in `mobile/` has its own packages; ask before adding any.
- ES modules, 2-space indent, single quotes, semicolons. Comments explain *why* (API quirks, limits), not what.
- Platform API quirks live in the platform module, next to the code they affect, with a short comment.
- Error messages are shown to the user verbatim, so write them as plain sentences that say what to do.

### Errors, logging and progress

- **Throw `ApiError`** (from `platforms/http.js`) for expected failures: API errors, network problems, our own checks. The server shows its message to the user, prefixed with the current step. **Any other error is treated as a bug**: the user sees "Something went wrong in the app…" and the stack trace goes to the terminal.
- **`request()`** turns network failures into readable messages ("The connection to api.x.com was dropped (ECONNRESET)" instead of "fetch failed"), logs each failed request with the platform's full response, and hides tokens (`redactUrl`). Pass `retries` only for requests that are safe to repeat (status polls, re-sending an upload chunk); `headers` can be a function when every attempt needs a fresh signature (X's OAuth).
- **Call `step('Uploading the video')`** (from `log.js`) when a platform starts something slow or failure-prone. It's logged as `[post 7] YouTube: …`, streamed to the page as live status, and names the step in the error if it fails. Use `{ quiet: true }` for very frequent steps, such as each upload part, and `{ progress }` (0 to 1) when the step knows how far along it is; the page shows it as a progress bar (X's upload parts, ffmpeg compression).
- **`POST /api/post` streams NDJSON**: `{ type: 'status', id, step, progress? }`, `{ type: 'result', … }` per platform as it finishes, then `{ type: 'done', results }`. Errors before posting starts are a normal JSON error response. If the stream breaks, the page marks unfinished platforms as "unknown" and warns against retrying blindly.

`GET /api/status` returns `{ ffmpeg, subtitles, subtitlesProblem, tunnel: { configured, reachable } }` for the header's status dots; `subtitles` says whether `TRANSCRIBE_DIR` points at a usable transcribe folder (its `.venv` Python and `subtitles.py`), and the page shows Generate only then. `subtitlesProblem` (from `checkGenerator` in `subtitler.js`) says what to fix when it's set but unusable; the header, the strip and the startup message show it. Reachability is checked by fetching `TUNNEL_URL/media/health` (answered with 204 by `serveMedia`), cached for 20 seconds. The phone's `/app/hello` carries the same object as `status`, without waiting for a tunnel check (the phone gives up on a call after 5 seconds); the app shows it on the Laptop screen and turns the Posts screen's "Connected" line amber when the tunnel is down or not set up.

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
  subtitleTracks?: true,      // takes SRT files as options.subtitles, [{ lang, file }] (YouTube); other platforms get one language burned in
  mediaOptions?: ['thumbnail'], // option fields holding an uploaded image id; the server swaps in the file
  envVars: ['EXAMPLE_TOKEN'], // required settings; shown when unconfigured
  isConfigured: () => hasEnv(...),
  async post(text, media, options) { return { url, warnings?, todo? } }, // url may be null; throw Error on failure.
                              // warnings: things that failed after the post went live (thumbnail, first comment)
                              // todo: { text, label, url }, a step left to do by hand, shown in "Finish by hand"
};
```

`options` holds per-platform extras that the UI sends as `options[platformId]` in `POST /api/post`, and it's passed both to `problemsFor` and to `post()`:
- `options[id].text`: the platform's own text, present only if the user edited that platform's box in its tab (an empty string means no text). Unedited boxes just mirror the main post and send nothing. The server resolves it with `effectiveText()` and passes the result to `post()` as `text`, so platform modules never need to look at it. `problemsFor` takes the *main* text plus `options` and resolves it the same way.
- **Platform fields** (YouTube's title, tags, schedule and thumbnail; Instagram's Story, cover, collaborators and first comment; X's thread, poll and reply settings) are declared in `FIELDS` in `public/fields.js` (the web page and the phone app both draw them). Each entry has a `key`, `type` (text, textarea, select, check, number, date, datetime-local, image, poll), a `label`, and optionally `sticky` (remembered between posts), `when` (hidden and *not sent* when it doesn't apply), `initial` and `hint`. Values reach the server as `options[platformId][key]` and are checked by `FIELD_CHECKS` in `public/rules.js`. To add a field: add it to `FIELDS`, add any check to `FIELD_CHECKS`, and read it in the platform's `post()`.

`media` items passed to `post()` are `{ id, name, type, size, duration, path, url, blob(), buffer() }`. `url` is the public URL (only set when `TUNNEL_URL` is configured). `duration` is in seconds, from ffprobe if installed, else from the browser, else `null`. A video over the platform's `videoMB` has already been swapped for a compressed copy (see `fitVideo` in `media.js`) when ffmpeg is available, so modules don't handle compression. Upload media in order and sequentially. To add a platform, create the module, register it in `platforms/index.js`, add its settings to `.env.example`, and add a row to `docs/platforms.md` and the README table.

## Invariants: don't break these

1. **Local only.** The server binds to `127.0.0.1`. Everything except `GET/HEAD /media/*` must reject requests whose `Host` isn't `localhost:PORT`/`127.0.0.1:PORT` **or** that carry `X-Forwarded-For`/`Forwarded` (that's how a tunnel is detected). This blocks DNS rebinding and stops `TUNNEL_URL` tunnels from exposing the posting API.
2. **No simple cross-site requests.** `POST /api/post`, `/api/subtitled`, `/api/subtitles`, `/api/subtitles/<id>/stop` and `/api/kept/delete` require `application/json`, and `POST /api/media` requires an `image/*`/`video/*` type (or `application/x-subrip` for SRT subtitles), so browsers must preflight and other websites can't post on the user's behalf. There are deliberately no CORS headers.
3. **Media ids are 128-bit random hex** and validated with `/^[a-f0-9]{32}$/` before touching the filesystem.
4. **Server re-validates everything** the UI checks (`problemsFor`); the UI is a convenience, not the gate.
5. **Secrets never reach the browser.** `/api/platforms` returns only names of env vars, never values.
6. **The phone port only takes signed requests.** Every `/app/*` request carries `X-SP-Time`, `X-SP-Nonce` and `X-SP-Signature` (HMAC-SHA256 with the pairing key of method, path, time, nonce and the body's SHA-256, or `<type>:<size>` for a file). Wrong signatures, times over a minute off and reused nonces get 401; addresses outside home networks get 403. The key is never sent.

## Testing

`npm test` covers the shared rules (lengths, compression notes, per-platform text), X's OAuth 1.0a signature (against X's published example), Bluesky facet byte ranges, LinkedIn escaping, and the server's endpoints and guards (it starts the server on a random port). `test/compress.test.js` generates a video and compresses it with the real ffmpeg; it's skipped when ffmpeg isn't installed. Platform `post()` flows can be traced offline by replacing `globalThis.fetch` with a stub that logs calls, which is how they were checked during development.

**Nothing has been tested against live platform APIs yet** (as of 2026-11-04). See the "Verification status" section of [docs/platforms.md](docs/platforms.md) before assuming a platform works, and update it when someone confirms one live.

## Decisions on record

- **Substack: not supported.** It has no official posting API. An unofficial route exists (session cookie + internal `/api/v1/comment/feed` for Notes), but it may break without notice and may violate their terms. On 2026-11-09 it was built for Notes on the `feature/substack-notes` branch and tested live: the cookie and image upload worked, but Cloudflare blocks publishing (`/comment/feed` returns a 403 page) unless the request carries the browser's `cf_clearance` bot-check cookie. Reusing that cookie or imitating a browser would be circumventing the bot check, so it won't be done. The branch is kept in case Substack opens an official API. Instead, every post ends with a reminder to post it on Substack by hand (Copy text, Share for photos, the saved video's path on the web page). Handing Notes to Substack's app with text and photos filled in was dropped on 2026-11-17: it needs a package that doesn't run in Expo Go.
- **Reddit: own profile only (2026-11-17).** If Reddit is built, it posts only to the signed-in user's own profile, never to any subreddit. The destination is fixed in code, not a field the user picks. OAuth scopes `identity` and `submit` only; each post started by a person; no scheduled posting, voting, comments, messages or reading other content. This was promised in the README for Reddit's API access request, so don't loosen it. Background: Reddit stopped taking new Data API requests on 2026-10-31, and Devvit (its replacement) can post as a user only from a click inside Reddit, so access may not be granted.
- **Instagram and Threads media need `TUNNEL_URL`**, because Meta fetches media from a URL. Instagram's resumable upload (direct video upload) is only available to Facebook Login for Business apps, and images still need a URL, so the tunnel approach was chosen for both.
- **"Finish by hand" after posting (2026-11-17):** one dialog for what's left to do by hand: the Substack reminder, and platforms' own items (a `todo: { text, label, url }` returned by `post()` and carried in its result). YouTube adds one when the uploaded video is private and not scheduled, linking to it in YouTube Studio. Visibility starts at Private for every post (not remembered), so publishing is a deliberate step there.
- **Substack reminder on the web page:** part of "Finish by hand", a dialog that closes only with Done. Text and image posts get it right after Post; video posts once every platform has finished, with a copy of the video saved to `~/Videos/Socialifer` (X's copy, else Instagram's, else another burn-in platform's, else the original; `keptVideos` in `publish.js`). Done deletes them (`POST /api/kept/delete`, which only touches files directly in that folder).
- **Alt text on X and Instagram only.** Bluesky, Mastodon and LinkedIn also support it; adding it there is a possible follow-up.
- **Thumbnails are never shrunk for the user.** They make the smaller copy themselves and so see how it looks; an automatic shrink could spoil it and the app would get the blame. (Phone photos being too big is an open question in the backlog.)
- **YouTube Posts (Community) aren't supported:** checked 2026-11-17, the YouTube Data API has no resource or method for them (`commentThreads` only makes comments), and Google hasn't announced one.
- **Ideas for later** are in [docs/backlog.md](docs/backlog.md), with the open feedback. Discuss them with the user before building any of them.
- **ffmpeg is optional**, not a dependency. It is found on PATH, in `FFMPEG_DIR`, or in winget's Links folder (`%LOCALAPPDATA%\Microsoft\WinGet\Links`), because VS Code terminals opened before an install don't see the new PATH. Without it, oversized videos are rejected per platform as before.
- **Videos are compressed, never trimmed.** A video that is too long for a platform is a problem the user must fix; only size is adjusted automatically. Compression targets the platform's `videoMB` with H.264/AAC, scaling so the shorter side is at most 1080 px (`SCALE` in `media.js`), and refusing to go below 400 kbps video (`compressionBitrate` in `public/rules.js`).
- **YouTube uploads start private** until the user's Google Cloud project passes YouTube's API audit. This can't be worked around in code; the UI and README say so. Shorts are not a separate upload type.
- **Subtitles: a track per language on YouTube, one language burned in elsewhere.** Generating them belongs to the separate transcribe project; this app only runs it (see [docs/subtitles.md](docs/subtitles.md)). Waiting for YouTube's automatic captions before posting to the others was rejected, because posts must not wait. Overlapping lines (as in YouTube's auto captions) are trimmed with `separateCues` in `public/rules.js` everywhere, never in the user's file. Generated SRTs never overlap (transcribe promises it), but `separateCues` still runs on every SRT: it's needed for uploaded ones, and it's the last check before a platform. On a Windows PC, burned-in text uses Nirmala UI because Arial has no Devanagari.
- **Brand: Socialifer (2026-11-17).** New name, Ring of fire logo, Dusk Plum colour, Inter and Noto Sans Devanagari, and the voice (friendly on success, calm otherwise). How the logo was chosen, with the options explored: the "Socialifer logo" artifact, https://claude.ai/artifact/QCqti7p3vUfmGdzSjmGL6L (private to the user). In the web app and the app since 2026-11-17 (name, mark, colours, fonts); and in the README, docs, package name and the `~/Videos/Socialifer` folder. The rest of the rollout is in section 9 of [docs/backlog.md](docs/backlog.md). Saved settings keep their `social-post:` keys, so nothing has to be carried over. The app's fonts use `expo-font` (approved 2026-11-17); Hindi falls back to Android's own Noto Sans Devanagari.
- **X limit defaults to 280**; `X_CHAR_LIMIT` exists for Premium accounts (up to 25,000).

## More docs

Read the one that matches the task; they hold the detail this file leaves out.

- [docs/architecture.md](docs/architecture.md): how a post flows through the web app and the server.
- [docs/platforms.md](docs/platforms.md): each platform's API, limits, quirks and verification status.
- [docs/subtitles.md](docs/subtitles.md): generating, reviewing and burning in subtitles, and how transcribe is called.
- [docs/mobile.md](docs/mobile.md): the app (phone): pairing, hand-over, the queue, storage, builds, and what's been tested live.
- [docs/website.md](docs/website.md): socialifer.com and its hosting.
- [brand/README.md](brand/README.md): the Socialifer brand, its files and the developer apps.
- [docs/backlog.md](docs/backlog.md): everything still to do.

## Backlog

Everything still to do (features and fixes not built, and things built but not yet tested live) is in [docs/backlog.md](docs/backlog.md), grouped by feature, with where each item came from. Discuss each item with the user before building it, and remove it there once it's built, tested or dropped.
