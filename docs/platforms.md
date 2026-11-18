# Platform reference

How each integration works, what it relies on, and what's still unverified. Limits are enforced in `public/rules.js` using the `limit` and `media` fields in each `platforms/*.js` module. If a platform changes its limits, update the module, the README table, and this file.

## Video length limits

Length checks only use limits we are reasonably confident in. Where a platform's current limit is unclear, it is left unchecked so valid posts aren't blocked; the platform's own error then shows in the results.

| Platform | Checked | Source / confidence |
|---|---|---|
| Instagram | Up to 15 min; 60 s for videos in a carousel | Meta Reels publishing docs. The carousel limit is the least certain. The docs' 3 s minimum isn't checked: a 2.2 s Reel posted fine on 2026-11-18. |
| YouTube | Up to 15 min (`YOUTUBE_MAX_MINUTES`) | YouTube: unverified channels are capped at 15 minutes; phone-verified channels up to 12 hours. |
| X | Up to 20 min (`X_VIDEO_MAX_MINUTES`) | X's chunked upload docs: 20 min by default, 125 min for Premium. |
| Threads | Up to 5 min | Threads API docs. |
| LinkedIn | 3 s to 30 min | LinkedIn video API docs. |
| Facebook | Up to 20 min | The simple (non-resumable) upload path used here. |
| Bluesky, Mastodon, Telegram, Discord | Not checked | Limits changed recently or vary by server. |

## Verification status

As of 2026-11-04, every flow has been checked offline: request order and payload shapes against stubbed `fetch`, and the end-to-end server path against a local mock API. YouTube has also been confirmed on a live channel; the rest haven't been run against a live account yet. Update this table as platforms are confirmed.

| Platform | Live-tested | Main risk |
|---|---|---|
| X | **Text post: yes** (2026-11-04). **Video: yes** (2026-11-04: 447 MB in 107 parts; X dropped the connection once, ECONNRESET, and the part retry recovered). **Made with AI label and alt text: yes** (2026-11-17, image post; `made_with_ai` is sent as a boolean on the first post of a thread only; alt text uses `POST /2/media/metadata` and only produces a warning if it fails) | Pay-per-use, so posts fail with a $0 balance. Whether OAuth 1.0a user keys are accepted by the **v2** media upload endpoints (the docs only show OAuth 2.0 Bearer user tokens; the API spec lists OAuth 1.0a `UserToken` too). If uploads return 401/403, switch media upload to OAuth 2.0 with the `media.write` scope. |
| Bluesky | No | Video is uploaded with plain `uploadBlob`, which Bluesky's tutorial calls the easiest option. The alternative is the video service (`video.bsky.app`, `app.bsky.video.uploadVideo`). The account must have a verified email to post video. |
| Mastodon | No | Low. The API is stable. Limits vary per server. |
| Threads | No | Media URLs must be reachable by Meta through `TUNNEL_URL`. |
| Instagram | **Yes** (2026-11-04: Reel from a 447 MB video, compressed to fit 300 MB and fetched through the cloudflared tunnel) | Media URLs must be reachable by Meta through `TUNNEL_URL`. `me` as the user id: set `INSTAGRAM_USER_ID` (required with Unified login tokens on graph.facebook.com). |
| YouTube | **Yes** (2026-11-04, private test upload) | Uploads from an API project YouTube hasn't audited are forced to private. Refresh tokens expire after 7 days while the OAuth consent screen is in Testing mode. |
| LinkedIn | **Partly** (2026-11-17, text post with a hashtag and brackets; photos and video not yet) | The `LinkedIn-Version` header expires after about a year (default `202611`, active until 16 Nov 2027). Tokens from LinkedIn's token tool last 60 days and can't be refreshed. |
| Facebook | No | Low. Uses the standard Graph endpoints. |
| Telegram | No | Low. |
| Discord | Partly | The webhook multipart format matched a mock. |

**Subtitles** (posted live on 2026-11-12, one 54-second vertical Hindi talk): generating Hindi and English with lyrics-video, an uploaded SRT with its language, Review lines, two YouTube caption tracks with their real languages (`captions.insert`), and the burned-in English copy on X and Instagram. Not yet tried: several videos in one post, Stop during a run, a leftover run after a server restart, a burn-in that also has to fit a size limit, and the platforms besides YouTube, X and Instagram.

