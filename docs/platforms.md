# Platform reference

How each integration works, what it relies on, and what's still unverified. Limits are enforced in `public/rules.js` using the `limit` and `media` fields in each `platforms/*.js` module. If a platform changes its limits, update the module, the README table, and this file.

## Verification status

As of 2026-11-04, every flow has been checked offline: request order and payload shapes against stubbed `fetch`, and the end-to-end server path against a local mock API. YouTube has also been confirmed on a live channel; the rest haven't been run against a live account yet. Update this table as platforms are confirmed.

| Platform | Live-tested | Main risk |
|---|---|---|
| X | No | Whether OAuth 1.0a user keys are accepted by the **v2** media upload endpoints (the docs only show OAuth 2.0 Bearer user tokens; the API spec lists OAuth 1.0a `UserToken` too). If uploads return 401/403, switch media upload to OAuth 2.0 with the `media.write` scope. |
| Bluesky | No | Video is uploaded with plain `uploadBlob`, which Bluesky's tutorial calls the easiest option. The alternative is the video service (`video.bsky.app`, `app.bsky.video.uploadVideo`). The account must have a verified email to post video. |
| Mastodon | No | Low. The API is stable. Limits vary per server. |
| Threads | No | Media URLs must be reachable by Meta through `PUBLIC_BASE_URL`. |
| Instagram | No | Same as Threads. Also, `me` as the user id is assumed to work with Instagram Login tokens; set `INSTAGRAM_USER_ID` if it doesn't. |
| YouTube | **Yes** (2026-11-04, private test upload) | Uploads from an API project YouTube hasn't audited are forced to private. Refresh tokens expire after 7 days while the OAuth consent screen is in Testing mode. |
| LinkedIn | No | The `LinkedIn-Version` header expires after about a year (default `202510`). |
| Facebook | No | Low. Uses the standard Graph endpoints. |
| Telegram | No | Low. |
| Discord | Partly | The webhook multipart format matched a mock. |

## X

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
- **Media:** sent as `image_url` or `video_url`. **This needs `PUBLIC_BASE_URL`.** Carousels take 2 to 20 child containers (`is_carousel_item=true`), then a `CAROUSEL` container with `children`. Images and videos can be mixed.
- **Limits:** 500 characters.

## Instagram

- **Auth:** "Instagram API with Instagram Login" token (`instagram_business_basic`, `instagram_business_content_publish`) against `graph.instagram.com`. Set `INSTAGRAM_GRAPH_HOST=https://graph.facebook.com` to use a Facebook Login token instead. Requires a Business or Creator account.
- **Flow:** `POST /{user}/media` creates a container, then the module polls `status_code` until `FINISHED` and calls `POST /{user}/media_publish`. A single image uses `image_url`. A single video is a Reel (`media_type=REELS`, `video_url`). Carousels take 2 to 10 children (`media_type=VIDEO` for video children), then a `CAROUSEL` container.
- **Requirements:** at least one image or video, JPEG-only images, and `PUBLIC_BASE_URL`. Captions are limited to 2,200 characters. Accounts can publish 50 posts per 24 hours.
- **Not used:** resumable direct upload (`rupload.facebook.com`) only works for Facebook Login for Business apps, and images still need URLs.
- **Docs:** https://developers.facebook.com/docs/instagram-platform/content-publishing

## YouTube

- **Auth:** OAuth 2.0 only (API keys can't upload). It uses a Desktop app OAuth client with the `youtube.upload` scope. `scripts/youtube-auth.js` (`npm run youtube-auth`) runs the loopback redirect and PKCE flow with `access_type=offline` and `prompt=consent`, then writes `YOUTUBE_REFRESH_TOKEN` into `.env`. Each post exchanges the refresh token for an access token at `oauth2.googleapis.com/token`.
- **Upload:** a resumable upload. It first sends `POST https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status` with the JSON metadata and the `X-Upload-Content-Type` and `X-Upload-Content-Length` headers. The upload session URL comes back in the `Location` header, and the file is sent there with a single `PUT` (60-minute timeout). The response is the video resource. YouTube processes the video after the upload, so nothing is polled.
- **Metadata:** the `snippet.title` comes from `options.title`, falling back to the post's first non-empty line, and must be 100 characters or less. The `snippet.description` is the post text, up to 5,000 characters. `snippet.categoryId` is `YOUTUBE_CATEGORY_ID` (default `22`). `status.privacyStatus` comes from the UI and falls back to `private`. `status.selfDeclaredMadeForKids` is also set. The title and description can't contain `<` or `>`.
- **Per-platform options:** this is the only platform that uses the third `post()` argument. The UI sends `options.youtube = { title, privacy, madeForKids }`.
- **Shorts:** there's no separate API. YouTube classifies a video as a Short if it's vertical or square and 3 minutes or less. The UI reads the video's metadata in the browser to tell the user which it will be.
- **Private lock:** videos uploaded by unverified API projects created after 2020-07-28 are restricted to private until the project passes YouTube's compliance audit. Sending `privacyStatus: public` doesn't override it.
- **Quota:** the default quota is 10,000 units per day. Third-party sources say upload cost dropped from 1,600 units to about 100 in December 2025. Check the current cost in the Cloud Console if uploads start failing with `quotaExceeded`.

## LinkedIn

- **Auth:** a Bearer token with `w_member_social` (or `w_organization_social`). The author is `urn:li:person:<sub>` or `urn:li:organization:<id>`. Every call sends the `LinkedIn-Version` (default `202510`) and `X-Restli-Protocol-Version: 2.0.0` headers.
- **Text:** `commentary` uses LinkedIn's "little text" format, where reserved characters (`\ | { } @ [ ] ( ) < > # * _ ~`) must be backslash-escaped or the post is silently truncated. Hashtags made only of letters and numbers become `{hashtag|\#|tag}`.
- **Images:** `POST /rest/images?action=initializeUpload`, then a `PUT` of the bytes to `uploadUrl` with the Bearer token. One image is posted as `content.media.id`, and 2 to 20 as `content.multiImage.images`.
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

## Not supported

- **Substack:** there's no official API. See "Decisions on record" in [AGENTS.md](../AGENTS.md).
