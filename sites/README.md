# Sites adapter: implemented source, blocked production callback transport

The adapter is `src/sites/worker.mjs`; D1 schema is in `sites/migrations/0001_bridge.sql`. It uses the official Worker `fetch(request, env)` entry point and documented D1 prepared statements and transactional batches. It does not import the Node server, local filesystem, local SQLite or DNS transport.

## Local source checks

```sh
npm ci --ignore-scripts
npm run check
npm test
npm run build:sites
```

The build emits a bundled ESM Worker at `dist/sites/server/index.js`. It is a source artifact, not a deployable Site publication: no hosting manifest, real project ID, bindings, credentials or access policy is fabricated. The bundle's only external module is the documented Workers-compatible `node:crypto`; the eventual Sites build must enable Node compatibility as required by the selected official starter. These checks are not a hosted Worker or D1 acceptance test.

## Implemented boundaries

- Sites-provided `oai-authenticated-user-id` must match the configured owner before any MCP method runs. Do not use this handler behind a proxy that lets clients forge that platform identity header.
- Telegram intake requires the secret header, an explicit private chat allowlist, and an enabled verified callback transport. The default production entry returns 503 for webhook intake instead of acknowledging messages it cannot forward.
- D1 batches atomically insert the message and its event outbox records. A duplicate update does not create deliveries for subscriptions added later; replay is not advertised.
- Atomic reply claims prevent concurrent Worker invocations from sending competing revisions. Pending claims left by a crash remain blocked for operator reconciliation. An expired lease is not permission to repeat a possibly accepted Telegram write.
- Outbox claims have short leases, preserve event IDs and attempt counts, and persist exponential retry deadlines. A retry uses a fresh signing timestamp and signature. A stale 410 cannot remove a concurrently refreshed subscription.
- Four bridge tools are retained. A fifth owner-only maintenance tool, `flush_event_deliveries`, drains due persisted events in a bounded batch.

## Runtime inputs, not source configuration

| Input | Purpose |
| --- | --- |
| `DB` | D1 binding, provisioned through the official Sites workflow after approval. |
| `OWNER_USER_ID` | Exact Site-scoped authenticated owner ID; not an email or invented account ID. |
| `ALLOWED_CHAT_IDS_JSON` | JSON array of approved private chat ID strings. |
| `TELEGRAM_BOT_TOKEN` | Existing Bot credential supplied only through an approved secure runtime input path. |
| `TELEGRAM_WEBHOOK_SECRET` | Approved runtime secret, 32-256 URL-safe characters. |

Do not set real values while only reviewing or building source. Site creation, public ingress decisions and secret configuration remain separate approved actions.

## Fixed callback hosts: no guessed defaults

`SignedCallbacks` implements an exact HTTPS origin allowlist. It rejects wildcard configuration, suffix lookalikes, IP origins, credentials, fragments, unexpected ports and redirect responses. A compliant injected transport must also never follow a redirect before returning its response.

Neither the official Sites MCP reference nor the current general MCP Events guide publishes a fixed production event-callback hostname list or an exception to connection-time destination checks. OAuth redirect hostnames are not event callback evidence. Therefore production defaults contain no hosts and no network transport, and `events/subscribe` returns `-32015` with `callback_transport_unverified` before any network call or subscription write.

Tests inject `callback.example.test` and a synthetic signed transport only. `createSitesWorker({ callbackOrigins, callbackPost })` is an implementation injection point, not a runtime flag that certifies safety. Do not wire ordinary `fetch` into it and claim the official connection policy has been satisfied. A verified official fixed-host contract plus the applicable security policy, or an approved connection-safe HTTP transport, must establish that boundary first. See SITES_FEASIBILITY.md for primary evidence.

## Persistent retries using native Sites tasks

The official Sites recurring-update workflow supports a published Site's cloud task calling a Site MCP writer while nobody is present. That provides a documented wake-up path for `flush_event_deliveries`; a generic Cloudflare Queue binding is not assumed.

After a future approved publication, first verify a fresh cloud task can access the owner-authorized maintenance tool. Then inspect the Site's existing automations with `get_site`; only if the returned automation list and schedule request ID are available, reuse an appropriate task or create one through the native Sites `create_schedule` workflow after user approval. Never copy secrets into its prompt.

A proposed recovery task prompt is:

> Call this Site's flush_event_deliveries tool to retry due persisted MCP Events for the authenticated owner. Do not read message bodies, create subscriptions or change credentials. Report only failures that require attention.

An explicitly accepted hourly schedule is sufficient for low-volume recovery, with recovery latency up to the next actual task execution; it does not promise immediate retries or a task execution SLA. The stored backoff is an earliest retry deadline, not an exact dispatch time. Initial delivery is awaited inside the webhook request. Later retries are driven by the maintenance task or a subsequent authenticated invocation. No `waitUntil`, process-local timer, automatic schedule creation or keep-alive promise is treated as durable execution.

No native task has been created or verified against a live Site. This is a supported workflow to complete after publication, not a claim that a scheduler is already active.

## Remaining blocking contract and minimal fallback

The source and SQL-backed mock adapter are implemented. The sole unresolved platform capability contract is safe event callback egress: obtain verified callback-origin trust/connection guarantees from the official host or a Sites-supported safe transport. Ordinary deployment prerequisites (approved public webhook access, runtime secrets, D1 binding, owner identity, task authorization and plugin connection) remain mandatory but have documented workflows.

If that contract cannot be established, preserve the verified Node backend's pinned callback transport and obtain an explicitly approved HTTPS hosting path for it. Do not default to a paid host or weaken callback validation to force a Sites publication. The current Bot consumer must remain untouched until a working replacement and rollback are ready.
