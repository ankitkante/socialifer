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
| `media.js` | Upload storage in `uploads/`, public `/media/*` serving (with Range), 24h cleanup, and ffmpeg copies: compressed (`fitVideo`) and with burned-in subtitles (`burnSubtitles`) |
| `public/index.html` | The page's markup only (no build step) |
| `public/styles.css` | All styles; light and dark tokens on `:root`, `data-theme` on `<html>` overrides the system theme |
| `subtitler.js` | Generating subtitles: runs lyrics-video's `subtitles.py` (`LYRICS_VIDEO_DIR`), turns each SRT it writes into an upload, keeps transcripts by video content, and stops a run left by a dead server |
| `work.js` | One heavy job at a time (Whisper, then subtitle burn-ins) |
| `public/js/` | The page's ES modules: `main.js` (picker, tabs, per-platform sections, field errors, wiring), `fields.js` (`FIELDS`, saved settings, controls), `uploads.js` (attachments, JPEG conversion, thumbnails), `subtitles.js` (the Subtitles strip, generating, SRT uploads, burned-in copies, each platform's subtitles choice), `review.js` (the Review lines dialog), `previews.js` (YouTube/Instagram/X preview cards), `panel.js` (Post panel, posting and its NDJSON stream), `status.js` (theme toggle, status dots), `state.js` (shared state and `hooks`), `dom.js` (helpers, NDJSON reader). Served by name from `/js/<name>.js` only |
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

`GET /api/status` returns `{ ffmpeg, subtitles, subtitlesProblem, tunnel: { configured, reachable } }` for the header's status dots; `subtitles` says whether `LYRICS_VIDEO_DIR` points at a usable lyrics-video (its `.venv` Python and `subtitles.py`), and the page shows Generate only then. `subtitlesProblem` (from `checkGenerator` in `subtitler.js`) says what to fix when it's set but unusable; the header, the strip and the startup message show it. Reachability is checked by fetching `TUNNEL_URL/media/health` (answered with 204 by `serveMedia`), cached for 20 seconds.

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
2. **No simple cross-site requests.** `POST /api/post`, `/api/subtitled`, `/api/subtitles` and `/api/subtitles/<id>/stop` require `application/json`, and `POST /api/media` requires an `image/*`/`video/*` type (or `application/x-subrip` for SRT subtitles), so browsers must preflight and other websites can't post on the user's behalf. There are deliberately no CORS headers.
3. **Media ids are 128-bit random hex** and validated with `/^[a-f0-9]{32}$/` before touching the filesystem.
4. **Server re-validates everything** the UI checks (`problemsFor`); the UI is a convenience, not the gate.
5. **Secrets never reach the browser.** `/api/platforms` returns only names of env vars, never values.

## Testing

`npm test` covers the shared rules (lengths, compression notes, per-platform text), X's OAuth 1.0a signature (against X's published example), Bluesky facet byte ranges, LinkedIn escaping, and the server's endpoints and guards (it starts the server on a random port). `test/compress.test.js` generates a video and compresses it with the real ffmpeg; it's skipped when ffmpeg isn't installed. Platform `post()` flows can be traced offline by replacing `globalThis.fetch` with a stub that logs calls, which is how they were checked during development.

**Nothing has been tested against live platform APIs yet** (as of 2026-11-04). See the "Verification status" section of [docs/platforms.md](docs/platforms.md) before assuming a platform works, and update it when someone confirms one live.

## Decisions on record

