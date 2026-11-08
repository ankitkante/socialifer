# Social Post

Write a post once, attach photos or videos, and publish it to several social platforms at the same time, from a single page.

Supported platforms: **X, Bluesky, Mastodon, Threads, Instagram, YouTube (videos and Shorts), LinkedIn, Facebook Pages, Telegram and Discord**.

## Setup

Requires Node.js 22.9 or newer. There are no packages to install.

```sh
cp .env.example .env    # then fill in the platforms you use
npm start               # opens on http://localhost:3000
```

`.env.example` explains where to get each credential. Platforms without credentials show up greyed out on the page. Restart the server after you edit `.env`.

## Using it

The page has two columns: you write on the left, and the **Post panel** stays pinned on the right. On a phone or narrow window, a bar at the bottom keeps the Post button within reach.

- **Your post:** type it once, and attach photos or videos with **+ Add photo or video**, by dragging files onto the box, or by pasting an image.
- **Post to:** click the YouTube, Instagram or X pills (or any other platform you've set up) to choose where it goes. **+ Set up more** lists the platforms that aren't set up yet and the `.env` values each one needs.
- **Platform tabs:** each chosen platform gets a tab with a badge: ✓ ready, ! with a count of issues, or i for a note such as "will be compressed". A tab has that platform's own text box (it shows your post as you type until you edit it; **↺ Use main post** switches it back), its options, problems shown right under the field they concern, and a **live preview**:
  - **YouTube:** title (your first line unless you type one; the rest becomes the description), visibility, schedule, category, tags, custom thumbnail, made for kids, altered or synthetic (AI) content; more: recording date and languages. The preview shows the title as search results cut it and whether the video will be a Short. For a Short, it shows the thumbnail in the Shorts player, the Shorts shelf and a 16:9 frame. It notes a thumbnail whose shape doesn't match the video, or one under 640 px wide.
  - **Instagram:** post or Story, cover frame or cover image, also share the Reel to Feed, alt text, AI label; more: audio name and trial reel. The preview shows the caption where the feed cuts it ("… more"). A Reel's cover appears full screen, with the areas Instagram's header and caption cover and the middle square every view keeps. It also appears in the profile grid (3:4), the Reels tab (about 2:3) and, when shared to the feed, as a square. Those grid crops aren't documented, so they're approximate. A photo post shows at its own shape (4:5 to 1.91:1) next to its grid tile. @mentions in the caption link to those accounts and notify them.
  - **X:** split long posts into a numbered thread, alt text, made-with-AI label. The preview shows every post in the thread. A thread breaks at the end of a sentence when one is close to the limit; a post cut mid-sentence ends with "...", and every post ends with its number on its own line, like `(1/2)`. Each post in a thread is billed separately.
  - Not possible through the APIs: YouTube end screens, cards and monetisation; Instagram library music, filters and stickers; X quote posts (Enterprise plan only).
- **Post panel:** before posting, one row per platform shows ✓ Ready, a note, or its issues (click a row to open that tab), and the button says why it's disabled. While posting, each platform shows its current step with a progress bar (upload parts, compression). Afterwards you get **View post** and **Copy link** for each one. A failed post keeps your text and files, and only the failed platforms stay selected, so the button retries just those. Press **Ctrl+Enter** to post from anywhere on the page.
- **Header:** the dots show whether the cloudflared **tunnel** reaches this server (needed for Instagram and Threads media) and whether **ffmpeg** is installed. The theme switch follows your system by default; choose Light or Dark to override it.
- The terminal logs every step, with any error's full details.

Supported files: JPEG, PNG, GIF and WebP images, and MP4 and MOV videos. PNG and WebP images are converted to high-quality JPEG when you add them, because Instagram only accepts JPEG and every platform takes it. Transparent areas become white, and images larger than 4,096 px on the longest side are scaled down. GIFs are left as they are.

## What each platform accepts

| Platform | Text limit | Media per post | Video length | Notes |
|---|---|---|---|---|
| X | 280 (links count as 23) | 4 images or 1 video | Up to 20 min | Images up to 5 MB, video up to 512 MB. Set `X_CHAR_LIMIT` and `X_VIDEO_MAX_MINUTES` for Premium. |
| Bluesky | 300 | 4 images or 1 video | Not checked | Images up to 1 MB, video up to 100 MB. |
| Mastodon | 500 (links count as 23) | 4 images or 1 video | Not checked | Limits vary by server. |
| Threads | 500 | Up to 20, mixed | Up to 5 min | Media needs `TUNNEL_URL`. |
| Instagram | 2,200 | 1 to 10, mixed | 3 s to 15 min; up to 1 min in a multi-file post | **Needs an image or video.** JPEG images only (PNG and WebP are converted automatically). Video up to 300 MB. A single video becomes a Reel. Needs `TUNNEL_URL`. |
| YouTube | 5,000 (description) | **Exactly 1 video** | Up to 15 min (`YOUTUBE_MAX_MINUTES` once your channel is phone-verified) | Needs a title (up to 100 characters). By default the first line of your post is the title and the rest is the description. No `<` or `>`. |
| LinkedIn | 3,000 | Up to 20 images or 1 video | 3 s to 30 min | |
| Facebook | 63,206 | Up to 10 images or 1 video | Up to 20 min | Posts to a Facebook Page. Facebook's API can't post to personal profiles. |
| Telegram | 4,096 | Up to 10, mixed | Not checked | Captions are capped at 1,024 characters, so longer text is sent as a separate message. |
| Discord | 2,000 | Up to 10, mixed | Not checked | 10 MB per file on servers without boosts. |

You can't mix images and videos in one post on X, Bluesky, Mastodon, LinkedIn or Facebook.

Video lengths are read in the browser when you attach a video, and again on the server if ffmpeg is installed, so a video that's too long is flagged before anything uploads.

## Videos that are too big for a platform

With [ffmpeg](https://ffmpeg.org/) installed, a video that's over a platform's size limit is **compressed automatically for that platform only**. For example, a 450 MB video goes to YouTube as it is and to Instagram as a copy under 300 MB. The platform shows a note like "will be compressed to fit 300 MB" before you post. Compression runs when you click Post, can take several minutes for a large video, and leaves your original file untouched. Videos are never trimmed, so if one is too long to fit a size limit at watchable quality, that platform says so instead.

To install ffmpeg on Windows, run `winget install --id Gyan.FFmpeg`, then restart the server. The startup message says whether ffmpeg was found. If it's installed somewhere unusual, set `FFMPEG_DIR` in `.env` to the folder containing `ffmpeg.exe` and `ffprobe.exe`. Without ffmpeg, oversized videos are simply rejected for that platform.

## Images and video on Threads and Instagram

Meta doesn't accept file uploads for Threads or Instagram. Instead, it downloads each file from a public web address. To make that work:

1. Install [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) and run `cloudflared tunnel --url http://localhost:3000`.
2. Copy the `https://….trycloudflare.com` address it prints into `TUNNEL_URL` in `.env`, then restart the server.

Only uploaded files are reachable through the tunnel. The page and the posting API reject any request that arrives through it. A quick tunnel's address changes each time you start it, so update `.env` when that happens. Text-only Threads posts work without a tunnel.

## YouTube

When YouTube is selected, its tab also has the title, visibility (public, unlisted or private) and the "made for kids" setting. With no title typed, the first line of your post becomes the title and the rest becomes the description. If you type a title, the whole post is the description. YouTube's box shows exactly what the description will be.

**Shorts:** YouTube has no separate Shorts upload. A video becomes a Short automatically when it's vertical or square and 3 minutes or less. After you attach a video, the panel tells you which kind it will be.

**Setup (once):**

1. In the [Google Cloud Console](https://console.cloud.google.com/), create a project and enable **YouTube Data API v3**.
2. Set up the **OAuth consent screen** (External), add yourself as a test user, then set its publishing status to **In production**. In Testing mode, the sign-in expires after 7 days. Google will warn that the app is unverified when you sign in; that's expected for a personal app.
3. Under **Credentials**, create an **OAuth client ID** of type **Desktop app**. Put its ID and secret in `.env` as `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET`.
4. Run `npm run youtube-auth`. A Google sign-in opens; choose the account or brand account that owns your channel. The command saves `YOUTUBE_REFRESH_TOKEN` to `.env`. Restart the server. It asks to upload videos and to view your YouTube account. The view access lets the app wait until YouTube has finished processing a video before setting its custom thumbnail. If you signed in before 2026-11-09, run it again to grant that.

**Uploads stay private at first.** YouTube locks every video uploaded through an API project it hasn't audited to private, whatever visibility you choose. Until your project passes the audit, publish each video by hand in YouTube Studio. To remove the lock for good, request an audit for your Google Cloud project using YouTube's API compliance audit form.

## Notes

- The server listens on `127.0.0.1` only and has no login. Don't expose it to a network.
- Uploaded files are kept in `uploads/` and deleted after a successful post, when you remove them from the page, or after 24 hours.
- Video posts can take a few minutes, because the app waits for each platform to finish processing.
- On LinkedIn, simple hashtags like `#AI` become real hashtags, but `#with_underscore` is posted as plain text.
- **X** has no free API plan for new developer accounts (pay-per-use since February 2026). Buy credits at [console.x.com](https://console.x.com) before posting; a post costs about $0.01. Set the app permissions to **Read and write** *before* generating the access token.
- **LinkedIn** API versions expire after about a year. If you see a version error, set `LINKEDIN_VERSION` to a recent `YYYYMM` value.
- **Substack** isn't supported because it has no official API for posting.

## Ideas for later

Not started; to be discussed before building. Listed in priority order.

- **Posting to Reddit (top priority):** a new platform, ahead of everything below.
- **Text-only posts on Instagram:** turn the text into an image carousel, since Instagram needs an image or video.
- **Scheduling in the app** for platforms without built-in scheduling through the API (Instagram and X; YouTube already has a schedule option). The app would keep the post and publish it at the chosen time, so the server, and for Instagram the tunnel, would need to be running then. Open questions: where queued posts are stored, what happens to a missed time, and retries.
- **Auto-fit Instagram Reel covers to 9:16:** Instagram crops a cover to its middle 9:16 strip, so a 16:9 thumbnail loses most of its picture. The preview now shows that and notes it; the app could also pad the image to 9:16 with a blurred background. (The video itself isn't cropped: a 16:9 Reel was checked live on 2026-11-05 and shows its full picture.)
- **Check Instagram feed photo shapes:** Meta's API only accepts feed photos from 4:5 to 1.91:1, and the app doesn't check this yet. To be added when it comes up.
- **A logo:** the header shows just the name "Social Post" for now. A paper plane was ruled out because so many sites use one.
- **Drafts and post history:** deferred.

## Further reading

- [AGENTS.md](AGENTS.md): conventions, the platform module contract, security rules that must hold, and decisions made so far. Coding agents read this first.
- [docs/architecture.md](docs/architecture.md): how posting, media storage and the security model work.
- [docs/platforms.md](docs/platforms.md): per-platform API details, limits, edge cases, and what has been verified.

Run `npm test` to check your changes. It needs no credentials and no network.
