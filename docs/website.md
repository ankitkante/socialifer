# socialifer.com

The public website: plain HTML and CSS, no build step, no scripts.

- **Pages:** `index.html` (home), `privacy.html` (privacy policy; `#delete-data` is the data-deletion link for Meta), `terms.html` (terms of service), `404.html`.
- **Hosting:** Cloudflare Pages project `socialifer` (https://socialifer.pages.dev), output folder `website/`, no build command. It serves `privacy.html` at `/privacy` and uses `404.html` for missing pages.
- **Updating:** for now, upload the `website` folder again under the project's Deployments → Create deployment. It isn't connected to GitHub yet.
- **Domains:** socialifer.com and www.socialifer.com are the project's custom domains. A Cloudflare redirect rule ("Redirect from WWW to root", 301, query string kept) sends www to socialifer.com. socialifer.in forwards to socialifer.com at GoDaddy.
- **Google Search Console:** socialifer.com is verified as a Domain property (TXT record in Cloudflare DNS), with `https://socialifer.com/sitemap.xml` submitted.
- **`_headers`:** response headers for Cloudflare Pages (strict CSP: the site loads nothing from other domains). Not served as a file.
- **SEO:** `robots.txt`, `sitemap.xml`, a canonical URL, description and Open Graph tags per page, and JSON-LD on the home page.
- **Icons:** copies of `brand/favicon.*`, `brand/png/apple-touch-icon-180.png` and `brand/png/app-icon-512.png` (Cloudflare only publishes this folder). Copy them again if the brand files change.
- **Keep it true:** the privacy policy describes what the app really does (scopes, how long files and logs are kept). Update it, its date and `sitemap.xml`'s `lastmod` when that changes.
- **Preview locally:** `npx serve website` gives the clean URLs; opening the files directly works too, but `/privacy` links won't.
