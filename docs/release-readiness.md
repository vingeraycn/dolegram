# Public release and onboarding plan

The repository remains private. The README sentence opens the [desktop Agent guide](desktop-install.md), which checks local capabilities and explains owner participation. INSTALL.md is the technical runbook; TUNNEL.md, the Keychain guide, Dot handler and OPERATIONS.md provide focused details. No copied production identifiers or secrets are needed to install a fresh instance.

## Implemented onboarding

1. Inspect and resume an existing installation before cloning or creating resources.
2. Collect only unresolved identity choices; use authorized local secret references or protected input.
3. Start with intake off and complete actual host discovery and signed subscription.
4. Hand over one consumer with rollback, then verify real reply/edit behavior.
5. Leave a redacted local checkpoint record for a later Agent.

The configuration helper generates an independent bearer when omitted. The macOS launcher template reads exactly one Keychain item and injects upstream authorization without putting secrets into arguments or profile files. Neither helper creates account resources or bypasses system consent. Configuration and the database are stored locally; authorized message content is sent to Telegram and ChatGPT. See [data handling](privacy.md).

## Required before changing visibility

- The owner selected MIT and the [license](../LICENSE) is present. Verify third-party license notices and branding provenance before release; the project license does not grant third-party trademark rights.
- Repeat the privacy audit of history, releases, attachments, issues and CI logs before publication. An owner-authorized rewrite removed identified private development references and personal email addresses from reachable history. Old commits remained accessible to the authenticated owner through GitHub by SHA after the rewrite; service-side cache/object removal remains separate. Verify that boundary before changing visibility, and do not merge or push pre-cleanup clones back into the repository.
- Perform a clean-room installation using a different approved account/Bot and only the published guide. Record which steps required the owner and resolve unclear steps. Current-owner acceptance does not prove universal installability.
- Verify current official Tunnel client versions/checksums and host feature availability. Keep the placeholder package noninstallable. Do not invent public distribution support for private Tunnel connections.
- Configure private vulnerability reporting and a maintainer contact, then check dependency licenses and supported runtime versions.
- Configure CI only if the owner opts in to the necessary GitHub workflow authorization. Remote CI is currently deferred; local checks are documented in CONTRIBUTING.md. Tag a tested release and define the contribution policy.

## Follow-up implementation priorities

The read-only `npm run doctor` command now distinguishes local backend discovery, configured Tunnel health, consumer health, subscription coverage and delivery/reply stages. It does not claim real host discovery or fresh end-to-end acceptance. Next, turn redacted checkpoints into a versioned local installation record and use it to resume setup and maintenance consistently.

Next, add an opt-in macOS service installer only after specifying locked-Keychain behavior, login/reboot tests, upgrades and rollback. Avoid bundling a secret into a launchd plist or silently approving Keychain access.

For sustained usage, design bounded retention that preserves deduplication and reply recovery, and an explicit operator reconciliation flow for ambiguous writes. Measure local receipt-to-callback and callback-to-read intervals separately before optimizing scheduling; host-internal delays have no established dotg control.

Do not promise a zero-interaction installer, token-level streaming from Dot, predictable response time, or Sites production parity until each has its own verified implementation and acceptance evidence.
