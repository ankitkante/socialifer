# Backlog

Everything still to do: features and fixes not built, and things built but not yet tested live. Grouped by feature. Discuss each item with the user before building it; items marked "design first" need options shown first. Remove an item once it's built, tested or dropped.

**Where:** W = web page, P = phone app, B = both, S = server only.
**From:** where the item came from, kept for history: *live test* (first live web test, 2026-11-12), *phone test* (phone testing, 2026-11-17), *phone build* (building the phone app, 2026-11-16 to 17), *idea* (ideas for later).

## 1. YouTube

- **Thumbnail decision:** never shrink a thumbnail for the user. They make the smaller copy themselves and so see how it looks; an automatic shrink could spoil it and the app would get the blame.
- **Tags as chips** (B · phone test, design first, good to have): the Tags field is one comma-separated text box today. Wanted: type a tag, it becomes a chip, tap to remove.
- **Test a schedule from the phone** (P · phone build): to be tested with the app's own scheduling later.
- **Posts tab** (idea): formerly Community (text, images, polls). Checked 2026-11-17: the YouTube Data API reference has no resource or method for them (`commentThreads` only makes comments), and Google hasn't announced one. They stay posted by hand.

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
- **Rethink image handling on the phone** (P · phone test, 2026-11-17, design first): photos taken on a phone are often too big for the platforms (Instagram 8 MB, X 5 MB, YouTube thumbnails 2 MB), so in practice photos and thumbnails can't be posted from the phone. Today the app takes photos as they are (`quality: 1` in `Compose.js`) and only reports the size. This revisits the thumbnail decision in section 1 ("never shrink it for the user"); discuss the options with the user first.
- **Drafts and post history** (W · idea): deferred for the web page. The phone app keeps its own drafts, and its finished posts act as a simple history.

## 6. Phone ↔ laptop

- **Filter the logs** (idea, 2026-11-17, lowest priority): find log lines by date/time and by a keyword or text. The logs are in `logs/server-YYYY-MM.log` and `logs/phone-YYYY-MM.log`; the phone's Activity log shows the laptop's last 500 phone lines.
- **Staggered sending** (phone build): to be discussed, then scheduling (see section 8).

### Not yet tested (phone and web page)

Built but not tried live. Move an item to "Already tested" once it's confirmed.

**How to test:** run `npm start` on the laptop, open the installed app on the same Wi-Fi, and watch the terminal and Laptop → Activity log. For the web page, reload it after restarting the server.

