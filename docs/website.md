# Website

The public marketing site is static HTML, CSS and JavaScript in `docs/index.html` and `docs/web/`. GitHub Pages publishes the default branch's `/docs` folder, with `.nojekyll` disabling Jekyll. There is no custom Actions workflow, additional frontend dependency or backend connection.

Preview from the repository root with `python3 -m http.server 4173 --bind 127.0.0.1 --directory docs`. The site uses relative asset links so it works under the repository's Pages subpath.

The accent is `#7CCBFF`, background `#090B10`, and text `#F5F7FB`. The ring and centered paper plane share the same brand color. Background motion is decorative, has a pause control, respects reduced-motion preferences, and pauses when the page is hidden. The Replay interaction is a local illustration, never an actual Bot request or a response-time claim. Copy installs nothing; it copies a public prompt for the owner's Agent, with a manual-selection fallback.

Before publishing, check desktop and narrow mobile layouts, keyboard navigation, reduced motion, pause/resume, replay, clipboard success/fallback, the actual installation prompt and all links. Keep real credentials, deployment state and user messages out of the publishing folder. Changing website assets does not require restarting the Bot or Tunnel.

## Website analytics

The production homepage uses free Cloudflare Web Analytics by default, without a consent popup. The official beacon measures aggregate visits, referring sites, browser/device categories, and page performance. It does not provide custom installation-button events, conversion funnels, or UTM reports. The public site token is an identifier, not an API credential. GitHub Pages hosting and DNS are unchanged.

The loader is limited to `https://vingeraycn.github.io/dolegram/`. Local previews, forks and other paths do not load the beacon. Fork owners must replace the public token and exact host/path gate. The official script is loaded as a module; blockers are respected, with no proxy or fallback collection.

Cloudflare does not use analytics cookies, local storage or fingerprinting to track visitors. Our own local storage contains only an on/off preference. The footer's **Disable analytics** control saves an opt-out and reloads the page to unload the beacon; **Enable analytics** reverses it. Existing GA4 refusals remain opted out. Global Privacy Control, Do Not Track, or unavailable preference storage also prevent loading. Old dolegram-scoped GA cookies are removed; the former GA property has been moved to Google Analytics Trash, and no Google tag is loaded.

Test default loading, saved and legacy opt-outs, browser privacy signals, storage failures, exact production gating, scoped cookie cleanup, and preference reloads. Verify actual beacon delivery and dashboard ingestion separately. Ad blockers, privacy preferences and network failures mean reports do not represent every visitor. No-cookie measurement is not a blanket legal exemption; review applicable requirements before deploying a fork.

References: [Cloudflare Web Analytics](https://developers.cloudflare.com/web-analytics/about/), [FAQ and limitations](https://developers.cloudflare.com/web-analytics/faq/).
