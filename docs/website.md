# Website

The public marketing site is static HTML, CSS and JavaScript in `docs/index.html` and `docs/web/`. GitHub Pages publishes the default branch's `/docs` folder, with `.nojekyll` disabling Jekyll. There is no custom Actions workflow, additional frontend dependency or backend connection.

Preview from the repository root with `python3 -m http.server 4173 --bind 127.0.0.1 --directory docs`. The site uses relative asset links so it works under the repository's Pages subpath.

The accent is `#7CCBFF`, background `#090B10`, and text `#F5F7FB`. The ring and centered paper plane share the same brand color. Background motion is decorative, has a pause control, respects reduced-motion preferences, and pauses when the page is hidden. The Replay interaction is a local illustration, never an actual Bot request or a response-time claim. Copy installs nothing; it copies a public prompt for the owner's Agent, with a manual-selection fallback.

Before publishing, check desktop and narrow mobile layouts, keyboard navigation, reduced motion, pause/resume, replay, clipboard success/fallback, the actual installation prompt and all links. Keep real credentials, deployment state and user messages out of the publishing folder. Changing website assets does not require restarting the Bot or Tunnel.

## Website analytics

The production homepage uses GA4 (`G-YPHXN0WKW5`) only after a visitor allows analytics. The measurement ID is public configuration, not a credential. Basic consent mode prevents the Google tag from loading before consent. The footer's Analytics settings control lets visitors withdraw consent. A local preference is saved when storage is available; storage failures leave the choice session-only.

The integration is limited to `https://vingeraycn.github.io/dolegram/`. Local previews and forks do not send data to this property. Fork owners must replace both the ID and production origin/path before enabling their own analytics. No Measurement Protocol secret is needed.

| Event | Meaning |
| --- | --- |
| `page_view` | Consented homepage visit |
| `install_start` | Get started link clicked |
| `install_prompt_copy` | Installation prompt successfully copied |
| `install_prompt_copy_fallback` | Clipboard unavailable; manual copy offered |
| `install_guide_open` | Installation guide opened |
| `github_open` | Repository link clicked |
| `demo_replay` | Illustrative demo replayed |
| `how_it_works_view` | At least half the explanation section visible |

GA4 also supplies standard session and engagement events. Enhanced measurement is disabled; events are explicit, with no form text or arbitrary element values. URL query strings and fragments are excluded from page_location; referrers are reduced to origins. Advertising signals and personalization are disabled. Analytics cookies use the dolegram prefix and `/dolegram` path, with a 90-day expiry. Withdrawal disables measurement and removes only those scoped cookies. The copy event measures installation interest, not completed installation.

Validation must cover no collection before consent or after refusal, one tag/config per page after acceptance, successful copy versus manual fallback, withdrawal and saved preference, storage denial, blocked Google scripts, narrow layouts, and actual production event delivery. Google blockers and declined consent mean reports do not represent all visitors.

References: [Google basic consent mode](https://developers.google.com/tag-platform/security/guides/consent?consentmode=basic), [GA4 configuration](https://developers.google.com/analytics/devguides/collection/ga4/reference/config).