- **Substack: not supported.** It has no official posting API. An unofficial route exists (session cookie + internal `/api/v1/comment/feed` for Notes), but it may break without notice and may violate their terms. On 2026-11-09 it was built for Notes on the `feature/substack-notes` branch and tested live: the cookie and image upload worked, but Cloudflare blocks publishing (`/comment/feed` returns a 403 page) unless the request carries the browser's `cf_clearance` bot-check cookie. Reusing that cookie or imitating a browser would be circumventing the bot check, so it won't be done. The branch is kept in case Substack opens an official API. The alternative is the mobile app handing Notes to Substack's own composer (see "Backlog" below).
- **Instagram and Threads media need `TUNNEL_URL`**, because Meta fetches media from a URL. Instagram's resumable upload (direct video upload) is only available to Facebook Login for Business apps, and images still need a URL, so the tunnel approach was chosen for both.
- **Alt text on X and Instagram only.** Bluesky, Mastodon and LinkedIn also support it; adding it there is a possible follow-up.
- **Ideas for later** are in the "Backlog" section below, with the open feedback. Discuss them with the user before building any of them.
- **ffmpeg is optional**, not a dependency. It is found on PATH, in `FFMPEG_DIR`, or in winget's Links folder (`%LOCALAPPDATA%\Microsoft\WinGet\Links`), because VS Code terminals opened before an install don't see the new PATH. Without it, oversized videos are rejected per platform as before.
- **Videos are compressed, never trimmed.** A video that is too long for a platform is a problem the user must fix; only size is adjusted automatically. Compression targets the platform's `videoMB` with H.264/AAC, scaling so the shorter side is at most 1080 px (`SCALE` in `media.js`), and refusing to go below 400 kbps video (`compressionBitrate` in `public/rules.js`).
- **YouTube uploads start private** until the user's Google Cloud project passes YouTube's API audit. This can't be worked around in code; the UI and README say so. Shorts are not a separate upload type.
- **Subtitles: a track per language on YouTube, one language burned in elsewhere.** Generating them belongs to the separate lyrics-video project; this app only runs it (see "Subtitles" below). Waiting for YouTube's automatic captions before posting to the others was rejected, because posts must not wait. Overlapping lines (as in YouTube's auto captions) are trimmed with `separateCues` in `public/rules.js` everywhere, never in the user's file. Generated SRTs never overlap (lyrics-video promises it), but `separateCues` still runs on every SRT: it's needed for uploaded ones, and it's the last check before a platform. On a Windows PC, burned-in text uses Nirmala UI because Arial has no Devanagari.
- **X limit defaults to 280**; `X_CHAR_LIMIT` exists for Premium accounts (up to 25,000).

## Subtitles (built and first posted live on 2026-11-12)

Built from the "Subtitles redesign" artifact, https://claude.ai/artifact/7tF53VA3eUUpMxd9XDwN2K (private to the user). Its **Screens** page is the source of truth.

- **Per video, per language:** each video item holds `subs: { [lang]: entry }` (`subtitles.js`). `POST /api/post` sends `subtitles: { videoId: { lang: srtId } }`; the server checks every video is in the post and every id is an SRT upload.
- **Strip under the videos:** "Video is in" and "Make subtitles in" (remembered in `social-post:subtitles`), Generate (only when `/api/status` says `subtitles: true`) or Upload SRT. With several videos, one row per video and Generate for all.
- **Languages:** Hindi and English only (`SUBTITLE_LANGUAGES` in `rules.js`), for Video is in, uploaded SRTs and YouTube's Audio language. The server refuses other codes before starting a job. The codes are the same in Whisper and YouTube; adding a language means checking both accept it.
- **Contract:** how to call lyrics-video (arguments, events, exit codes) is defined only in its AGENTS.md, "Calling it from another program". Don't restate it here.
- **Protocol:** Social Post expects protocol **1** (`PROTOCOL` in `subtitler.js`). Any other first event kills the run with "lyrics-video and Social Post don't match … Update both projects". Raise it only together with lyrics-video's.
- **Generating:** `POST /api/subtitles { video, language, subtitles }` queues a job in `subtitler.js` and streams `{ type: 'job', job }` snapshots until it ends. Each SRT lyrics-video writes becomes an upload and is then deleted from its folder. `POST /api/subtitles/<id>/stop` stops it (the whole process tree on Windows); finished languages are kept. The language code must look like `hi` because it becomes a command-line argument.
- **One heavy job at a time:** Whisper runs and subtitle burn-ins share one line in `work.js`, Whisper first. Post-time compression (`fitVideo`) stays outside it: it only runs after Post, which is disabled while Whisper runs, and queuing it behind preview burn-ins would hold the post up.
- **Saved transcripts:** lyrics-video's `--out-dir` is `uploads/transcripts/<sha256 of the video>/`, so the same video added again skips Whisper. A folder goes 24 hours after its last use (`cleanupTranscripts`, run with the hourly cleanup).
- **Leftover runs:** the running job's PID is kept in `uploads/transcripts/running.json`. At startup a run left by a dead server is stopped, but only if that PID is still the recorded python running `subtitles.py --json` and started within a minute of the record; otherwise it's left alone.
- **Other platforms (decision):** the 7 platforms besides YouTube, X and Instagram keep today's behaviour: English burned in, or the only language there is. Testing and designing subtitles for them is deferred until those platforms are needed.
- **Post gating:** Post is disabled while any job is queued or running. While a burned-in copy is still being made, Post works and those platforms wait for it.
- **YouTube:** one `captions.insert` track per ticked language, labelled with its real code and name. "Video is in" (and Generate) sets the Audio language field.
- **X and Instagram:** a Subtitles select per tab, "Burned in · <language>" or "None", remembered per platform. Other platforms get the default from `burnLanguage` in `rules.js`: English, else the first language.
- **Burning in:** starts as soon as a platform needs a copy (`POST /api/subtitled`). A video over the platform's size limit is burned and fitted in one ffmpeg run (CRF 20 with the bitrate capped to fit; `burnTarget` in `rules.js`). Copies are cached per video, SRT and size target, so platforms with the same language share one. A video under the limit is burned without a cap; in the rare case the copy comes out over the limit, it's compressed again at post time.
- **Review lines:** a dialog per video (`review.js`) with a tab per language, Burned in / YouTube track preview, and the zone Reels and Shorts cover shaded. Only text is editable; Done saves edited languages as new SRT uploads. Download SRT saves the edited copy. Closing with unsaved edits (× or Escape) asks "Discard N edited lines?", with Keep editing as the default.

