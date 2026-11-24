# Testing

What has been tried live, and what's still to try. Offline checks (`npm test`) are covered in [AGENTS.md](../AGENTS.md). When something is tried live, move it from "To test" to "Tested live" with the date; when it fails, add the problem to [backlog.md](backlog.md).

**How to test:**
- **Web page:** run `npm start`, reload the page after every server restart, and watch the terminal.
- **App:** open the installed app (or Expo Go) on the same Wi-Fi, and watch the terminal and Laptop → Activity log. App changes need the APK rebuilt (`npm run sp-mobile-apk`).

## To test

### Instagram text carousels (built 2026-11-24, [platforms.md](platforms.md))

- **Web page:** Slide style and Background being remembered for the next post; Story hidden.
- **Posting:** a one-slide post; each slide's alt text; a scheduled text post.
- **The app:** Hindi in the phone's own drawing; the rebuilt APK (tested in Expo Go so far).
- **Photo carousels:** the web preview's ‹ › and small slides; on the app, tapping a file and swiping.

### Scheduling (built 2026-11-18, [scheduling.md](scheduling.md))

- **Web page, writing:** Write, then Review; Back to writing; Next free time and Pick a time; the day strip (colours, clicking it picks a time), the warnings and their "next free time" link; the button's wording (Post now, Post at…, Schedule for…).
- **Web page, after:** Schedule clears the post and shows Substack's reminder; the post in Calendar and Posts; Move, Post now, Edit (text and settings) and Cancel; a post going out at its time; Posting now still shows live progress and appears in Calendar afterwards.
- **Rules:** text posts 1 hour apart; image and video posts 4 hours apart, 2 of each a day; an X text post an hour away from an X video, but not from a YouTube-only one; nothing between 11 PM and 9 AM.
- **Laptop off:** stop the server past a post's time and start it again; the post moves to the next free time, and several missed text posts go an hour apart.
- **Storage:** posts saved in `Socialifer\posts` in the user folder; any old `queue/` posts moved there on the first start.
- **YouTube at a picked time:** uploaded at once and public at the picked time, with no "make it public" item. Then update the private-upload note in [platforms.md](platforms.md).
- **App:** the two steps, When (day chips, Other…, the time dialog, the strip, warnings), the tabs, a handed post showing its time, "On the laptop. It goes out…" after Post, Calendar's Move, Post now, Edit and Cancel while connected, and web-page posts listed in Posts.
- **App, YouTube at a picked time:** Pick a time on a YouTube video from the phone.

### App fixes from phone testing (built 2026-11-19 on `fix/app-testing-bugs`)

- **Look:** Paper's controls in plum and Inter on every screen; the tab bar's icons (pencil, calendar, list).
- **Pairing on demand:** a fresh install opens on Posts with no camera prompt; drafts are saved while unpaired; the red "isn't paired" note on Posts and its Pair now; Laptop → Pair with your laptop.
- **Posts:** the ＋ button; long press to select, tap to add more, Delete (and the refusal for a post already going to the laptop); Back leaves selecting.
- **Duplicate:** the snackbar on the post's screen; Duplicate in the select bar for one post (not shown for two, or once media is removed).
- **Post to:** only set-up platforms; "Pair once to choose platforms" before pairing; an unset platform on an old post is flagged in red and blocks Next.
- **Web page:** no "+ Set up more" button.
- **APK:** its size after the arm64-only build, and that it installs and runs.
- **When:** the radios; the day chips; Pick a time starting a few minutes ahead with no "passed" message; a time after 11 PM blocks Schedule, with "Use the next free time".
- **Off hours on the web page:** the same block in Pick a time; Move to an off-hours time is refused.
- **Calendar:** the week's day buttons, the day's timeline, This week, the legend; phone posts not yet sent show (dashed grey) and open in Write; posts in the day strip while reviewing another post.
- **Finish by hand:** when unpaired, "Saved on this phone. Pair with your laptop to send it."

### Round 3 fixes (built 2026-11-19 on `fix/app-testing-bugs`; web page and app)

