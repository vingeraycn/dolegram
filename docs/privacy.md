# Data handling and publication privacy

This describes the supported local Mac route. dolegram is not offline: Telegram and the connected ChatGPT host process conversation data.

| Destination | Data and purpose |
| --- | --- |
| Telegram Bot API | The Bot token authenticates requests to Telegram. Intake retrieves messages; replies, edits, drafts and chat actions target the allowlisted private chat. |
| Host-provided MCP Events callback | Signed events include the message key, private chat ID and full incoming text. A signature is transmitted, not the signing secret. |
| ChatGPT through the private MCP Tunnel | Authorized tools return message content, identifiers, timestamps and stored reply state, and accept reply text. |
| Local configuration | Bot token, independent MCP bearer, owner and allowlist in an owner-only file. dolegram does not encrypt this file. |
| Local SQLite database | Messages, replies, delivery state, callback URLs and subscription signing secrets. File permissions protect access; dolegram does not encrypt the database. |
| macOS Keychain | The approved Tunnel runtime key when using the dedicated launcher. Other configuration and messages are not automatically stored in Keychain. |

The launcher passes the approved runtime key and upstream bearer in the dedicated client's process environment. They are not command-line literals, but remain sensitive process memory. Protect the local account and runtime. Application source has no separate analytics integration; this does not establish the behavior or retention policies of Telegram, ChatGPT, the Tunnel client, browser or operating system.

Callback transport validates public HTTPS destinations, rejects redirects, pins DNS results and verifies TLS hostnames. A custom DNS resolver, if configured, receives hostname lookups, not message bodies. Only create subscriptions through the intended host. Backend bearer possession grants privileged access; callback validation does not replace credential protection.

Retention and backups are manual. The [snapshot tool](backup.md) creates private plaintext database copies containing the same sensitive data; configuration and Keychain credentials are excluded. It never uploads snapshots or silently deletes them. Keep configuration, database, installation notes and backups out of Git and sharing workflows. Deleting a Telegram conversation does not automatically delete local dolegram records. Read [OPERATIONS.md](../OPERATIONS.md) before cleanup that could affect deduplication or reply recovery.

## Before publication

Scan the current tree and reachable historical blobs for secrets, personal paths, private conversation links, deployment identifiers and message contents. Inspect commit/tag identities and messages, branches, releases, attachments, issues, pull requests and CI logs/artifacts. `.gitignore` does not remove previously committed data.

Git author/committer names and emails are visible with published history. Use the owner's intended public identity for new public commits and assess historical metadata separately. A GitHub noreply address reduces email exposure but does not anonymize the public account.

No credential-pattern matches is evidence with limits, not a guarantee. Compare known secrets without printing them, inspect non-text assets and review data flows. Do not publish personal values in audit reports. For sensitive history, prepare an owner-approved cleanup or clean public export; never silently rewrite the working repository.

See [SECURITY.md](../SECURITY.md) and [release readiness](release-readiness.md). The experimental [Sites adapter](../sites/README.md) has separate hosted storage/identity requirements and is not the supported local installation route.

## Website analytics

The public dolegram homepage uses Cloudflare Web Analytics by default to measure aggregate visits, referring websites, browser/device categories and page performance. Cloudflare receives network requests, including your IP address in transit; its analytics service states that it does not collect or use personal data, use cookies or local storage for analytics, or fingerprint visitors. This does not mean that no data leaves your browser. See [Cloudflare Web Analytics](https://www.cloudflare.com/web-analytics/) and [Cloudflare's privacy policy](https://www.cloudflare.com/privacypolicy/).

No Telegram or Dot messages, Bot credentials, clipboard contents, or installation prompt text are sent by this integration. We do not collect custom button-click events or use advertising features. Cloudflare does not log URL query strings in Web Analytics. Hosting and ordinary browser/network requests remain separate from analytics.

Choose **Disable analytics** in the footer to save an opt-out in this browser and reload without the beacon. Choose **Enable analytics** to reverse it. Only an on/off preference is stored locally by our code. Prior GA4 refusals, Global Privacy Control and Do Not Track are respected; measurement stays off if preference storage is unavailable. Disabling stops measurement on subsequent page loads; a final beacon may be sent while the current page unloads. It does not delete previously collected aggregate reports. Browser blockers are respected.

The former GA4 integration has been removed, and its scoped cookies are cleared on visits to this homepage. Historical Google Analytics reports remain with the site owner. The Bot application itself has no website analytics integration.
