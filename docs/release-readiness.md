# Public release and onboarding plan

The repository remains private. The README installation sentence is the primary entry point; INSTALL.md is the Agent runbook, and TUNNEL.md, the Keychain guide, the Dot handler, and OPERATIONS.md provide focused details. No copied production identifiers or secrets are needed to install a fresh instance.

## Implemented onboarding

1. Inspect and resume an existing installation before cloning or creating resources.
2. Collect only unresolved identity choices; use authorized local secret references or protected input.
3. Start with intake off and complete actual host discovery and signed subscription.
4. Hand over one consumer with rollback, then verify real reply/edit behavior.
5. Leave a redacted local checkpoint record for a later Agent.

The configuration helper generates an independent bearer when omitted. The macOS launcher template reads exactly one Keychain item and injects upstream authorization without putting secrets into arguments or profile files. Neither helper creates account resources or bypasses system consent. Credentials and runtime data remain local.

## Required before changing visibility

- Choose and add the owner's intended open-source license. No license is implied by this preparation.
- Audit all history, releases, attachments, issues and CI logs—not just the latest tree. Earlier commits contained private development conversation/plugin identifiers; removing them from current files does not remove history. Decide whether an explicitly authorized history rewrite or a clean public export is appropriate. Do not rewrite the private working repository automatically.
- Perform a clean-room installation using a different approved account/Bot and only the published guide. Record which steps required the owner and resolve unclear steps. Current-owner acceptance does not prove universal installability.
- Verify current official Tunnel client versions/checksums and host feature availability. Keep the placeholder package noninstallable. Do not invent public distribution support for private Tunnel connections.
- Configure private vulnerability reporting and a maintainer contact, then check dependency licenses and supported runtime versions.
- Configure CI only if the owner opts in to the necessary GitHub workflow authorization. Remote CI is currently deferred; local checks are documented in CONTRIBUTING.md. Tag a tested release and define the contribution policy.

## Follow-up implementation priorities

First, turn redacted checkpoints into a versioned local installation record and provide a read-only doctor command. It should distinguish backend, Tunnel, host tools, subscription, consumer and actual reply stages without reading unrelated credentials or fabricating success.

Next, add an opt-in macOS service installer only after specifying locked-Keychain behavior, login/reboot tests, upgrades and rollback. Avoid bundling a secret into a launchd plist or silently approving Keychain access.

For sustained usage, design bounded retention that preserves deduplication and reply recovery, and an explicit operator reconciliation flow for ambiguous writes. Measure local receipt-to-callback and callback-to-read intervals separately before optimizing scheduling; host-internal delays have no established dotg control.

Do not promise a zero-interaction installer, token-level streaming from Dot, predictable response time, or Sites production parity until each has its own verified implementation and acceptance evidence.
