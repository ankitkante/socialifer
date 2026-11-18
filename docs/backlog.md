# Backlog

Everything still to do: features and fixes not built, and things built but not yet tested live. Grouped by feature. Discuss each item with the user before building it; items marked "design first" need options shown first. Remove an item once it's built, tested or dropped.

**Where:** W = web app, P = app (the phone app), B = both, S = server only.
**From:** where the item came from, kept for history: *live test* (first live web test, 2026-11-12), *phone test* (phone testing, 2026-11-17), *phone build* (building the phone app, 2026-11-16 to 17), *idea* (ideas for later).

## 1. YouTube

- **Tags as chips** (B · phone test, design first, good to have): the Tags field is one comma-separated text box today. Wanted: type a tag, it becomes a chip, tap to remove.
- **Test a schedule from the phone** (P · phone build): to be tested with the app's own scheduling later.

## 2. X

- Nothing open.

## 3. Instagram

- **Text-only posts as a carousel** (idea): turn the text into an image carousel, since Instagram needs an image or video.

## 4. Subtitles (web page only for now)

The whole feature will be re-reviewed separately; these items wait for that.

- **Review: edit timing as well as text** (W · live test): like YouTube's subtitle editor, each line should show its start and end time and let both be changed. Example: the English line "And it is very important for" was on screen for 0.6 s and flashed by. Still open: whether adding, deleting, merging and splitting lines are also wanted.
- **Review: two-line subtitles** (W · live test): a 35-character English line reached the edges of a vertical video when burned in. The editor's single-line text box can't add a line break. Also check the burn-in's side margins on vertical videos.
- **"Replace with SRT" removes every language** (W · live test): without warning (`pickSrt(item, true)` in `public/js/subtitles.js`). The user replaced English and lost Hindi. Decide with the user: replace one language only, or ask first.
- **Test:** several videos in one post, Stop during a run, a leftover run after a server restart, a burn-in that also has to fit a size limit, and the platforms besides YouTube, X and Instagram.

## 5. Composing and layout

- **"Post to" pills look like the tabs** (W · live test, design first): the pills choose platforms; the tabs right below (All / YouTube / X / Instagram) open each platform's settings. The user keeps clicking a pill when they mean the tab, which also unselects the platform.
- **Thumbnail title tool** (B · live test, design first): add a title to an existing thumbnail inside the app. The user does this today in a separate Claude conversation ("Add caption to thumbnails"); ask what it does and what goes wrong. The previews already know the safe areas: an Instagram cover keeps 7.5–92.5% of the width and 21.875–78.125% of the height (`.safe-box` in `styles.css`); the Shorts player covers the bottom 25%. Hindi needs Nirmala UI on Windows.
- **Rethink image handling on the phone** (P · phone test, 2026-11-17, design first): photos taken on a phone are often too big for the platforms (Instagram 8 MB, X 5 MB, YouTube thumbnails 2 MB), so in practice photos and thumbnails can't be posted from the phone. Today the app takes photos as they are (`quality: 1` in `Compose.js`) and only reports the size. This revisits the thumbnail decision in AGENTS.md ("never shrink it for the user"); discuss the options with the user first.
- **Posts screen redesign** (P · idea, 2026-11-17, design first): the app's landing screen feels crude, just the working screen. Suggested: New post as a round plum ＋ button at the bottom right; the "Connected to laptop" line as a small green/amber chip by the Laptop link; rows with a photo thumbnail, the start of the text and platform logos, grouped under Ready, On the laptop and Finished; an empty screen with the Ring of fire mark and a line on how posting works; a splash screen like traditional apps; a small Ring of fire burst when a post goes live (on the web app too).
- **Drafts and post history** (W · idea): deferred for the web page. The phone app keeps its own drafts, and its finished posts act as a simple history.

## 6. Phone ↔ laptop

- **Filter the logs** (idea, 2026-11-17, lowest priority): find log lines by date/time and by a keyword or text. The logs are in `logs/server-YYYY-MM.log` and `logs/phone-YYYY-MM.log`; the phone's Activity log shows the laptop's last 500 phone lines.
- **Staggered sending** (phone build): to be discussed, then scheduling (see section 8).

### Not yet tested (app and web app)

Built but not tried live. Once one is confirmed, move it to "Tested live" in [mobile.md](mobile.md).