**Still to test:**
- **Platform settings reaching a platform:** a YouTube schedule (see section 1). Instagram Stories skipped: the user won't use them.
- **The laptop refusing a post:** it returns to draft with the reason; a failed try shows "last try failed" on the post.
- **Video and multi-file hand-over:** a video over the platform's size limit (compressed), several files, and resuming after Wi-Fi drops mid-upload.
- **Previews:** YouTube regular and Short, Instagram Story, Reel, feed and carousel.
- **Media cleanup** a week after posting.
- **LinkedIn from the phone:** LinkedIn showing in "Post to" after the laptop check, a text post, and a non-JPEG/PNG/GIF photo flagged before Post. LinkedIn's text post worked from the web page on 2026-11-17.
- **Built 2026-11-17, needs the APK rebuilt:** placeholders in light and dark mode (compose box, YouTube's title hint); the date and time dialogs for Schedule and Recording date, and Clear; Delete on a ready post (and its refusal once sending has started); Duplicate post (hidden once media is pruned); logos in the posts list (failed platforms greyed), the "Post to" pills (TalkBack reads the name) and the cards.
- **Built 2026-11-17 on `feature/quick-fixes`** (APK rebuild for the phone parts):
  - **Finish by hand:** a YouTube video starts Private; the web page's dialog shows the YouTube Studio link with the Substack part; on the phone, the dialog mentions the link and the finished post shows it until Done ("Finish by hand" in the posts list until then). Also a retry on the web page (YouTube item only) and a scheduled video (no item).
  - **Private default:** Visibility starts at Private on every post, even after choosing Public on the last one.
  - **Old Audio language:** a saved language outside Hindi/English (e.g. French) shows as Not set; the server refuses one sent anyway.
  - **Thumbnail over 2 MB:** the message gives its size and what to do.
  - **Subtitles:** transcribe's messages appear live in the terminal as `[subtitles]` lines.
  - **Microphone:** the app no longer asks for it (Android's App info → Permissions).

**Already tested:**
- **Connection:** pairing, the laptop check with Wi-Fi off and on, the installed APK connecting, the activity log's Connected line.
- **X:** an offline draft handed over and posted, the thread count on X's card, and (2026-11-17) a 4-part thread with its `Phone post …` terminal lines, the app's hand-over lines and the result link opening it. The thread preview (2026-11-17, with the empty line before each number).
- **YouTube (2026-11-17):** a 32 MB video with the title taken from the first line; another with a typed title, tags, Private and a custom thumbnail (two files handed over).
- **Instagram (2026-11-17):** a photo with alt text; a Reel with an uploaded cover, made with Send again after a failed try.
- **Substack reminder (2026-11-17):** Copy text, Share for a photo, Done. Later the same day, the dialog after Post: "Posting now" when connected, "Saved…" with Wi-Fi off, a video post with no Share button, and the back button not closing it.

## 7. Housekeeping

- **Uploads left behind by a page reload** (W · live test): reloading or closing the page with files attached leaves them in `uploads/` until the 24-hour cleanup (about 430 MB after a day of testing). The page also forgets a running subtitle job. Both are the deferred "post survives a reload" idea.

## 8. New platforms and big ideas

- **LinkedIn photo and video posts** (live test): a text post worked on 2026-11-17; one photo, several photos (`multiImage`) and a video are still untested.
- **Test live:** Bluesky, Mastodon, Threads, Facebook and Telegram have never been posted to; Discord only against a mock. Details and risks are in "Verification status" in [platforms.md](platforms.md); update it there when one is confirmed.
- **Scheduling: a queue and a calendar** (idea, after the phone app's first version): write a post when the idea comes and add it to a queue; the laptop server publishes queued posts at a steady pace, in slots you set, so followers aren't flooded. A calendar shows taken and free slots, and a post can go into a specific slot. X and Instagram have no scheduling in their APIs, so the server does the publishing; YouTube can also use its own `publishAt`. Slots missed while the laptop was off are re-spaced into the next free slots, never sent all at once. Still open: how often posts go out, per platform.
- **Posting to Reddit** (idea): a new platform.
- **Hosted server** (idea, not for now): run the server in the cloud instead of on your PC, so scheduled posts go out while the PC is off and the phone app can post from anywhere. Put off on 2026-11-16 to save costs. It needs a login on the API (today there is none, because it only listens on your PC), the `.env` keys stored on the server, and storage for uploads and queued posts that survives restarts. Instagram would no longer need the cloudflared tunnel, because the server can give Meta public media links itself. The aim is a free or pay-as-you-go plan; any plan must stay awake for scheduled posts, have enough storage and bandwidth for videos, and allow ffmpeg.

## 9. Branding: Socialifer (decided 2026-11-17)

Decided in the branding thread. The designs are on the canvas https://claude.ai/artifact/QCqti7p3vUfmGdzSjmGL6L (private to the user), page "Final four". The app still says "Social Post" everywhere.

- **Name:** Socialifer (so·sha·LIE·fer): "social" + Latin "-fer", carrier. socialifer.com and socialifer.in are registered; socialifer.app was skipped (too expensive).
- **Logo:** Ring of fire, a glowing ring with sparks streaking out, like a Diwali chakri. The app sends posts out everywhere; the logo sends light out everywhere. Small sizes (tab icon) use a simpler version with fewer, thicker sparks. It can read as a sun; accepted.
- **Colour:** Dusk Plum `#5b4a8b`, `#b3a4e6` in the dark theme. Replaces today's blue.
- **Fonts:** Inter for English, Noto Sans Devanagari for Hindi.
- **Voice:** friendly when things go well (a post went out), calm everywhere else (errors, buttons, empty screens).

To do, in suggested order:
- **Website and privacy policy:** live 2026-11-17 at https://socialifer.com (see [website.md](website.md)): home, privacy policy with data deletion, terms, SEO files. Domain verified in Google Search Console and sitemap submitted. Still to do: connect the Pages project to GitHub so it updates on push (it was uploaded by hand).
- **Website redesign:** the home page works but looks poor (2026-11-17, user: "terrible right now"). Redesign it, mockup first, once the site is live and the developer apps are done.
- **Use hello@socialifer.com:** after the website exists. Put it where people and reviewers look for a contact, such as the website, the privacy policy, the developer apps' support email, and the social profiles. Decide where with the user.
- **Developer apps:** rename and re-logo the apps on Google Cloud (YouTube), Meta, X and LinkedIn; their names show on sign-in screens. Logo: `brand/png/app-icon-192.png` (512 where bigger is accepted). Done except Google, which is parked.
  - **Meta (done 2026-11-17):** display name Socialifer, icon, contact hello@socialifer.com, privacy and terms links, and the data deletion instructions URL `https://socialifer.com/privacy#delete-data`. The app stays unpublished (development mode): App Review is only needed when other people use Socialifer, like Google's verification.
  - **X (done 2026-11-17):** app named Socialifer with the icon and description; website, organization, terms and privacy links set; the unused callback URI changed from the user's personal site to https://socialifer.com. Permissions untouched, so the `.env` tokens still work.
  - **LinkedIn (done 2026-11-17):** app named Socialifer with the logo and privacy link. Its required Company Page, "Social Post", was renamed to Socialifer with the profile-picture logo, a description and the website. The tagline "Write once. Post everywhere." (also the homepage headline) isn't final.
  - **Google (parked 2026-11-17):** project renamed; Branding page saved with the name Socialifer, the logo, the socialifer.com home, privacy and terms links, and `socialifer.com` as an authorized domain. The automatic brand check rejected the logo ("does not uniquely identify your brand"), even after the website header was changed to the same plum-square icon. The appeal's questionnaire asks whether the app is for personal use only, and Google doesn't review personal-use apps in production. That's the truth today, so it was parked: the branding only shows to other people signing in, and YouTube posting works without it. **Verify the Google branding when Socialifer opens to other users** (appeal with "the finding is incorrect": it's Socialifer's own original mark, imitating no other brand, and the same logo appears next to the name on every page of the verified socialifer.com and as its favicon).
- **Social profiles:** the user's own accounts' names and pictures, where the app is mentioned.
- **Brand in the app** (B): name, logo, colours and fonts on the web page and the phone app. Watch for:
  - **Phone package** `com.socialpost.app`: a new package name is a new app to Android, so it has to be paired again. Easier now than later.
  - **Saved settings** use `social-post:` keys in `localStorage`; carry them over, or the user's saved choices are lost.
  - **Renames:** the repo, README and docs, and the `~/Videos/Social Post` folder.
- **Before going public:** a trademark search in India, and a check of the Play Store and App Store for the name.
- **Open source or not:** the GitHub repo is public but has no license, so it's "all rights reserved" (readable, not reusable). Kept as is on 2026-11-17; decide later, for example MIT. The website doesn't call it open source until then.
- **Nice to have:** a one-page brand guide (logo, colours, fonts, voice, dos and don'ts); a share image for socialifer.com; a small burst animation when a post goes live (design first).
- **Claim the handles:** @socialifer on X, Instagram, YouTube, Threads, Bluesky, LinkedIn, Reddit and Substack. The user will do this last.
- **Wordmark lockup:** one image file with the mark plus "socialifer", the text turned into outlines so it doesn't need Inter installed. Only needed for images (share image, profile banners, email signature); the website uses the mark next to live text. Make it when those images are made.
- **Sending email as @socialifer.com:** from Gmail, through an outgoing mail service (for example Brevo's free plan). Low priority: receiving is what matters, and it works (Cloudflare Email Routing to the user's Gmail since 2026-11-17; see [brand/](../brand/README.md)).
