# socialifer.com

The public website: plain HTML and CSS, no build step, no scripts.

- **Pages:** `index.html` (home), `privacy.html` (privacy policy; `#delete-data` is the data-deletion link for Meta), `terms.html` (terms of service), `404.html`.
- **Hosting:** Cloudflare Pages project `socialifer-site` (https://socialifer-site.pages.dev), connected to the GitHub repo; output folder `website`, no build command, no root directory. It serves `privacy.html` at `/privacy` and uses `404.html` for missing pages.
- **Updating (since 2026-11-18):** pushing to `main` deploys the site; other branches get preview deployments. Build watch paths include only `website/*`, so pushes that don't touch the site don't deploy. (In that field, press Enter after the path or Save stays disabled.)
- **Why a new project:** the first project (`socialifer`) was Direct Upload, which Cloudflare can't switch to Git; it was deleted and its `pages.dev` name stayed reserved, hence `socialifer-site`.
- **Domains:** socialifer.com is the project's custom domain (a proxied CNAME to `socialifer-site.pages.dev`). www.socialifer.com isn't on the project: a proxied placeholder A record (`www` → `192.0.2.1`) lets the redirect rule "Redirect from WWW to root" (301, query string kept) send it to socialifer.com. Without that record the rule never runs. socialifer.in forwards to socialifer.com at GoDaddy.
- **Google Search Console:** socialifer.com is verified as a Domain property (TXT record in Cloudflare DNS), with `https://socialifer.com/sitemap.xml` submitted.
- **`_headers`:** response headers for Cloudflare Pages (strict CSP: the site loads nothing from other domains). Not served as a file.
- **Scripts:** the site has none of its own, but the CSP allows same-site scripts (`script-src 'self'`) so Cloudflare's Email Address Obfuscation can decode the addresses it hides. With `'none'`, every address showed as "[email protected]" (fixed 2026-11-18).
- **No inline styles:** the CSP's `style-src 'self'` blocks `style="…"` attributes, so all styling is classes in `styles.css`.
- **Design (2026-11-18):** "Ring of fire" layout: big headline, the logo with the 10 platform logos around it (Simple Icons, as in `public/icons`), numbered features, a privacy statement. Chosen from four mockups on the "Socialifer website redesign" canvas, https://claude.ai/artifact/1HmAfSYVCkSDxbYDhp1Hm6 (private to the owner).
- **Theme:** follows the visitor's system setting (`prefers-color-scheme`), no toggle. Colour tokens are on `:root` in `styles.css`.
- **Fonts:** `fonts/` holds copies of `public/fonts` (Inter, Noto Sans Devanagari), because the CSP blocks Google Fonts.
- **Share image:** `share.png` (1200×630, dark): the picture shown when a page is shared on WhatsApp, X or LinkedIn (`og:image`, `summary_large_image`). Logo and name on one line, socialifer.com, and the home page's ring of platforms (no copy, until the site's copy is final); remake it if the platforms change.
- **SEO:** `robots.txt`, `sitemap.xml`, a canonical URL, description and Open Graph tags per page, and JSON-LD on the home page.
- **Icons:** copies of `brand/favicon.*`, `brand/png/apple-touch-icon-180.png` and `brand/png/app-icon-512.png` (Cloudflare only publishes this folder). Copy them again if the brand files change.
- **Keep it true:** the privacy policy describes what the app really does (scopes, how long files and logs are kept). Update it, its date and `sitemap.xml`'s `lastmod` when that changes.
- **Preview locally:** `npm run website` serves it at http://localhost:4000 (`WEBSITE_PORT` to change) like Cloudflare does: clean URLs, `404.html`, and the `_headers` CSP, so a blocked style shows up locally too (`scripts/website.js`).