## X

- **Console:** [console.x.com](https://console.x.com). It replaced developer.x.com. Set App permissions to Read and write first, then regenerate the Consumer Key and generate the Access Token. Tokens made before the change stay read-only.
- **Auth:** OAuth 1.0a HMAC-SHA1 user context (`X_API_KEY/SECRET`, `X_ACCESS_TOKEN/SECRET`), implemented in `oauthHeader()` and tested against X's published signature example. Query parameters are signed; JSON and multipart bodies are not.
- **Post:** `POST https://api.x.com/2/tweets` with `{ text?, media?: { media_ids } }`.
- **Media:** a chunked v2 upload for every file. It runs `POST /2/media/upload/initialize` (`media_type`, `total_bytes`, `media_category`: `tweet_image`, `tweet_gif` or `tweet_video`), then `POST /2/media/upload/{id}/append` (multipart `segment_index` and `media`, in 4 MB chunks; the server maximum is 8 MB), then `POST /2/media/upload/{id}/finalize`. If `processing_info` is returned, it polls `GET /2/media/upload?command=STATUS&media_id=` until `succeeded`. Don't send the legacy `command=INIT` form to `/2/media/upload`.
- **Limits:** 280 characters (`X_CHAR_LIMIT` for Premium, up to 25,000). Links count as 23. Up to 4 images, or 1 video or GIF. Images up to 5 MB, video up to 512 MB.
- **Docs:** https://docs.x.com/x-api/media/quickstart/media-upload-chunked

## Bluesky

- **Auth:** `com.atproto.server.createSession` with the handle and an app password, run on every post.
- **Post:** `com.atproto.repo.createRecord` with an `app.bsky.feed.post` record.
- **Rich text:** links and hashtags must be sent as facets with **UTF-8 byte** offsets (`buildFacets`). Trailing punctuation is trimmed from links, but a balanced `)` is kept, as in Wikipedia URLs.
- **Media:** `com.atproto.repo.uploadBlob` with the raw body. Images go in `app.bsky.embed.images` (up to 4, each at most 1 MB); one video goes in `app.bsky.embed.video` (at most 100 MB).
- **Docs:** https://docs.bsky.app/docs/tutorials/video

## Mastodon

- **Auth:** a Bearer token with the `write:statuses` and `write:media` scopes (`write` covers both).
- **Media:** `POST /api/v2/media` (multipart `file`). A `202` with `url: null` means the file is still processing, so the module polls `GET /api/v1/media/:id`, which answers `206` while processing, until `url` is set.
- **Post:** `POST /api/v1/statuses` with `{ status, media_ids }` and an `Idempotency-Key`.
- **Limits:** 500 characters (`MASTODON_CHAR_LIMIT`). Links count as 23. Up to 4 images or 1 video. The defaults (16 MB per image, 99 MB per video) match mastodon.social.

## Threads

- **Auth:** `THREADS_ACCESS_TOKEN` with the `threads_basic` and `threads_content_publish` permissions. The user id defaults to `me`.
- **Flow:** create a container with `POST /{user}/threads`, wait for `status=FINISHED` (`GET /{container}?fields=status,error_message`), then `POST /{user}/threads_publish`, then fetch the permalink.
- **Media:** sent as `image_url` or `video_url`. **This needs `TUNNEL_URL`.** Carousels take 2 to 20 child containers (`is_carousel_item=true`), then a `CAROUSEL` container with `children`. Images and videos can be mixed.
- **Limits:** 500 characters.

## Instagram

- **Auth:** "Instagram API with Instagram Login" token (`instagram_business_basic`, `instagram_business_content_publish`) against `graph.instagram.com`. Set `INSTAGRAM_GRAPH_HOST=https://graph.facebook.com` to use a Facebook Login token instead. Requires a Business or Creator account.
- **Flow:** `POST /{user}/media` creates a container, then the module polls `status_code` until `FINISHED` and calls `POST /{user}/media_publish`. A single image uses `image_url`. A single video is a Reel (`media_type=REELS`, `video_url`). Carousels take 2 to 10 children (`media_type=VIDEO` for video children), then a `CAROUSEL` container.
- **Requirements:** at least one image or video, JPEG-only images (the UI converts PNG and WebP to JPEG in the browser before upload; see `toJpeg` in `public/js/uploads.js`), and `TUNNEL_URL`. Captions are limited to 2,200 characters. Accounts can publish 50 posts per 24 hours.
- **Not used:** resumable direct upload (`rupload.facebook.com`) only works for Facebook Login for Business apps, and images still need URLs.
- **Docs:** https://developers.facebook.com/docs/instagram-platform/content-publishing

## YouTube

- **Auth:** OAuth 2.0 only (API keys can't upload). It uses a Desktop app OAuth client with the `youtube.upload`, `youtube.readonly` and `youtube.force-ssl` scopes. Readonly is only for checking processing before setting a thumbnail or subtitles, and force-ssl is the scope `captions.insert` requires. `scripts/youtube-auth.js` (`npm run youtube-auth`) runs the loopback redirect and PKCE flow with `access_type=offline` and `prompt=consent`, then writes `YOUTUBE_REFRESH_TOKEN` into `.env`. Each post exchanges the refresh token for an access token at `oauth2.googleapis.com/token`.
- **Upload:** a resumable upload. It first sends `POST https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status` with the JSON metadata and the `X-Upload-Content-Type` and `X-Upload-Content-Length` headers. The upload session URL comes back in the `Location` header, and the file is sent there with a single `PUT` (60-minute timeout). The response is the video resource. YouTube processes the video after the upload; nothing waits for that unless there's a custom thumbnail or subtitles.
- **Custom thumbnail:** `thumbnails.set` can only run after the upload, since it needs the video id. A thumbnail set while the video is still processing gets HTTP 200 but is then dropped (seen live on 2026-11-09, on a Short, for both a 407×727 and a 1080×1920 image). So the module polls `videos?part=processingDetails` every 5 seconds until `processingStatus` is `succeeded` (30-minute limit), then sets the thumbnail. Any failure becomes a warning, because the video is already up. A refresh token from before `youtube.readonly` was added gets `insufficientPermissions`, and the warning says to run `npm run youtube-auth` again.
- **Subtitles:** each SRT goes up after processing too, one track per language, with `captions.insert` (`POST https://www.googleapis.com/upload/youtube/v3/captions?uploadType=multipart&part=snippet`). The body is `multipart/related`: the snippet `{ videoId, language: '<code>', name: '<language name>', isDraft: false }`, then the file with overlapping lines trimmed. Each track costs 400 quota units. A failure is a warning per language, and a refresh token without `youtube.force-ssl` gets `insufficientPermissions`. Not yet verified live. Other platforms get one language burned into the video instead (`burnSubtitles` in `media.js`).
- **Metadata:** the `snippet.title` comes from `options.title`, falling back to the post's first non-empty line, and must be 100 characters or less. The `snippet.description` is the post text, up to 5,000 characters. `snippet.categoryId` is `YOUTUBE_CATEGORY_ID` (default `22`). `status.privacyStatus` comes from the UI and falls back to `private`. `status.selfDeclaredMadeForKids` is also set. The title and description can't contain `<` or `>`.
- **Per-platform options:** this is the only platform that uses the third `post()` argument. The UI sends `options.youtube = { title, privacy, madeForKids }`.
- **Shorts:** there's no separate API. YouTube classifies a video as a Short if it's vertical or square and 3 minutes or less. The UI reads the video's metadata in the browser to tell the user which it will be.
- **Private lock:** videos uploaded by unverified API projects created after 2020-07-28 are restricted to private until the project passes YouTube's compliance audit. Sending `privacyStatus: public` doesn't override it.
- **Quota:** the default quota is 10,000 units per day. Third-party sources say upload cost dropped from 1,600 units to about 100 in December 2025. Check the current cost in the Cloud Console if uploads start failing with `quotaExceeded`.

## LinkedIn

- **Auth:** a Bearer token with `w_member_social` (or `w_organization_social`). The author is `urn:li:person:<sub>` or `urn:li:organization:<id>`. Every call sends the `LinkedIn-Version` (default `202611`) and `X-Restli-Protocol-Version: 2.0.0` headers.
- **Text:** `commentary` uses LinkedIn's "little text" format, where reserved characters (`\ | { } @ [ ] ( ) < > # * _ ~`) must be backslash-escaped or the post is silently truncated. Hashtags made only of letters and numbers become `{hashtag|\#|tag}`.
- **Images:** `POST /rest/images?action=initializeUpload`, then a `PUT` of the bytes to `uploadUrl` with the Bearer token. One image is posted as `content.media.id`, and 2 to 20 as `content.multiImage.images`. Only JPEG, PNG and GIF are accepted, under 36,152,320 pixels (the pixel count isn't checked).
- **Video:** `POST /rest/videos?action=initializeUpload` (`fileSizeBytes`), then a `PUT` of each byte range from `uploadInstructions` (no auth header) while collecting the `ETag`s. Then `POST /rest/videos?action=finalizeUpload` with `uploadedPartIds`, and polling `GET /rest/videos/{urn}` until `AVAILABLE`.
- **Post:** `POST /rest/posts`. The new post's URN comes back in the `x-restli-id` header.

## Facebook

- **Auth:** a long-lived Page access token (`pages_manage_posts`, `pages_read_engagement`). The Graph version defaults to `v23.0`.
- **Text and photos:** each photo is uploaded with `POST /{page}/photos` (multipart `source`, `published=false`), then attached to `POST /{page}/feed` with `message` and `attached_media[i]={"media_fbid":...}`.
- **Video:** `POST https://graph-video.facebook.com/{v}/{page}/videos` (multipart `source`, `description`). This is a simple, non-resumable upload, capped at about 1 GB.

## Telegram

- **Auth:** a bot token from @BotFather. The bot must be an admin of the channel. `TELEGRAM_CHAT_ID` is `@channel` or a numeric id.
- **Methods:** `sendMessage` for text only, `sendPhoto`, `sendVideo` or `sendAnimation` (for GIFs) for a single file, and `sendMediaGroup` for 2 to 10 files, with `attach://fileN` references and the caption on the first item.
- **Captions:** limited to 1,024 characters. Longer text is sent as a separate `sendMessage` after the media.
- **Limits:** Bot API uploads are capped at 10 MB for photos and 50 MB for other files. Links are only returned for public chats (`chat.username`).

## Discord

- **Auth:** the webhook URL. `?wait=true` makes Discord return the created message.
- **Post:** multipart with `payload_json` (`{ content }`) and `files[i]`. Messages are limited to 2,000 characters, and to 10 files of 10 MB each on servers without boosts.
- **Links:** only built when `DISCORD_GUILD_ID` is set.

## Per-platform fields: what's unverified

These are wired to the documented API parameters but haven't been used on a live account yet:

- **X:** reply settings are left at X's default (everyone). Polls and the paid-partnership label were removed at the user's request.
- **Instagram:** trial reels map Manual to `MANUAL` and Auto to `SS_PERFORMANCE`. Untested: Instagram refuses them for small accounts (code 10, subcode 2207081, "does not meet the trial reel follower requirement"), so test them once the account has 200 followers. Instagram's [eligibility criteria](https://help.instagram.com/1013292530224018/): a public account eligible for recommendations, with at least 200 followers for a professional (business or creator) account. Collaborators, tagging people and the first comment were removed at the user's request; @mentions in the caption still link and notify.
- **YouTube:** scheduling forces `privacyStatus: private` and sets `publishAt`. With no category picked, `categoryId` is `YOUTUBE_CATEGORY_ID` or 22 (People & Blogs), YouTube's own default; Studio's upload defaults don't apply to API uploads. License, embedding, public stats and subscriber notifications are left at YouTube's defaults. Thumbnails use `thumbnails.set` with the existing `youtube.upload` scope, and a rejection (common on channels that aren't phone-verified) produces a warning rather than failing the upload.

## Not supported

- **YouTube Posts (Community):** the Data API has no way to make them (checked 2026-11-17).
- **Substack:** there's no official API, and Cloudflare blocks posting Notes from outside the browser. See [decisions.md](decisions.md).

## Adding a platform: the module contract

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

`media` items passed to `post()` are `{ id, name, type, size, duration, path, url, blob(), buffer() }`. `url` is the public URL (only set when `TUNNEL_URL` is configured). `duration` is in seconds, from ffprobe if installed, else from the browser, else `null`. A video over the platform's `videoMB` has already been swapped for a compressed copy (see `fitVideo` in `media.js`) when ffmpeg is available, so modules don't handle compression. Upload media in order and sequentially. To add a platform, create the module, register it in `platforms/index.js`, add its settings to `.env.example`, and add a row to this file and the README table.
