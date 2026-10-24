# Implementation contract

## Provenance and protocol

This is a new implementation based on the official [MCP Events contract](https://developers.openai.com/plugins/build/mcp-events), checked on 2026-10-24. MCP version `2026-07-28` is advertised by `server/discover`; event discovery, subscriptions and tools share the authenticated `POST /mcp` endpoint. No ordinary MCP notification is substituted for a host event.

Subscriptions are identified by a hash of the authenticated owner, callback URL, event name and filter arguments. Callback verification must succeed before activation. A fresh challenge is signed with Standard Webhooks. Event bodies contain `eventId`, `name`, `timestamp`, `data`, and a null replay cursor. Event IDs survive retries, while signing timestamps and signatures are refreshed. One event per request is sent within the 256 KiB limit. HTTP 410/413 are terminal; other permanent client failures also stop retries. HTTP 2xx acknowledges transport receipt only.

The signing secret is validated as a `whsec_` value with 24-64 decoded bytes. Refresh supports a short dual-signature rotation window. Finite expiration is always granted, including requests for an unlimited lifetime. Unsubscribe is idempotent and owner-bound. The service rejects non-null replay cursors rather than claiming historical replay support.

## Boundaries and dependency choices

- `contracts.mjs`: event/tool schemas and input validation for the subset used here.
- `security.mjs`: constant-time secret comparison and callback HTTPS transport. Every connection resolves and validates all addresses, pins the selected public address, preserves TLS hostname validation, and does not follow redirects. `ipaddr.js` handles IPv4/IPv6 classification rather than maintaining a custom IP parser.
- `store.mjs`: private SQLite state, using Node's built-in SQLite instead of an extra native database dependency. A transaction saves the incoming message and outbox together. A single state row deliberately favors auditability over throughput; this is a low-volume single-owner service.
- `bridge.mjs`: official event lifecycle, Telegram intake, outbox, and reply state. `standardwebhooks` implements the published signing format instead of custom cryptography.
- `telegram.mjs`: only formal `sendMessage` and `editMessageText` writes. No credential-bearing errors or upstream descriptions escape this boundary.
- `server.mjs`: loopback HTTP server, bearer authentication, bounded input, serialized operations and a single-process runtime lock. Arbitrary Sites identity headers are not trusted by this standalone server.

The standalone design avoids assuming that Sites Workers support the required inbound Telegram webhook and DNS pinning APIs. A future Sites adapter must prove those properties before publication. No hosting manifest is included because no Site has been created for this reimplementation.

## Reply invariants and failure behavior

Each incoming update maps to one stored message and at most one Telegram reply ID. Revision 1 sends formal content. Short answers close immediately. Long answers close at revision 3 or 4 after two or three cumulative edits. Nonfinal revision 4, nonconsecutive revisions, replacement text, blank text, and edits after final are rejected. Identical successful retries return the prior result without another write. Plain text only is used, with a conservative 4096 UTF-16 code-unit limit; additional messages are not silently generated.

The service persists pending intent before each external Telegram write. A crash or ambiguous transport outcome changes that operation to uncertain and blocks subsequent writes. Exactly-once delivery cannot be promised across an external API timeout; automatic duplicate sends are avoided by requiring operator reconciliation. Explicit Telegram rate-limit/rejection responses permit a retry after the stored deadline. Telegram secret headers authenticate intake, and persistent update IDs reject duplicates; Telegram supplies no signed timestamp, so replay age checks are a bounded additional defense rather than a substitute for secret protection.

All ingress and delivery operations are serialized by the HTTP service. Runtime data is deliberately not shared by multiple processes. Authorization is single-owner plus an explicit private chat allowlist, checked at subscription, tool access, intake and outbound delivery. Bot-authored messages, groups, edited messages and other update types are ignored, preventing bot-reply feedback loops.

## Verified and unverified

Mock tests cover lifecycle, signatures, rotation, allowlists, duplicate/replayed updates, retry bounds, final/cumulative reply rules, uncertain writes, database restart, private-address rejection, redacted failures and HTTP authentication. Static checks use TypeScript's JavaScript checking and ESLint. Python configuration is syntax-checked without collecting secrets.

No real Telegram calls, callback delivery to ChatGPT, Dot runs, TLS reverse proxy deployment, Sites publication or secure host registration have been tested. Production DNS/TLS behavior and Telegram rate limits need integration acceptance in a separately approved independent environment. Runtime retention and uncertain-write reconciliation currently require explicit operator work.

Sources: [MCP Events](https://developers.openai.com/plugins/build/mcp-events), [Telegram Bot API](https://core.telegram.org/bots/api), [Sites plugin hosting](https://help.openai.com/en/articles/20001547-hosting-a-plugin-with-chatgpt-sites).
