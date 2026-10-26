# Changelog

## Unreleased

- Renamed the project from dotg to **dolegram**: Use ChatGPT Dot in Telegram.
- Updated the repository, package, portable template, documentation and visual branding.
- Preserved legacy runtime identifiers and existing installations; see [compatibility notes](docs/rename.md).
- The original v0.1.0 tag remains unchanged as the historical public beta snapshot.

## 0.1.0 — Public Beta — 2026-10-25

Talk to your existing ChatGPT Dot from Telegram through a bridge running on your Mac. This first public beta targets low-volume, single-owner installations with access to ChatGPT private Tunnels and MCP Events.

### Included

- Allowlisted private chats, Telegram long polling, and signed MCP Events.
- Queued feedback and typing indicators, with longer replies updated in the same message.
- Reply revisions, successful-write retry deduplication, and fail-closed uncertain writes.
- Agent-oriented installation, diagnostics, rollback, and opt-in macOS background services.
- Exact-item Keychain launcher, private snapshots, staged recovery, and evidence-based reconciliation.
- MIT license and third-party dependency notices.

### Validation

The latest behavioral changes passed 114 local automated tests (68 JavaScript and 46 Python), static checks, isolated backend verification, the source bundle build, and launcher self-tests. Real acceptance on one installation covered replies, cumulative edits, identical successful retries, backend restart, and automatic recovery after a controlled Tunnel process crash. Mock tests and one-installation acceptance do not establish compatibility with every account.

### Known limits

- Independent-account installation has not been accepted. Login, identity choices, and protected operating-system consent can require the owner; a zero-interaction installer is not promised.
- The Mac must remain available. Whole-Mac reboot/login, locked-Keychain, sleep, and network recovery have not been fully accepted.
- Host scheduling can delay replies by tens of seconds. Recent live checks observed roughly 40 and 61 seconds to the first reply; no fixed latency is promised.
- Message updates are cumulative chunks, not token-level streaming from Dot.
- Backup scheduling and data retention remain operator-managed. Runtime state contains private messages.
- The Sites adapter is source-only and lacks production callback delivery; use the private Mac route.
- Remote CI is deferred. Reproducible local checks are documented in CONTRIBUTING.md.

Use the copyable installation prompt in [README.md](README.md). Report reproducible non-sensitive bugs in GitHub Issues and vulnerabilities through the private route in [SECURITY.md](SECURITY.md).
