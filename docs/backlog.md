# Backlog

Everything still to do: features and fixes not built, and things built but not yet tested live. Grouped by feature. Discuss each item with the user before building it; items marked "design first" need options shown first. Remove an item once it's built, tested or dropped.

**Where:** W = web page, P = phone app, B = both, S = server only.
**From:** where the item came from, kept for history: *live test* (first live web test, 2026-11-12), *phone test* (phone testing, 2026-11-17), *phone build* (building the phone app, 2026-11-16 to 17), *idea* (ideas for later).

## 1. YouTube

- **Find out why an upload came out Public** (B · phone test): a phone post with Visibility Public (2026-11-17) went live as public, though uploads are expected to be forced private until the API audit. Cause unknown (the user doesn't know of an audit). Check before building the reminder below; it may not be needed.
- **Reminder to make the video public** (B · live test): Visibility already defaults to Public, but YouTube forces uploads from an unaudited API project to private. After a YouTube upload, show a reminder with a link to that video in YouTube Studio, like the Substack reminder. Only when Public was chosen and nothing is scheduled.
- **Thumbnail over 2 MB** (B · phone test): today it's only "The thumbnail must be 2 MB or smaller", with no size given. Wanted: say its size and what to do, e.g. "The thumbnail is 3.4 MB; YouTube takes 2 MB at most. Save a smaller copy (1280×720 JPEG is plenty) and choose that." **Decision: never shrink it for the user.** They make the smaller copy themselves and so see how it looks; an automatic shrink could spoil the thumbnail and the app would get the blame.
- **Tags as chips** (B · phone test, design first, good to have): the Tags field is one comma-separated text box today. Wanted: type a tag, it becomes a chip, tap to remove.
- **Old Audio language** (W · live test): an Audio language saved before the Hindi/English list (e.g. French) isn't reset and is still sent.
- **Test a schedule from the phone** (P · phone build): to be tested with the app's own scheduling later.
- **Posts tab** (idea): formerly Community (text, images, polls). The YouTube Data API reference lists no way to create these, so for now they're posted by hand. To be double-checked in the API docs.

## 2. X

- Nothing open.

## 3. Instagram

- **Text-only posts as a carousel** (idea): turn the text into an image carousel, since Instagram needs an image or video.

## 4. Subtitles (web page only for now)

- **Live lyrics-video logs** (S · live test): show `subtitles.py`'s own messages in this server's terminal as they arrive (e.g. with a `[subtitles]` prefix). Today `subtitler.js` keeps the child's stderr only to print it when a job fails, so a running job looks silent.
- **Review: edit timing as well as text** (W · live test): like YouTube's subtitle editor, each line should show its start and end time and let both be changed. Example: the English line "And it is very important for" was on screen for 0.6 s and flashed by. Still open: whether adding, deleting, merging and splitting lines are also wanted.
- **Review: two-line subtitles** (W · live test): a 35-character English line reached the edges of a vertical video when burned in. The editor's single-line text box can't add a line break. Also check the burn-in's side margins on vertical videos.
- **"Replace with SRT" removes every language** (W · live test): without warning (`pickSrt(item, true)` in `public/js/subtitles.js`). The user replaced English and lost Hindi. Decide with the user: replace one language only, or ask first.
- **English cues can be too short** (live test): the cause and fix are recorded in lyrics-video's AGENTS.md.
- **Test:** several videos in one post, Stop during a run, a leftover run after a server restart, a burn-in that also has to fit a size limit, and the platforms besides YouTube, X and Instagram.

## 5. Composing and layout

- **"Post to" pills look like the tabs** (W · live test, design first): the pills choose platforms; the tabs right below (All / YouTube / X / Instagram) open each platform's settings. The user keeps clicking a pill when they mean the tab, which also unselects the platform.
- **Placeholders don't show** (P · phone test): neither "What do you want to post?" in the compose box nor YouTube's "Defaults to: …" title hint. No `TextInput` in `mobile/src` sets `placeholderTextColor`; the likely cause is Android's default hint colour (maybe dark mode) on the white boxes. Fix: set it everywhere, then check in light and dark mode.
- **Date and time pickers** (P · phone test): Schedule and Recording date are typed today (`YYYY-MM-DD HH:MM`). Needs a new package (`@react-native-community/datetimepicker`, approval needed) and an APK rebuild.
- **Thumbnail title tool** (B · live test, design first): add a title to an existing thumbnail inside the app. The user does this today in a separate Claude conversation ("Add caption to thumbnails"); ask what it does and what goes wrong. The previews already know the safe areas: an Instagram cover keeps 7.5–92.5% of the width and 21.875–78.125% of the height (`.safe-box` in `styles.css`); the Shorts player covers the bottom 25%. Hindi needs Nirmala UI on Windows.
- **Duplicate a post** (P · phone test): copy any post into a new draft with the same text, platforms, settings and media, then change what's needed. `copyPost` in `store.js` (used by Send again) already does this for chosen platforms. **Decision:** Duplicate is hidden once the post's media copies are pruned (`mediaRemoved`).
- **Rethink image handling on the phone** (P · phone test, 2026-11-17, design first): photos taken on a phone are often too big for the platforms (Instagram 8 MB, X 5 MB, YouTube thumbnails 2 MB), so in practice photos and thumbnails can't be posted from the phone. Today the app takes photos as they are (`quality: 1` in `Compose.js`) and only reports the size. This revisits the thumbnail decision in section 1 ("never shrink it for the user"); discuss the options with the user first.
- **Delete posts waiting to go** (P · phone test, 2026-11-17): while the laptop isn't connected, a post marked ready (or half sent) can't be deleted; Delete only shows for drafts and finished posts (`Compose.js`). Wanted: Delete for posts marked ready that haven't started going to the laptop, on the phone only; the laptop is never told. Once sending starts, there's no Delete.
- **Platform logos on the phone** (P · phone test, 2026-11-17, design first): the app is all text today. Wanted: logos (`public/icons/*.svg`, as on the web page) in the posts list, for the platforms each post is for or went to, and in the new post screen ("Post to" pills, platform cards). **Decision: logos, not names.** Drawing SVGs needs `react-native-svg` (runs in Expo Go); **approved by the user on 2026-11-17.**
- **Drafts and post history** (W · idea): deferred for the web page. The phone app keeps its own drafts, and its finished posts act as a simple history.

## 6. Phone ↔ laptop

- **Laptop status on the phone** (P + S · phone test): while connected, show what the web page's status dots show: tunnel connected, ffmpeg ready, subtitles ready. The server already works these out for `/api/status`; the phone's laptop check would need them from an `/app/*` endpoint. Most useful for Instagram, which fails without the tunnel.
- **Keep logs on the laptop** (P + S · phone test, 2026-11-17): for history and tracing problems later. Today the server logs only to the terminal (`log.js`, lost when it closes), and the phone's activity log keeps its last 500 lines on the phone and is never sent (`mobile/src/log.js`). **Decision:** keep both the server's and the phone's, and delete lines older than 6 months.
- **Staggered sending** (phone build): to be discussed, then scheduling (see section 8).

### Not yet tested on the phone

Built but not tried live. Move an item to "Already tested" once it's confirmed.

**How to test:** run `npm start` on the laptop, open the installed app on the same Wi-Fi, and watch the terminal and Laptop → Activity log.

**Still to test:**
- **Platform settings reaching a platform:** a YouTube schedule (see section 1). Instagram Stories skipped: the user won't use them.
- **The laptop refusing a post:** it returns to draft with the reason; a failed try shows "last try failed" on the post.
- **Video and multi-file hand-over:** a video over the platform's size limit (compressed), several files, and resuming after Wi-Fi drops mid-upload.
- **Previews:** YouTube regular and Short, Instagram Story, Reel, feed and carousel.
- **Media cleanup** a week after posting.

**Already tested:**
- **Connection:** pairing, the laptop check with Wi-Fi off and on, the installed APK connecting, the activity log's Connected line.
- **X:** an offline draft handed over and posted, the thread count on X's card, and (2026-11-17) a 4-part thread with its `Phone post …` terminal lines, the app's hand-over lines and the result link opening it. The thread preview (2026-11-17, with the empty line before each number).
- **YouTube (2026-11-17):** a 32 MB video with the title taken from the first line; another with a typed title, tags, Private and a custom thumbnail (two files handed over).
- **Instagram (2026-11-17):** a photo with alt text; a Reel with an uploaded cover, made with Send again after a failed try.
- **Substack reminder (2026-11-17):** Copy text, Share for a photo, Done. Later the same day, the dialog after Post: "Posting now" when connected, "Saved…" with Wi-Fi off, a video post with no Share button, and the back button not closing it.

## 7. Housekeeping

- **Uploads left behind by a page reload** (W · live test): reloading or closing the page with files attached leaves them in `uploads/` until the 24-hour cleanup (about 430 MB after a day of testing). The page also forgets a running subtitle job. Both are the deferred "post survives a reload" idea.
- **Microphone permission** (P · phone build): the APK asks for microphone access (RECORD_AUDIO), which expo-camera adds by default; the app never records. Removing it means `"recordAudioAndroid": false` in expo-camera's plugin options in `mobile/app.json` (check expo-camera's docs first), then a rebuild.

