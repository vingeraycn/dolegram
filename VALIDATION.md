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
