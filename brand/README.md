# Socialifer brand

Decided 2026-11-17 (see section 9 of [docs/backlog.md](../docs/backlog.md)). The designs and the exploration behind them are on the canvas https://claude.ai/artifact/QCqti7p3vUfmGdzSjmGL6L (private to the owner), page "Final four".

## Name

- **Socialifer**, said so·sha·LIE·fer. "Social" + Latin "-fer", carrier: the app carries your posts to every platform.
- **Written:** "Socialifer" in sentences; lowercase "socialifer" in the wordmark.
- **Domains:** socialifer.com and socialifer.in, both registered at GoDaddy.
- **socialifer.in:** forwards to socialifer.com (GoDaddy, permanent 301); http, https and www all checked 2026-11-17.
- **socialifer.com DNS:** on Cloudflare (free plan); GoDaddy points its nameservers there. No website yet.
- **Email:** Cloudflare Email Routing forwards hello@socialifer.com to the owner's Gmail (receive only). A Gmail filter keeps it out of Spam. Sending as @socialifer.com isn't set up; it needs an outgoing mail service.

## Logo: Ring of fire

A glowing ring with sparks streaking out, like a Diwali chakri: the app sends posts out everywhere, the logo sends light out everywhere.

| File | Use |
|---|---|
| `logo.svg` | Main mark, plum, transparent background |
| `logo-on-dark.svg` | On dark backgrounds (light plum) |
| `logo-white.svg` | On plum or photos |
| `logo-small.svg` | 32 px and below: fewer, thicker sparks |
| `favicon.svg` | Browser tab; switches to light plum in dark mode |
| `app-icon.svg`, `app-icon-dark.svg` | Square app icons, full bleed (the OS rounds the corners) |
| `android-adaptive-foreground.svg` | Android adaptive icon foreground, mark inside the safe zone; background `#5b4a8b` |
| `profile-picture.svg` | Social media profile pictures (platforms crop to a circle) |
| `png/` | Ready-made PNGs: app icons (1024, 512, 192, 180 for Apple), adaptive foreground, profile pictures (1024, 400), favicons (48, 32, 16), logos (1024) |

- **Below 32 px,** use the small version; the full one blurs.
- **Don't** recolour it outside the palette, stretch it, add shadows or glows, or put the plum mark on a dark background.
- **With the name:** mark on the left, "socialifer" in Inter Bold, letter-spacing about −2%, mark about 1.5× the text height.

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