Checked in this test: Generate for Hindi and English (25 and 26 lines), Post disabled while generating, saved transcripts reused (a language remade instantly), an uploaded SRT with a language, two caption tracks on YouTube with their real languages, and the burned-in copy posted to X and Instagram.

## Backlog (not built)

Everything wanted but not built: feedback from live use first, then ideas in priority order. Discuss each with the user before building; items marked "design first" need options shown first. Remove an item once it's built or dropped.

### Feedback from the first live test (2026-11-12)

The user's feedback while posting a 54-second Hindi talk to YouTube, X and Instagram.

- **Live lyrics-video logs:** show `subtitles.py`'s own messages in this server's terminal as they arrive (e.g. with a `[subtitles]` prefix). Today `subtitler.js` keeps the child's stderr only to print it when a job fails, so a running job looks silent.
- **Review: edit timing as well as text,** like YouTube's subtitle editor. Each line should show its start and end time and let both be changed. Example: the English line "And it is very important for" was on screen for 0.6 s and flashed by. Still open: whether adding, deleting, merging and splitting lines are also wanted.
- **Review: two-line subtitles.** A 35-character English line reached the edges of a vertical video when burned in. The editor's single-line text box can't add a line break. Also check the burn-in's side margins on vertical videos.
- **"Replace with SRT" removes every language** without warning (`pickSrt(item, true)` in `public/js/subtitles.js`). The user replaced English and lost Hindi. Decide with the user: replace one language only, or ask first.
- **"Post to" pills and the tab bar look alike (design first).** The pills choose platforms; the tabs right below (All / YouTube / X / Instagram) open each platform's settings. The user keeps clicking a pill when they mean the tab, which also unselects the platform.
- **Reminder to make the YouTube video public.** Visibility already defaults to Public, but YouTube forces uploads from an unaudited API project to private. After a YouTube upload, show a reminder with a link to that video in YouTube Studio, like the Substack reminder. Only when Public was chosen and nothing is scheduled.
- **Thumbnail title tool (new feature, design first).** Add a title to an existing thumbnail inside the app. The user does this today in a separate Claude conversation ("Add caption to thumbnails"); ask what it does and what goes wrong. The previews already know the safe areas: an Instagram cover keeps 7.5–92.5% of the width and 21.875–78.125% of the height (`.safe-box` in `styles.css`); the Shorts player covers the bottom 25%. Hindi needs Nirmala UI on Windows.
- **Substack reminder for video posts too.** Substack takes video, but today's reminder (`showSubstackReminder` in `public/js/panel.js`) only shows after posts with no video. Wanted: save a local copy of the video that went to X and Instagram (the burned-in copy) on disk; when posting has finished on every platform, show a dialog with that file's path, telling the user to post it on Substack. The dialog closes only with Done: no ×, Escape or click outside. Still open: the folder and file name (outside `uploads/`, so the 24-hour cleanup doesn't delete it), and what to save when X and Instagram got different copies (another language or size).

Smaller things found in the same test:
- **Uploads left behind by a page reload:** reloading or closing the page with files attached leaves them in `uploads/` until the 24-hour cleanup (about 430 MB after a day of testing). The page also forgets a running subtitle job. Both are the deferred "post survives a reload" idea.
- **Old Audio language:** a YouTube Audio language saved before the Hindi/English list (e.g. French) isn't reset and is still sent.
- **English cues from lyrics-video can be too short;** the cause and fix are recorded in lyrics-video's AGENTS.md.

### Ideas for later (priority order)

- **Mobile app (decided 2026-11-16, not built):** see "Mobile app" below.
- **Hosted server (not for now, maybe later):** run the server in the cloud instead of on your PC, so scheduled posts go out while the PC is off and the phone app can post from anywhere. Put off on 2026-11-16 to save costs; the mobile app uses the laptop server for now. It needs a login on the API (today there is none, because it only listens on your PC), the `.env` keys stored on the server, and storage for uploads and queued posts that survives restarts. Instagram would no longer need the cloudflared tunnel, because the server can give Meta public media links itself. The aim is a free or pay-as-you-go plan; any plan must stay awake for scheduled posts, have enough storage and bandwidth for videos, and allow ffmpeg.
- **Scheduling: a queue and a calendar.** Comes after the mobile app's first version. Write a post when the idea comes and add it to a queue; the laptop server publishes queued posts at a steady pace, in slots you set, so followers aren't flooded. A calendar shows taken and free slots, and a post can go into a specific slot. X and Instagram have no scheduling in their APIs, so the server does the publishing; YouTube can also use its own `publishAt`. Slots missed while the laptop was off are re-spaced into the next free slots, never sent all at once. Still open: how often posts go out, per platform.
- **Hand Notes over to Substack's app** (from the mobile app): open Substack's composer with the text and images filled in, so you only tap Post. Not yet checked whether Substack's app accepts shared text and images.
- **Posting to Reddit:** a new platform.
- **Text-only posts on Instagram:** turn the text into an image carousel, since Instagram needs an image or video.
- **A logo:** the header shows just the name "Social Post" for now. A paper plane was ruled out because so many sites use one.
- **Drafts and post history:** deferred (the mobile app keeps its own drafts).
- **YouTube Posts tab** (formerly Community: text, images, polls): the YouTube Data API reference lists no way to create these, so for now they're posted by hand. To be double-checked in the API docs.

### Mobile app (decided 2026-11-16, not built)

- **Laptop server as the backend:** to save costs, no hosted server for now (it stays in "Ideas for later").
- **Code:** Expo (React Native), Android only, in `mobile/` in this repo, so it can share `public/rules.js` with the server.
- **Offline first:** posts are saved on the phone. Tapping Post marks a post ready; drafts stay on the phone and are never sent.
- **Hand-over:** when the phone reaches the laptop over Wi-Fi, every ready post goes to the server automatically. The server keeps the queue on disk (it must survive restarts), so the phone can leave afterwards.
- **Processing:** the server checks (`problemsFor`) and compresses (`fitVideo`) phone posts exactly as it does web posts. Rejected posts and failed platforms are shown on the phone, and the post stays there to fix.
- **Pairing:** at startup the server prints a QR code in the terminal (like Expo's) with its current Wi-Fi address, a secret key and its certificate's fingerprint. Scan again if the address changes.
- **Phone port:** a separate HTTPS port on the Wi-Fi, with a self-made certificate the phone trusts via the QR code, and only the app's endpoints. Every request needs the key. The web page's port stays local-only (invariant 1).
- **`qrcode` npm package:** approved by the user as an exception to "No dependencies".
- **First version:** the web page's features (per-platform settings, previews) for text, images and videos posted as they are. No subtitles: videos are edited and subtitled on the laptop.
- **Later:** staggered sending (to be discussed), then scheduling with a calendar.
