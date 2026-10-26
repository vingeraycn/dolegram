# Public beta scope and release checks

The owner approved v0.1.0 as a public beta. Independent-account installation and broader recovery acceptance remain follow-up gates for stronger reliability claims, not completed tests. The README sentence opens the [desktop Agent guide](desktop-install.md), which checks local capabilities and explains owner participation. INSTALL.md is the technical runbook; TUNNEL.md, the Keychain guide, Dot handler and OPERATIONS.md provide focused details. No copied production identifiers or secrets are needed to install a fresh instance.

## Implemented onboarding

1. Inspect and resume an existing installation before cloning or creating resources.
2. Collect only unresolved identity choices; use authorized local secret references or protected input.
3. Start with intake off and complete actual host discovery and signed subscription.
4. Hand over one consumer with rollback, then verify real reply/edit behavior.
5. Leave a redacted local checkpoint record for a later Agent.

The configuration helper generates an independent bearer when omitted. The macOS launcher template reads exactly one Keychain item and injects upstream authorization without putting secrets into arguments or profile files. Neither helper creates account resources or bypasses system consent. Configuration and the database are stored locally; authorized message content is sent to Telegram and ChatGPT. See [data handling](privacy.md).

## Release checks

- The owner selected MIT and the [license](../LICENSE) is present. [Third-party notices](../THIRD_PARTY_NOTICES.md) cover all four locked production dependencies and accompany the Sites bundle. Recheck this inventory on dependency changes and verify branding provenance before release; the project license does not grant third-party trademark rights.
- Repeat the privacy audit of history, releases, attachments, issues and CI logs before publication. An owner-authorized rewrite removed identified private development references and personal email addresses from reachable history. Old commits remained accessible to the authenticated owner through GitHub by SHA after the rewrite; service-side cache/object removal remains separate and is not claimed. The owner chose not to pursue further history/cache cleanup. Preserve the completed rewrite and do not merge or push pre-cleanup clones back into the repository; prioritize preventing new secret or private-data exposure.
- Publish the independent-installation limitation explicitly. Before claiming general installability, perform a clean-room installation using a different approved account/Bot and only the published guide, record owner participation, and resolve unclear steps. Current-owner acceptance does not prove universal installability.
- Verify current official Tunnel client versions/checksums and host feature availability. Keep the placeholder package noninstallable. Do not invent public distribution support for private Tunnel connections.
- Enable and verify GitHub private vulnerability reporting when the repository becomes public; SECURITY.md links the private maintainer contact form. Check dependency licenses and supported runtime versions.
- Configure CI only if the owner opts in to the necessary GitHub workflow authorization. Remote CI is currently deferred; local checks are documented in CONTRIBUTING.md. Tag the reviewed version and publish it as a GitHub pre-release titled Public Beta; the contribution policy is in CONTRIBUTING.md.

## Follow-up implementation priorities

The read-only `npm run doctor` command distinguishes local backend discovery, configured Tunnel health, consumer health, subscription coverage and delivery/reply stages. It does not claim real host discovery or fresh end-to-end acceptance. The service manager uses a versioned private installation record for paths and lifecycle settings, alongside the Agent's evidence note.

An opt-in [macOS service manager](service.md), crash-safe runtime lease and noninteractive background Keychain launcher are implemented. Live backend/Tunnel handover and automatic recovery from a controlled Tunnel crash passed on one installation, followed by real Telegram replies and cumulative edits. Login/reboot/locked-Keychain acceptance remains separate before claiming unattended operation. No secret is bundled into a launchd plist and no Keychain access is silently approved.

The launcher provides exact-item access preflight without starting a client. Check background access before replacing a working Tunnel; when unavailable, preserve the current connection and explain the owner-controlled access requirement. Foreground approval and unattended access are distinct evidence levels.

For sustained usage, design bounded retention that preserves deduplication and reply recovery. [Offline reconciliation](reconciliation.md) now supports independently observed successful replies with a verified snapshot and exclusive lease; absence inference, automatic resend and arbitrary state repairs remain unsupported. Measure local receipt-to-callback and callback-to-read intervals separately before optimizing scheduling; host-internal delays have no established dolegram control.

Private [online snapshots and staged recovery](backup.md) are implemented with integrity/checksum verification, bounded copying, exclusive destinations and fresh-subscription startup gates. Restoring a snapshot still requires comparison with newer local and external state; incomplete replies/deliveries cannot be approved automatically. Backup scheduling, owner-approved retention and broader reconciliation remain open. Run production from a versioned release with independent locked dependencies so development edits cannot enter a crash restart.

Do not promise a zero-interaction installer, token-level streaming from Dot, predictable response time, or Sites production parity until each has its own verified implementation and acceptance evidence.
