# Validation record

Validation date: 2026-10-24. Final checks used the official Node.js v24.22.1 macOS ARM64 binary downloaded from nodejs.org and verified against its published SHA-256 checksum. No system Node installation was changed.

- `npm run check`: TypeScript JavaScript checking and ESLint passed.
- `npm test`: 32 tests passed using synthetic data. Telegram API calls and callback transport are mocked. The HTTP authorization test binds only to 127.0.0.1.
- Python helper syntax checks passed. The plugin package preparation helper was exercised in a temporary directory with a synthetic endpoint; no host was contacted.
- Dependency audit reported zero vulnerabilities after the final dependency selection.
- Current tracked files were checked for Chinese characters and credential patterns. The earlier documentation-only history remains intact.

No real Bot token, Telegram chat, ChatGPT callback, Dot subscription, plugin upload, or production deployment was used. The secure input helper was not run with real credentials. Live TLS/DNS behavior, reverse proxy setup, host API-key input and the complete Telegram-to-Dot-to-Telegram flow remain unverified.

Passing mock tests establishes local behavior only. In particular, callback receipt does not establish successful Dot execution, semantic usefulness of generated text is not machine-verified, and ambiguous Telegram writes require operator reconciliation.

A final security review added regression coverage for concurrent HTTP reply revisions, owner changes against an existing database, webhook storage failures, split UTF-8 bodies, and signature timestamp windows. Webhook internal failures now return HTTP 500, database messages are owner-bound, and the callback timeout covers DNS resolution as well as the HTTPS exchange.

The isolated HTTP workflow test covers subscription creation, signed challenge verification, a synthetic Telegram webhook, signed event delivery to a mocked host, message reading, one formal reply with two cumulative edits, and unsubscribe. All external transports remain mocked; this is not a live Telegram or Dot acceptance test.

Sites source validation adds SQL-backed D1 binding doubles, exact-origin rejection, default fail-closed ingress/subscription checks, atomic message/outbox rollback, cross-invocation reply contention, persistent scheduled-flush recovery, owner isolation, and stale-delivery versus subscription-refresh coverage. The D1 double uses SQLite to exercise actual SQL and batch rollback; it is not a hosted D1 or workerd acceptance test.

`npm run build:sites` produces a bundled Worker with no local filesystem, SQLite or DNS runtime dependency. Its only external module is `node:crypto`. The built ESM entry imports successfully under Node 24 and rejects an unconfigured request with HTTP 503. This proves source packaging, not platform callback connectivity or deployment readiness.

Personal-Mac preparation added `npm run verify:local` and a deny-all ingress probe. Both were exercised only on 127.0.0.1:8787 and closed afterward. Recognized unauthenticated POST routes returned 401 and unrelated paths returned 404. No public tunnel, Bot configuration or real credential input was used. The existing installed cloudflared CLI parsed the dedicated empty configuration; its named-ingress validator reported no ingress rules, as expected for a Quick Tunnel using `--url`.

## Private Tunnel and polling implementation check

The updated suite contains 41 tests. On this revision, 35 tests that do not require a listener passed under Node 24.22.1, including polling cursor persistence/reopen, replay deduplication, signed official event-to-reply workflow, identity/webhook refusal, storage failure, private allowlist, conflict refusal and shutdown interruption. The six loopback HTTP tests could not be rerun: sandbox listeners return EPERM, and both the initial elevated test request and its permitted retry expired in automatic approval review before execution. This is an environment permission limitation, not a passing full-suite result. Re-run `npm test` in a terminal permitted to bind loopback before live installation.

The exact isolated subset command was:

```sh
node --test --test-skip-pattern='^(HTTP authentication|concurrent HTTP|webhook storage|split UTF|isolated HTTP|polling config)'
```

TypeScript/ESLint and Python configuration-helper syntax checks pass. No live Tunnel, persistent credential configuration, actual Telegram polling, DSH stop or host subscription was performed. TUNNEL.md describes the remaining real handshake and handover gates.

## Successful full-suite retry

On 2026-10-24, after reconnection and the user's explicit retry instruction, the supported elevated executor ran `npm test` on implementation commit `fb9835adff23c462e432cceef2d9d4ed93fef3b0`. All 41 tests passed, including the six loopback HTTP tests previously blocked by sandbox EPERM. There were no failures or skipped tests. The earlier blocked attempts above are historical; the loopback test limitation is now resolved for this validation run.

`npm run check` also passed on that implementation commit. The 39 tracked files were checked again: no Chinese characters or credential-pattern matches were found; all reachable historical blobs passed the credential-pattern scan. GitHub read-only checks confirmed login `vingeraycn`, repository `vingeraycn/dotg`, private visibility, and the expected pre-push remote main commit `9e608e502eed4348e182a3b65e5969ad73ff0a97`. This documentation update changes no implementation.

These remain isolated mock checks. No real Telegram intake, OpenAI Tunnel, host MCP Events handshake, DSH stop, Hindsight modification or persistent credential configuration was performed. Live acceptance still follows TUNNEL.md.
