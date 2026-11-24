# Socialifer brand

**One-page guide:** `guide.html`, published at https://claude.ai/artifact/983ztzcSQY5nsdyQBvReRJ (private to the owner; share it from its Share menu). Keep it in step with this README.

Decided 2026-11-17 (see section 9 of [docs/backlog.md](../docs/backlog.md)). The designs and the exploration behind them are on the canvas https://claude.ai/artifact/QCqti7p3vUfmGdzSjmGL6L (private to the owner), page "Final four".

## Name

- **Socialifer**, said so·sha·LIE·fer. "Social" + Latin "-fer", carrier: the app carries your posts to every platform.
- **Written:** "Socialifer" in sentences; lowercase "socialifer" in the wordmark.
- **Domains:** socialifer.com and socialifer.in, both registered at GoDaddy.
- **socialifer.in:** forwards to socialifer.com (GoDaddy, permanent 301); http, https and www all checked 2026-11-17.
- **socialifer.com DNS:** on Cloudflare (free plan); GoDaddy points its nameservers there. The website is on Cloudflare Pages (see [docs/website.md](../docs/website.md)).
- **Email:** Cloudflare Email Routing forwards hello@socialifer.com to the owner's Gmail (receive only). A Gmail filter keeps it out of Spam. Sending as @socialifer.com isn't set up; it needs an outgoing mail service.

## Developer apps

Renamed and re-logoed on 2026-11-17, because their names show on sign-in screens. Logo: `png/app-icon-192.png` (512 where bigger is accepted).

- **Meta:** display name Socialifer, icon, contact hello@socialifer.com, privacy and terms links, and the data deletion URL `https://socialifer.com/privacy#delete-data`. It stays in development mode: App Review is only needed once other people use Socialifer.
- **X:** named Socialifer with the icon and description; website, organization, terms and privacy links set; the unused callback URI is https://socialifer.com. Permissions untouched, so the `.env` tokens still work.
- **LinkedIn:** named Socialifer with the logo and privacy link. Its required Company Page (formerly "Social Post") is Socialifer, with the profile-picture logo, a description and the website. The tagline "Write once. Post everywhere." (also the website's headline) isn't final.
- **Google (parked):** project renamed; Branding page saved with the name, logo, socialifer.com home, privacy and terms links, and `socialifer.com` as an authorized domain. The automatic brand check rejected the logo ("does not uniquely identify your brand"). Its appeal asks whether the app is for personal use only, and Google doesn't review personal-use apps, so it was parked: the branding only shows to other people signing in, and YouTube posting works without it. When Socialifer opens to others, appeal with "the finding is incorrect": it's Socialifer's own original mark, imitating no other brand, shown next to the name on every page of the verified socialifer.com and as its favicon.

## Logo: Ring of fire

A glowing ring with sparks streaking out, like a Diwali chakri: the app sends posts out everywhere, the logo sends light out everywhere.

| File | Use |
|---|---|
| `logo.svg` | Main mark, plum, transparent background |
| `logo-on-dark.svg` | On dark backgrounds (light plum) |
| `logo-white.svg` | On plum or photos |
| `logo-small.svg` | 32 px and below: fewer, thicker sparks |
| `favicon.svg` | Browser tab: white mark on a plum rounded tile, so it reads on light and dark tabs alike |
| `favicon.ico` | Browser tab in old browsers: the 16, 32 and 48 px PNGs of the same tile in one file |
| `app-icon.svg`, `app-icon-dark.svg` | Square app icons, full bleed (the OS rounds the corners) |
| `android-adaptive-foreground.svg` | Android adaptive icon foreground, mark inside the safe zone; background `#5b4a8b` |
| `profile-picture.svg` | Social media profile pictures (platforms crop to a circle) |
| `png/` | Ready-made PNGs: app icons (1024, 512, 192, 180 for Apple), adaptive foreground, profile pictures (1024, 400), favicons (48, 32, 16), logos (1024) |

- **Below 32 px,** use the small version; the full one blurs.
- **Don't** recolour it outside the palette, stretch it, add shadows or glows, or put the plum mark on a dark background.
- **With the name:** mark on the left, "socialifer" in Inter Bold, letter-spacing about −2%, mark about 1.5× the text height.
- **Where copies live** (keep them in step): the web app serves its favicons from here (`/favicon.ico`, `/favicon.svg`) and has its header mark inline in `public/index.html`; the phone app's mark is `BrandMark` in `mobile/src/Logo.js`, and its icons in `mobile/assets` are copies of `png/` files; its splash (`mobile/assets/splash-logo.png`, 2026-11-19) is `png/logo-white-1024.png` with "socialifer" in Inter Bold under it, on plum, sized to fit the circle Android 12+ keeps; the website has its own copies (see [docs/website.md](../docs/website.md)).

## Colours

| Name | Hex | Use |
|---|---|---|
| Plum | `#5b4a8b` | Main colour: logo, buttons, links (white text on it) |
| Light plum | `#b3a4e6` | Main colour in the dark theme (dark text on it) |
| Ink | `#1e1b26` | Text, light theme |
| Mist | `#f5f4f7` | Background, light theme |
| Night | `#16151a` | Background, dark theme |
| Moon | `#ebe8f2` | Text, dark theme |

## Fonts

- **Inter** for English, **Noto Sans Devanagari** for Hindi. Both free on Google Fonts.
- In CSS: `font-family: Inter, 'Noto Sans Devanagari', sans-serif;`

## Voice

- **Friendly when things go well:** "Done! Your post is live on YouTube, X and Instagram."
- **Calm everywhere else:** errors, buttons, empty screens. Short, plain, no exclamation marks; say what happened, then what to do.