**How to test:** run `npm start` on the laptop, open the installed app on the same Wi-Fi, and watch the terminal and Laptop → Activity log. For the web app, reload it after restarting the server.

**Still to test:**
- **The rebranded APK** (built 2026-11-17): the Ring of fire icon and the name Socialifer, pairing the new app (package `com.socialifer.app`), Inter on every screen, and a post. Then uninstall the old Social Post app.
- **Platform settings reaching a platform:** a YouTube schedule (see section 1). Instagram Stories skipped: the user won't use them.
- **The laptop refusing a post:** it returns to draft with the reason; a failed try shows "last try failed" on the post.
- **Video and multi-file hand-over:** a video over the platform's size limit (compressed), several files, and resuming after Wi-Fi drops mid-upload.
- **Previews:** YouTube regular and Short, Instagram Story, Reel, feed and carousel.
- **Media cleanup** a week after posting.
- **LinkedIn from the phone:** LinkedIn showing in "Post to" after the laptop check, a text post, and a non-JPEG/PNG/GIF photo flagged before Post. LinkedIn's text post worked from the web page on 2026-11-17.
- **Built 2026-11-17, needs the APK rebuilt:** placeholders in light and dark mode (compose box, YouTube's title hint); the date and time dialogs for Schedule and Recording date, and Clear; Delete on a ready post (and its refusal once sending has started); Duplicate post (hidden once media is pruned); logos in the posts list (failed platforms greyed), the "Post to" pills (TalkBack reads the name) and the cards.
- **Built 2026-11-17 on `feature/quick-fixes`** (APK rebuild for the phone parts):
  - **Finish by hand:** the web page's dialog (YouTube Studio link with the Substack part) worked live on 2026-11-18. Still to test: on the phone, the dialog mentions the link and the finished post shows it until Done ("Finish by hand" in the posts list until then). Also a retry on the web page (YouTube item only) and a scheduled video (no item).
  - **Private default:** Visibility starts at Private on every post, even after choosing Public on the last one.
  - **Old Audio language:** a saved language outside Hindi/English (e.g. French) shows as Not set; the server refuses one sent anyway.
  - **Thumbnail over 2 MB:** the message gives its size and what to do.
  - **Subtitles:** transcribe's messages appear live in the terminal as `[subtitles]` lines.
  - **Microphone:** the app no longer asks for it (Android's App info → Permissions).

## 7. Housekeeping

- **Uploads left behind by a page reload** (W · live test): reloading or closing the page with files attached leaves them in `uploads/` until the 24-hour cleanup (about 430 MB after a day of testing). The page also forgets a running subtitle job. Both are the deferred "post survives a reload" idea.

## 8. New platforms and big ideas

- **LinkedIn photo and video posts** (live test): a text post worked on 2026-11-17; one photo, several photos (`multiImage`) and a video are still untested.
- **Test live:** Bluesky, Mastodon, Threads, Facebook and Telegram have never been posted to; Discord only against a mock. Details and risks are in "Verification status" in [platforms.md](platforms.md); update it there when one is confirmed.
- **Scheduling: a queue and a calendar** (idea, after the phone app's first version): write a post when the idea comes and add it to a queue; the laptop server publishes queued posts at a steady pace, in slots you set, so followers aren't flooded. A calendar shows taken and free slots, and a post can go into a specific slot. X and Instagram have no scheduling in their APIs, so the server does the publishing; YouTube can also use its own `publishAt`. Slots missed while the laptop was off are re-spaced into the next free slots, never sent all at once. Still open: how often posts go out, per platform.
- **Reddit reminder in "Finish by hand"** (idea, 2026-11-17): Reddit's API is closed to new apps (see [decisions.md](decisions.md)), so remind the user to post on Reddit by hand, like Substack: Copy text, Share for photos, and a button that opens their profile's post page. Mock it up before building.
- **Hosted server** (idea, not for now): run the server in the cloud instead of on your PC, so scheduled posts go out while the PC is off and the phone app can post from anywhere. Put off on 2026-11-16 to save costs. It needs a login on the API (today there is none, because it only listens on your PC), the `.env` keys stored on the server, and storage for uploads and queued posts that survives restarts. Instagram would no longer need the cloudflared tunnel, because the server can give Meta public media links itself. The aim is a free or pay-as-you-go plan; any plan must stay awake for scheduled posts, have enough storage and bandwidth for videos, and allow ffmpeg.

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
