# Backlog

Everything still to do: features and fixes not built. What's built but not yet tried live is in [testing.md](testing.md). Grouped by feature. Discuss each item with the user before building it; items marked "design first" need options shown first. Remove an item once it's built, tested or dropped.

**Where:** W = web app, P = app (the phone app), B = both, S = server only.
**From:** where the item came from, kept for history: *live test* (first live web test, 2026-11-12), *phone test* (phone testing, 2026-11-17), *phone build* (building the phone app, 2026-11-16 to 17), *idea* (ideas for later).

## Next up

- **Reddit in "Finish by hand"** (P · phone test, 2026-11-18): the reminder covers YouTube and Substack; it should also remind about Reddit. Same as the "Reddit reminder" idea in section 8 (moved up). **Open question (2026-11-19):** build it like the Substack part (Copy text, Share for photos and text, Done, no mockup), or mock it up first?
- **"Needs your attention" after a sync** (P · phone test, 2026-11-19, design first): when the phone syncs with the laptop, flag posts that need a look. Proposed: a "2 posts need your attention" banner on Posts (tap to show only those), a count on the Posts tab, and a reason line on each post with its action: too close to another post (a picked time made offline that clashes with one scheduled on the laptop meanwhile; the laptop keeps both today, since too close is only a warning, and nobody sees it), moved because its time passed while away, refused by the laptop, or failed on a platform. A post clears once it's acted on or "Okay" is tapped.
- **Where the Activity log lives** (P · phone test, 2026-11-19, to think about): it's under Laptop, but it shows the phone's own log (`phone-*.log` on the laptop plus lines not yet sent), not the laptop's `server-*.log`. Decide where it belongs, and whether the laptop's lines about phone posts (received, scheduled) should be shown too.
- **Drafts on the web page** (W · parity, wanted 2026-11-19, upcoming round): the web page can't save drafts (a reload or closing it loses the post); the app saves every draft. Features must match on both, so the web page gets drafts: saved as you type, Save as draft, a Drafts pill in Posts (as in the mockup's Web Posts), opening one in Write. Post history already exists (Posts). Decide where web drafts live (the laptop's `POSTS_DIR`, likely) and whether they show in the app.
- **Web Review as platform cards** (W · mockup check, 2026-11-19, later): the Scheduling mockup's web Review (`WebC_Review`) shows a card per platform, its preview beside its settings; the page still has a tab per platform. A redesign; overlaps "Post to pills look like the tabs" in section 5.
- **Calendar from a library** (P · phone test, 2026-11-19): replace the hand-built Calendar (`Calendar.js`: week day buttons and the day timeline) with **react-native-calendars** (Wix): its week strip and `Timeline` day view (events, a "now" line) match the mockup's layout. Plain JS, works in Expo Go; 10.3k stars, last release Jan 2026, code changed Oct 2026. Its theme is separate from Paper's, so plum and Inter are set on it by hand. Checked 2026-11-19: react-native-big-calendar (v5 still beta, 0.6k stars) and @howljs/calendar-kit (last release Oct 2025, needs Reanimated and gesture handler). Ask before installing.

## 1. YouTube

- **Tags as chips** (B · phone test, design first, good to have): the Tags field is one comma-separated text box today. Wanted: type a tag, it becomes a chip, tap to remove.

## 2. X

- Nothing open.

## 3. Instagram

- **Text-only posts as a carousel** (idea): turn the text into an image carousel, since Instagram needs an image or video.

## 4. Subtitles (web page only for now)

The whole feature will be re-reviewed separately; these items wait for that.

- **Review: edit timing as well as text** (W · live test): like YouTube's subtitle editor, each line should show its start and end time and let both be changed. Example: the English line "And it is very important for" was on screen for 0.6 s and flashed by. Still open: whether adding, deleting, merging and splitting lines are also wanted.
- **Review: two-line subtitles** (W · live test): a 35-character English line reached the edges of a vertical video when burned in. The editor's single-line text box can't add a line break. Also check the burn-in's side margins on vertical videos.
- **"Replace with SRT" removes every language** (W · live test): without warning (`pickSrt(item, true)` in `public/js/subtitles.js`). The user replaced English and lost Hindi. Decide with the user: replace one language only, or ask first.

## 5. Composing and layout

- **"Post to" pills look like the tabs** (W · live test, design first): the pills choose platforms; the tabs right below (All / YouTube / X / Instagram) open each platform's settings. The user keeps clicking a pill when they mean the tab, which also unselects the platform.
- **Thumbnail title tool** (B · live test, design first): add a title to an existing thumbnail inside the app. The user does this today in a separate Claude conversation ("Add caption to thumbnails"); ask what it does and what goes wrong. The previews already know the safe areas: an Instagram cover keeps 7.5–92.5% of the width and 21.875–78.125% of the height (`.safe-box` in `styles.css`); the Shorts player covers the bottom 25%. Hindi needs Nirmala UI on Windows.
- **Rethink image handling on the phone** (P · phone test, 2026-11-17, design first): photos taken on a phone are often too big for the platforms (Instagram 8 MB, X 5 MB, YouTube thumbnails 2 MB), so in practice photos and thumbnails can't be posted from the phone. Today the app takes photos as they are (`quality: 1` in `Compose.js`) and only reports the size. This revisits the thumbnail decision in AGENTS.md ("never shrink it for the user"); discuss the options with the user first.
- **Posts screen redesign** (P · idea, 2026-11-17, design first): the app's landing screen feels crude, just the working screen. Suggested: New post as a round plum ＋ button at the bottom right; the "Connected to laptop" line as a small green/amber chip by the Laptop link; rows with a photo thumbnail, the start of the text and platform logos, grouped under Ready, On the laptop and Finished; an empty screen with the Ring of fire mark and a line on how posting works; a splash screen like traditional apps; a small Ring of fire burst when a post goes live (on the web app too).

## 6. Phone ↔ laptop

- **Filter the logs** (idea, 2026-11-17, lowest priority): find log lines by date/time and by a keyword or text. The logs are in `logs/server-YYYY-MM.log` and `logs/phone-YYYY-MM.log`; the phone's Activity log shows the laptop's last 500 phone lines.

## 7. Housekeeping

- **Uploads left behind by a page reload** (W · live test): reloading or closing the page with files attached leaves them in `uploads/` until the 24-hour cleanup (about 430 MB after a day of testing). The page also forgets a running subtitle job. Both are the deferred "post survives a reload" idea.
- **Automated tests for the app** (P · idea, 2026-11-18): the app has none today. Start with logic tests of the plain JS files (`sign.js`, `store.js`, `handover.js`) via `node --test`, with no new packages. Later, maybe end-to-end tests with **Maestro** on the user's own phone over `adb` (USB or Wi-Fi): it supports Expo APKs, installs on Windows and needs Java 17+ and platform-tools. Cloud phones (Maestro Cloud, EAS Workflows, BrowserStack, Firebase Test Lab) can't reach the laptop, so they'd only cover offline screens. Screen tests (Jest + React Native Testing Library) would need new dev packages, so ask first.
- **Automated tests for the web app** (W · idea, 2026-11-18): `npm test` covers the server, but nothing in `public/js/` is tested; the page is only checked by hand. Start with `node --test` for any `public/js` files that don't touch the page (check which ones). For clicks, previews and the calendar, one option is **Playwright** (drives the installed Chrome, tests are plain Node scripts); it's an npm package, so it needs the user's okay (dev-only).

## 8. New platforms and big ideas

- **Calendar from Pick a time** (B · idea, 2026-11-18): open the Calendar while picking a time, to see the whole week; for now the day strip shows the picked day.
- **Edit a scheduled post's settings in the app** (P · scheduling build): the app edits the text only; settings are edited on the web page.
- **Retry a failed scheduled post** (B · scheduling build): its files are deleted after posting, so a failed platform can't be retried from Calendar. The phone's own copy still has Send again.
- **Reddit reminder in "Finish by hand"** (idea, 2026-11-17; wanted now, see "Next up"): Reddit's API is closed to new apps (see [decisions.md](decisions.md)), so remind the user to post on Reddit by hand, like Substack: Copy text, Share for photos, and a button that opens their profile's post page. Mock it up before building.
- **Hosted server** (idea, not for now): run the server in the cloud instead of on your PC, so scheduled posts go out while the PC is off and the phone app can post from anywhere. Put off on 2026-11-16 to save costs. It needs a login on the API (today there is none, because it only listens on your PC), the `.env` keys stored on the server, and storage for uploads and queued posts that survives restarts. Instagram would no longer need the cloudflared tunnel, because the server can give Meta public media links itself. The aim is a free or pay-as-you-go plan; any plan must stay awake for scheduled posts, have enough storage and bandwidth for videos, and allow ffmpeg.
- **Settings page** (idea, 2026-11-18): change settings from the web page or the app instead of editing `.env`. Needs its own design first. Wanted:
  - **Where posts are saved** (`POSTS_DIR`).
  - **Scheduling rules** (`SCHEDULE` in `public/rules.js`): posting hours, the gaps between posts (text, image and video, and text next to an image or video), posts per day, and possibly per-platform limits.
- **Daily backup of saved posts** (idea, 2026-11-18): once scheduling keeps posts' history in `POSTS_DIR`, copy the `post.json` files (they're tiny) to a second folder each day and keep the last 30 days.

