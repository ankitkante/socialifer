# Scheduling

Built 2026-11-18 on `feature/scheduling`, from the "Scheduling mockup" artifact (flow C: Write, then Review and post). Not yet tested live: see [testing.md](testing.md).

## Rules

- **Two ways to post:** **Next free time** (the laptop picks) or **Pick a time** (you pick), on the Review step of the web page and the app.
- **Posting hours:** 9 AM to 11 PM laptop time, for every post (`SCHEDULE` in `public/rules.js`). A post goes to all its platforms at once.
- **Text posts:** at least 1 hour apart (so at most 15 a day; the rest carry on from 9 AM the next day). A burst of text posts on one account looks like spam and risks the platforms' limits (2026-11-18).
- **Image and video posts share one pace:** at least 4 hours between any two, and at most 2 image posts and 2 video posts a day.
- **Text next to an image or video post:** 1 hour apart, but only when they share a platform (an X text post and an X video). Otherwise they don't hold each other back. No other per-platform counting.
- **Too close is a warning, not a block:** a picked time near another post shows the orange range on the day strip, the reason, and the next free time.
- **Laptop off:** posts only go out while the server runs. A post whose time passed while it was off (or asleep) moves to the next free time on start (`moveMissed` in `queue.js`), so missed text posts go an hour apart, not all at once.
- **YouTube at a picked time:** uploaded as soon as the laptop has the post, with YouTube's `publishAt`, so it goes public by itself; the other platforms wait for the time. With the laptop's next free time, YouTube is uploaded at that time like the others. YouTube's own Schedule field was removed.
- **Changing a waiting post:** Move, Post now, Edit (text and settings; files can't change) and Cancel. A post already on a platform is changed there: the details link to YouTube Studio. The app edits the text only; settings are edited on the web page.
- **Substack's reminder** shows right after scheduling, as for a post that goes now.
- **Posting now from the web page** keeps the live progress panel (`POST /api/post`), and the post is saved as history afterwards.

## How posts are saved

- **Where:** `POSTS_DIR`, by default `Socialifer/posts` in the user's home folder (`os.homedir()`), outside the project so `git clean` or a fresh clone can't delete it. Changing it: move the folder, set `POSTS_DIR`, restart. Posts in the old `queue/` folder move to the default folder once (not when `POSTS_DIR` is set).
- **One folder per post:** `<id>/post.json` (text, platforms, settings, `when`, `at`, state, results) and its files by number. Written to a temporary file, then renamed.
- **States:** receiving (phone files arriving) → waiting → posting → done, or unknown (cut off mid-posting, never retried).
- **Web posts:** on Schedule the server copies the uploads (media, thumbnail or cover, SRTs) into the post's folder, so the 24-hour upload cleanup can't touch them.
- **History:** a finished post's files are deleted; `post.json` stays forever. The phone's collect marks it `collected` instead of deleting it.
- **Never removed by the app:** a waiting post. The only automatic removal is a phone post whose files never all arrived within 7 days.
- **Files, not a database (2026-11-18):** a few hundred small records a year fit in memory, search works there, and the media must be files anyway. Node's SQLite is still experimental.

## Endpoints

- **Web page:** `GET /api/schedule` (every post), `POST /api/schedule` (as `/api/post`, plus `when: 'auto' | 'picked'` and `at`), `POST /api/schedule/<id>/move { at }`, `/cancel`, `/now`, and `PUT /api/schedule/<id> { text, options }`.
- **Phone:** `PUT /app/posts/<id>` also takes `when` and `at`; `GET /app/schedule`; `POST /app/posts/<id>/move|cancel|now`; `PATCH /app/posts/<id>`. All signed as before.

## Code

- **`public/rules.js`:** `postKind`, `nextFreeTime`, `slotProblems`, `dayStrip`, `formatTime`, `formatDay`.
- **`queue.js`:** the store and runner (one post at a time; YouTube uploads for picked times first; a timer for the next time; a 30-second clock check that notices sleep).
- **Web page:** `public/js/when.js` (When, the day strip, the schedule), `public/js/schedule.js` (Calendar, Posts, details, Move and Edit). The steps and views are in `main.js`; `panel.js` posts or schedules.
- **App:** `src/When.js` (When, day chips, strip), `src/Calendar.js` (Calendar, post sheet with the actions, also used by Posts), the two steps in `Compose.js`, the tabs in `App.js`; `handover.js` sends `when` and keeps the laptop's time.
