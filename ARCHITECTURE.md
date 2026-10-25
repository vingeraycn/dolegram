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
- `telegram.mjs`: formal `sendMessage`/`editMessageText` writes and native draft/activity requests. No credential-bearing errors or upstream descriptions escape this boundary.
- `activity.mjs`: bounded ephemeral queued/processing feedback, independent of durable replies; failures and rate limits do not block formal answers.
- `delivery.mjs`: coalesced single-flight callback delivery, independent of the HTTP operation queue and drained on shutdown.
- `server.mjs`: loopback HTTP server, bearer authentication, bounded input and serialized RPC operations. Arbitrary Sites identity headers are not trusted by this standalone server.
- `runtime.mjs` and `scripts/run-backend.py`: standalone lifecycle and an OS-held database lease inherited across exec. The lease file is never unlinked; process exit releases the kernel lock, including after a crash. Legacy existence locks block startup until the prior backend is stopped cleanly.
- `scripts/service.py`: opt-in per-user macOS jobs from a strict private installation record. Background Tunnel credential access never prompts or changes Keychain policy. Service state and actual readiness are separate checks.
- `config.mjs`: shared private configuration validation for the server and local operator tools.
- `diagnostics.mjs`: owner/allowlist-scoped aggregate delivery stages and bounded recent latency samples; it does not change state or expose message content.
- `doctor.mjs`: read-only loopback discovery and readiness checks with fixed, actionable output. Polling health is reported by the actual poller, independently of HTTP availability. No diagnostic command creates subscriptions, reads Keychain or attempts a repair.

The standalone design avoids assuming that Sites Workers support the required inbound Telegram webhook and DNS pinning APIs. The separate source-only Sites adapter uses D1 atomic batches, owner-bound identity, exact-origin callback validation and an explicit retry tool for the documented native Sites task workflow. It refuses production subscription delivery until a verified callback transport is provided; fixed-origin policy alone is not claimed as a protocol exemption. No hosting manifest is included because no Site has been created for this reimplementation.

## Reply invariants and failure behavior

Each incoming update maps to one stored message and at most one Telegram reply ID. Revision 1 sends formal content. Short answers close immediately. Long answers close at revision 3 or 4 after two or three cumulative edits. Nonfinal revision 4, nonconsecutive revisions, replacement text, blank text, and edits after final are rejected. Identical successful retries return the prior result without another write. Plain text only is used, with a conservative 4096 UTF-16 code-unit limit; additional messages are not silently generated.

The service persists pending intent before each external Telegram write. A crash or ambiguous transport outcome changes that operation to uncertain and blocks subsequent writes. Exactly-once delivery cannot be promised across an external API timeout; automatic duplicate sends are avoided by requiring operator reconciliation. Explicit Telegram rate-limit/rejection responses permit a retry after the stored deadline. Telegram secret headers authenticate intake, and persistent update IDs reject duplicates; Telegram supplies no signed timestamp, so replay age checks are a bounded additional defense rather than a substitute for secret protection.

HTTP RPC operations are serialized. Callback network I/O runs in a separate single-flight worker so slow callbacks cannot block message reads or replies. Incoming acceptance and each state transition commit synchronously; delivery rechecks live state after network I/O and cannot remove a refreshed subscription because an older request returned 410. Shutdown drains callbacks, activity and HTTP work before closing storage. Runtime data is deliberately not shared by multiple processes. Stored messages are bound to the installation owner, so changing the owner does not grant access to previous messages. Authorization is single-owner plus an explicit private chat allowlist, checked at subscription, tool access, intake and outbound delivery. Bot-authored messages, groups, edited messages and other update types are ignored, preventing bot-reply feedback loops.

## Verified and unverified

Mock tests cover lifecycle, signatures, rotation, allowlists, duplicate/replayed updates, retry bounds, final/cumulative reply rules, uncertain writes, database restart, private-address rejection, redacted failures and HTTP authentication. Static checks use TypeScript's JavaScript checking and ESLint. Python configuration is syntax-checked without collecting secrets.

The private Mac route has completed real Tunnel discovery, signed callback verification/delivery, Dot replies, cumulative edits, identical successful retries and backend restart checks. Host scheduling remains variable. A TLS reverse proxy, Sites publication, unattended boot/login startup and installations on independent accounts have not been accepted. Real Telegram rate-limit behavior is not established by simulated tests. Runtime retention and uncertain-write reconciliation currently require explicit operator work.

Sources: [MCP Events](https://developers.openai.com/plugins/build/mcp-events), [Telegram Bot API](https://core.telegram.org/bots/api), [Sites plugin hosting](https://help.openai.com/en/articles/20001547-hosting-a-plugin-with-chatgpt-sites).

## Sites adapter source

The modules under `src/sites/` isolate D1 state and Worker routing from the Node filesystem/server implementation. SQL constraints and atomic claims replace a process-wide queue. A message and its outbox are committed together, reply claims are not automatically reclaimed after a crash, and event leases are reclaimable with stable event IDs. The fifth maintenance tool, `flush_event_deliveries`, is owner-only and is designed for an approved native Sites cloud task, not an assumed Workers Queue binding. No in-memory timer or waitUntil is used for persistent recovery. See sites/README.md for the implemented code and remaining callback transport gate.

## Private Tunnel and polling route

The preferred private route uses OpenAI Secure MCP Tunnel to reach authenticated loopback MCP, and outbound Telegram long polling for intake. Callback verification and delivery leave the Mac directly through the existing DNS-pinned HTTPS transport. No Telegram public webhook is required. `polling.mjs` verifies Bot identity and empty webhook status, persists owner/Bot-bound offsets after message/outbox acceptance, and stops on conflicts. The process lock does not protect against other applications: operator handover remains required. Polling is off until `DOTG_ENABLE_POLLING=1`; the MCP handshake can be checked first. See TUNNEL.md for official contract references, approval gates and live acceptance boundaries.