## 9. Branding: Socialifer

The brand itself (name, logo, colours, fonts, voice) is in [brand/README.md](../brand/README.md) and the one-page guide `brand/guide.html`. It's in the web app, the app and the docs since 2026-11-17.

- **README for an open source project** (from 2026-11-18): the website now points visitors to GitHub, but the README still reads as a private tool ("built by and for its author", "no other users"). Rewrite its opening for visitors, and write step-by-step setup instructions a newcomer can follow: Node, `.env`, and creating each platform's developer app and credentials (today that's only in `.env.example` comments and docs/platforms.md). Tied to the open source / license decision below.
- **Share image crop** (from 2026-11-18): WhatsApp desktop shows a small square cut from the middle of `website/share.png`, which catches the gap between the name (left) and the ring (right). Make the middle square carry the brand: ring centred, or the logo-and-name line centred without the ring. Show the user both, full size and as the square crop.
- **Website copy** (from 2026-11-18): go through the home page's text with the user line by line; it isn't final. Also decide whether the ring of platform logos stays on the home page (user unsure).
- **Social profiles:** the user's own accounts' names and pictures where the app is mentioned, with hello@socialifer.com as the contact.
- **Google branding check (parked):** appeal it when Socialifer opens to other users. Details in [brand/README.md](../brand/README.md), "Developer apps".
- **Before going public:** a trademark search in India, and a check of the Play Store and App Store for the name.
- **Open source or not:** the GitHub repo is public but has no license, so it's "all rights reserved" (readable, not reusable). Kept as is on 2026-11-17; decide later, for example MIT, together with how others would use it (run it themselves with their own developer apps, or a hosted version). The website doesn't call it open source until then.
- **Claim the handles:** @socialifer on X, Instagram, YouTube, Threads, Bluesky, LinkedIn, Reddit and Substack. The user will do this last.
- **Wordmark lockup:** one image file with the mark plus "socialifer", the text turned into outlines so it doesn't need Inter. Only needed for images (share image, profile banners, email signature); make it when those are made.
- **Sending email as @socialifer.com** (low priority): from Gmail through an outgoing mail service (for example Brevo's free plan). Receiving already works.

## 10. More ideas

- **Several accounts on one platform** (B · idea, 2026-11-19): post to more than one account on the same platform (two X accounts, say). Today each platform has one set of credentials in `.env`. Discuss before building.
