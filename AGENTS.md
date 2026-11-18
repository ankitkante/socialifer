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
npm run website        # previews socialifer.com (website/) at http://localhost:4000, as Cloudflare Pages serves it
npm run sp-mobile-app  # Expo's dev server for the phone app in mobile/ (open it in Expo Go)
npm run sp-mobile-apk  # builds an installable APK of the phone app on Expo's servers (EAS; needs an Expo login)
```

Requires Node 22.9+ (`--env-file-if-exists`, `fs.openAsBlob`, global `fetch`/`FormData`/`Blob`).

## Layout

| Path | Role |
|---|---|
| `server.js` | HTTP server: routing, host/forwarding guard, `/api/*` endpoints, fan-out to platforms |
| `publish.js` | `publish()`: posting to the selected platforms (checks, compression, burn-ins, results), for `/api/post` and the phone queue |
| `phone.js` | The phone app's server on `PHONE_PORT` (Wi-Fi): signatures, pairing key in `phone/pairing.json`, the pairing QR code, `/app/*` |
| `queue.js` | Every post the laptop keeps, from the page and the phone (`POSTS_DIR/<id>/`): scheduled ones, posted one at a time at their time through `publish()`, and finished ones as history. See [docs/scheduling.md](docs/scheduling.md) |
| `mobile/` | The phone app (Expo, Android); its files are listed in [docs/mobile.md](docs/mobile.md). Follow `mobile/AGENTS.md` there |
| `media.js` | Uploads in `uploads/`, public `/media/*` (with Range), 24h cleanup, ffmpeg copies (`fitVideo`, `burnSubtitles`) |
| `subtitler.js`, `work.js` | Running transcribe for subtitles; one heavy job at a time |
| `status.js` | `laptopStatus()` for `/api/status` and the phone's `/app/hello` |
| `public/` | The web page: `index.html` (markup only, no build step), `styles.css`, `fonts/`, `icons/` (Simple Icons, CC0), and ES modules in `js/` served by name from `/js/<name>.js` |
| `public/rules.js` | **Shared by browser, server and phone app**: character counting and per-platform validation |
| `public/fields.js` | **Shared by browser and phone app**: `FIELDS` (each platform's extra fields). Plain data |
| `platforms/*.js` | One module per platform; `index.js` lists them in display order; `http.js` has `request()`, `poll()`, `env()` |
| `scripts/` | `youtube-auth.js` (OAuth), `tunnel.js` (saves `TUNNEL_URL`), `website.js` (local preview of `website/`) |
| `brand/` | Logo, icons, favicons, colours, fonts and voice (its README). Keep every copy of the mark in step |
| `website/` | socialifer.com, deployed from `main`; see [docs/website.md](docs/website.md). The privacy policy must match what the app does |
| `test/` | `node:test` suites |
| `.env.example` | Every supported setting, with where to get each credential |

## Conventions

- **No dependencies.** Use Node built-ins only. Don't add npm packages without asking the user. The one exception is `qrcode` (the pairing code). The phone app in `mobile/` has its own packages; ask before adding any.
- ES modules, 2-space indent, single quotes, semicolons. Comments explain *why* (API quirks, limits), not what.
- Platform API quirks live in the platform module, next to the code they affect, with a short comment.
- Error messages are shown to the user verbatim, so write them as plain sentences that say what to do.
- **Errors and progress:** throw `ApiError` (from `platforms/http.js`) for expected failures; any other error is treated as a bug. Call `step()` (from `log.js`) before slow or failure-prone work. Details in [docs/architecture.md](docs/architecture.md).
- **New platform or platform field:** follow the module contract in [docs/platforms.md](docs/platforms.md).

## Invariants: don't break these

1. **Local only.** The server binds to `127.0.0.1`. Everything except `GET/HEAD /media/*` must reject requests whose `Host` isn't `localhost:PORT`/`127.0.0.1:PORT` **or** that carry `X-Forwarded-For`/`Forwarded` (that's how a tunnel is detected). This blocks DNS rebinding and stops `TUNNEL_URL` tunnels from exposing the posting API.
2. **No simple cross-site requests.** `POST /api/post`, `/api/schedule` (and its `move`, `cancel`, `now` and `PUT` edit), `/api/subtitled`, `/api/subtitles`, `/api/subtitles/<id>/stop` and `/api/kept/delete` require `application/json`, and `POST /api/media` requires an `image/*`/`video/*` type (or `application/x-subrip` for SRT subtitles), so browsers must preflight and other websites can't post on the user's behalf. There are deliberately no CORS headers.
3. **Media ids are 128-bit random hex** and validated with `/^[a-f0-9]{32}$/` before touching the filesystem.
4. **Server re-validates everything** the UI checks (`problemsFor`); the UI is a convenience, not the gate.
5. **Secrets never reach the browser.** `/api/platforms` returns only names of env vars, never values.
6. **The phone port only takes signed requests.** Every `/app/*` request carries `X-SP-Time`, `X-SP-Nonce` and `X-SP-Signature` (HMAC-SHA256 with the pairing key of method, path, time, nonce and the body's SHA-256, or `<type>:<size>` for a file). Wrong signatures, times over a minute off and reused nonces get 401; addresses outside home networks get 403. The key is never sent.

## Testing

`npm test` covers the shared rules, X's OAuth signature, Bluesky facets, LinkedIn escaping, and the server's endpoints and guards (it starts the server on a random port). `test/compress.test.js` uses the real ffmpeg and is skipped without it. Platform `post()` flows can be traced offline by stubbing `globalThis.fetch`.

**Not every platform has been tested live.** Check "Verification status" in [docs/platforms.md](docs/platforms.md) before assuming one works, and update it when someone confirms one.

## Key decisions

The full list, with reasons, is in [docs/decisions.md](docs/decisions.md). The ones that shape everyday work:
- **Videos are compressed, never trimmed;** ffmpeg is optional.
- **Substack, Reddit and YouTube Posts aren't supported** (no usable API); posts end with a "Finish by hand" reminder instead.
- **YouTube uploads start private** until the Google project passes YouTube's audit.

## More docs

Read the one that matches the task; they hold the detail this file leaves out.

- [docs/architecture.md](docs/architecture.md): how a post flows, errors, logging and progress, `/api/status`.
- [docs/scheduling.md](docs/scheduling.md): scheduled posts, the slot rules, the Calendar and Posts, and how posts are saved.
- [docs/platforms.md](docs/platforms.md): each platform's API, limits, quirks, verification status, and adding a platform.
- [docs/decisions.md](docs/decisions.md): decisions on record, with reasons.
- [docs/subtitles.md](docs/subtitles.md): generating, reviewing and burning in subtitles, and how transcribe is called.
- [docs/mobile.md](docs/mobile.md): the app (phone): its files, pairing, hand-over, the queue, storage, builds, and what's been tested live.
- [docs/website.md](docs/website.md): socialifer.com and its hosting.
- [brand/README.md](brand/README.md): the Socialifer brand, its files and the developer apps.
- [docs/backlog.md](docs/backlog.md): everything still to do. Discuss each item with the user before building it, and remove it once it's built, tested or dropped.