## 8. New platforms and big ideas

- **Test live:** Bluesky, Mastodon, Threads, LinkedIn, Facebook and Telegram have never been posted to; Discord only against a mock. Details and risks are in "Verification status" in [platforms.md](platforms.md); update it there when one is confirmed.
- **Scheduling: a queue and a calendar** (idea, after the phone app's first version): write a post when the idea comes and add it to a queue; the laptop server publishes queued posts at a steady pace, in slots you set, so followers aren't flooded. A calendar shows taken and free slots, and a post can go into a specific slot. X and Instagram have no scheduling in their APIs, so the server does the publishing; YouTube can also use its own `publishAt`. Slots missed while the laptop was off are re-spaced into the next free slots, never sent all at once. Still open: how often posts go out, per platform.
- **Posting to Reddit** (idea): a new platform.
- **Hosted server** (idea, not for now): run the server in the cloud instead of on your PC, so scheduled posts go out while the PC is off and the phone app can post from anywhere. Put off on 2026-11-16 to save costs. It needs a login on the API (today there is none, because it only listens on your PC), the `.env` keys stored on the server, and storage for uploads and queued posts that survives restarts. Instagram would no longer need the cloudflared tunnel, because the server can give Meta public media links itself. The aim is a free or pay-as-you-go plan; any plan must stay awake for scheduled posts, have enough storage and bandwidth for videos, and allow ffmpeg.
- **A logo** (idea): the header shows just the name "Social Post" for now. A paper plane was ruled out because so many sites use one.
