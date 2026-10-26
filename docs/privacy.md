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

The public dolegram homepage offers optional Google Analytics 4 measurement. If you select **Allow analytics**, Google receives page visits, referring website origins, browser/device information, approximate location derived by Google, session identifiers, and predefined interactions such as installation-link clicks, successful prompt copies, repository clicks, and demo replays. Google receives your IP address as part of the network connection. No Telegram or Dot messages, Bot credentials, clipboard contents, or installation prompt text are included in our analytics events.

Before you allow analytics, the site does not load the Google tag or send analytics requests. Advertising features are disabled. Our page-location field excludes query strings and fragments. Our referrer field excludes referring paths and queries. A local preference remembers your choice; analytics cookies are scoped to this website and expire after 90 days unless refreshed. Choose **Analytics settings** in the footer and **No thanks** to stop future collection and remove this site's analytics cookies. This does not delete previously collected reports.

See [how Google uses information from sites that use its services](https://policies.google.com/technologies/partner-sites). GitHub Pages hosting and normal browser/network requests remain separate from optional analytics. The Bot application itself has no Google Analytics integration.