- **Immediately:** posts at once, even at night or right after another post; the button says Post now. Web page: with live progress.
- **Cancel:** from Calendar (web and app) and a post's own screen in the app; the post stays, marked Cancelled, on both; its slot is free again.
- **Delete:** a waiting, finished and cancelled post, from the web page, the app's list (long press) and its own screen; gone from both after the next sync; the YouTube note when YouTube has the video; the app refusing while away from the laptop.
- **Calendar:** web week grid (days by hours, today, the red now line, the side panel's summary); app day view; Scheduled · Posted · Cancelled looks; two posts at the same time side by side; This week; the ⓘ.
- **Posts:** web filter pills with counts; app sections.
- **App:** Posts · Calendar tabs; Write full screen; Save as draft; red, orange and grey messages.
- **Round 4 (2026-11-24):** the Calendar key's sample chips (web and app); the app's Today button (disabled only on today); Share text copying too, with its note; the app in the launcher's Productivity group; the `+05:30` on log lines and a `timing` line per finished post (made, reached, scheduled, posted).
- **Branding:** the splash (plum, white mark and "socialifer", not cut off by Android's circle); the mark before the Posts and Calendar titles; the mark in the empty states.
- **Web page:** Pick a time starting a few minutes ahead; "Choose a day and a time" grey.

### App (phone)

- **The rebranded APK** (built 2026-11-17): the Ring of fire icon and the name Socialifer, pairing the new app (package `com.socialifer.app`), Inter on every screen, and a post. Then uninstall the old Social Post app.
- **The laptop refusing a post:** it returns to draft with the reason; a failed try shows "last try failed" on the post.
- **Video and multi-file hand-over:** a video over the platform's size limit (compressed), several files, and resuming after Wi-Fi drops mid-upload.
- **Previews:** YouTube regular and Short, Instagram Story, Reel, feed and carousel.
- **Media cleanup** a week after posting.
- **LinkedIn from the phone:** LinkedIn showing in "Post to" after the laptop check, a text post, and a non-JPEG/PNG/GIF photo flagged before Post.
- **Built 2026-11-17, needs the APK rebuilt:** placeholders in light and dark mode (compose box, YouTube's title hint); the date dialogs for Recording date, and Clear; Delete on a ready post (and its refusal once sending has started); Duplicate post (hidden once media is pruned); logos in the posts list (failed platforms greyed), the "Post to" pills (TalkBack reads the name) and the cards.
- **Finish by hand on the phone:** the dialog mentions YouTube's link, and the finished post shows it until Done ("Finish by hand" in the posts list until then).
- **Microphone:** the app no longer asks for it (Android's App info → Permissions).

### Web page

- **Finish by hand:** a retry (YouTube item only).
- **Private default:** Visibility starts at Private on every post, even after choosing Public on the last one.
- **Old Audio language:** a saved language outside Hindi/English (e.g. French) shows as Not set; the server refuses one sent anyway.
- **Thumbnail over 2 MB:** the message gives its size and what to do.

### Subtitles

- Several videos in one post, Stop during a run, a leftover run after a server restart, a burn-in that also has to fit a size limit, and the platforms besides YouTube, X and Instagram.
- transcribe's messages appear live in the terminal as `[subtitles]` lines.

### Platforms

- **Never posted to:** Bluesky, Mastodon, Threads, Facebook and Telegram. Discord only against a mock. Each one's main risk is in "Verification status" in [platforms.md](platforms.md).
- **LinkedIn:** one photo, several photos (`multiImage`) and a video.
- **Instagram trial reels:** once the account has 200 followers (see Instagram in [platforms.md](platforms.md)).

## Tested live

### Instagram text carousels (2026-11-24, web page)

- **Web page:** the note, Slide style and Background, the laptop's preview (‹ ›, clicking a small slide, back to slide 1 on a new style), paragraphs kept together, Hindi in every style, over 10 slides blocked.
- **Posting:** a text-only carousel posted to Instagram from the web page.
- **The app, in Expo Go:** the pickers, the laptop's slides, the phone's own drawing offline (every background matched), Cover first keeping a long first sentence whole, tapping a slide to open it full width and swiping, and a text post from the phone going out as a 4-slide carousel (with X in the same post).

### Platforms

- **X:** text post (2026-11-04); a 447 MB video in 107 parts (2026-11-04; X dropped the connection once, ECONNRESET, and the part retry recovered); Made with AI label and alt text on an image post (2026-11-17).
- **Instagram:** a Reel from a 447 MB video, compressed to fit 300 MB and fetched through the cloudflared tunnel (2026-11-04).
- **YouTube:** a private test upload (2026-11-04). A public video went public at once (2026-11-18), so the forced-private lock may not apply any more; check with a scheduled video.
- **LinkedIn:** a text post with a hashtag and brackets (2026-11-17).

### Web page

- **Subtitles (2026-11-12, one 54-second vertical Hindi talk):** generating Hindi and English, an uploaded SRT with its language, Review lines, two YouTube caption tracks with their real languages (`captions.insert`), and the burned-in English copy on X and Instagram.
- **Finish by hand (2026-11-18):** the dialog with the YouTube Studio link and the Substack part.

### App (2026-11-19)

- **Share text for Substack:** on a text post, the share sheet opened, and picking Substack opened its app with the text filled in.

### App (2026-11-17)

- **Connection:** pairing, the laptop check with Wi-Fi off and on, the installed APK connecting, and the activity log's Connected line.
- **X:** an offline draft handed over and posted; a 4-part thread (thread count, preview with the empty line before each number, terminal and hand-over lines, the result link).
- **YouTube:** a 32 MB video titled from the first line, and one with a typed title, tags, Private and a custom thumbnail.
- **Instagram:** a photo with alt text, and a Reel with an uploaded cover made with Send again.
- **Substack reminder:** Copy text, Share for a photo, Done, "Posting now" or "Saved…" after Post, no Share for videos, and Back not closing it.
