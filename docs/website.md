# Website

The public marketing site is static HTML, CSS and JavaScript in `docs/index.html` and `docs/web/`. GitHub Pages publishes the default branch's `/docs` folder, with `.nojekyll` disabling Jekyll. There is no custom Actions workflow, additional frontend dependency, analytics or backend connection.

Preview from the repository root with `python3 -m http.server 4173 --bind 127.0.0.1 --directory docs`. The site uses relative asset links so it works under the repository's Pages subpath.

The accent is `#7CCBFF`, background `#090B10`, and text `#F5F7FB`. The ring and centered paper plane share the same brand color. Background motion is decorative, has a pause control, respects reduced-motion preferences, and pauses when the page is hidden. The Replay interaction is a local illustration, never an actual Bot request or a response-time claim. Copy installs nothing; it copies a public prompt for the owner's Agent, with a manual-selection fallback.

Before publishing, check desktop and narrow mobile layouts, keyboard navigation, reduced motion, pause/resume, replay, clipboard success/fallback, the actual installation prompt and all links. Keep real credentials, deployment state and user messages out of the publishing folder. Changing website assets does not require restarting the Bot or Tunnel.
