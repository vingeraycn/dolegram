# Operate dotg

Keep an ignored local record of checkout, Node/client versions, runtime directory, process IDs, credential expiration, connection, subscription, and previous-consumer resume command. Do not store secret values in the record.

## Inspect before changing anything

Run the read-only diagnostic command from the checkout using its supported Node LTS:

```sh
npm run doctor -- --tunnel-health-file /absolute/path/to/runtime/health.url
```

Use `--config PATH` (or `DOTG_CONFIG`) for an existing private configuration and `npm run --silent doctor -- --json` for a structured report without npm banners. Exit codes are 0 for passed local checks, 1 for warnings/incomplete evidence, and 2 for failed checks. Reports contain fixed guidance and aggregate counts, not message bodies, chat IDs, credential values or callback addresses. The command does not open the database, read Keychain, poll Telegram, send messages or repair anything.

Doctor distinguishes intake disabled/stopped/retrying, incomplete subscription coverage, callback failures, accepted events awaiting Dot, processing, partial answers and uncertain writes. It performs local authenticated discovery; Tunnel readiness and historical reply records remain separate from real host and fresh end-to-end acceptance. An older running backend is reported as lacking detailed diagnostics until a controlled restart loads the new source. A warning about a pending reply can be normal while Dot is working.

Use the real host's `get_bridge_status` to check subscription status, received messages, reply state, pending keys, and activity counters. Separate message receipt, callback acceptance, first tool read, and first answer. A long interval after callback acceptance but before first read is a host scheduling/dispatch observation, not proof of a particular internal cause.

| Symptom | Next check |
| --- | --- |
| No incoming message | Bot identity, allowlist, stopped poller, existing webhook, competing consumer, network. |
| Received but no accepted callback | Active subscription, expiry, callback retry/terminal state, public DNS validation. |
| Callback accepted but no reply | Actual task run, batch instructions, bounded pending list, first read timestamp. Do not add duplicate subscriptions. |
| Read but partial/no reply | Tool outcome and stored revision/status; distinguish rejected, rate-limited, and uncertain writes. |
| No Thinking/typing | Activity counters and deadline. Queued means not read; feedback is best-effort and bounded, independent of formal answers. |
| Tunnel unavailable | Dedicated client's loopback health/readiness, runtime key expiry/revocation, exact profile and upstream. |
| MCP 401 | Local upstream bearer injection in both normal and discovery headers, without displaying either secret. |

`DOTG_CALLBACK_DNS_SERVERS` optionally selects a trusted resolver for callbacks on networks returning virtual DNS addresses. Never disable public-address checks or TLS validation. See [TUNNEL.md](TUNNEL.md).

## Clean restart and upgrade

1. Run automated checks on the reviewed source before replacing the running backend. Preserve the previous commit and nonsecret launch configuration.
2. Send SIGTERM to the exact dotg backend. It aborts long polling and activity requests, waits for in-flight callback and HTTP work, closes SQLite, and releases its lock.
3. Verify the process and listener are gone and its lock was released. Never delete an active lock or start a second poller to force recovery. After a crash, inspect process ownership and the database before explicitly removing a proven stale lock.
4. Back up the closed database into a private directory with private permissions. It contains messages, callback secrets, and reply state; do not upload it. A live SQLite copy requires SQLite's backup mechanism, not a casual file copy.
5. Start the reviewed backend with the same owner, configuration and database. Retain `DOTG_ENABLE_POLLING=1` only if dotg is the approved consumer. Verify host tool access and perform an authorized real smoke test.

For read-only diagnosis use SQLite read-only mode. Do not instantiate the application's `Store` on a live database: its startup recovery changes pending writes to uncertain. Do not edit production state to make a test pass.

Manual restart is supported. A general boot/login service installer is not yet provided. If an owner requests one, first specify exact launch targets, Keychain behavior while locked, working directories, shutdown, and rollback; test those conditions before calling it unattended.

## Uncertain writes and partial answers

A Telegram timeout may mean the message was sent even though the response was lost. dotg records uncertain state and blocks new writes to prevent duplicates. Inspect the actual authorized Telegram conversation and reconcile the result with the stored intent. There is no automatic reconciliation command. Do not clear state or invent a message ID.

A confirmed sent nonfinal answer can resume from `read_telegram_message`'s exact `reply.text`, `reply.messageId` and revision. Follow [the handler contract](docs/dot-task.md). A rate-limited rejected write may retry after its deadline; an uncertain write may not.

## Lifetime, retries and retention

MCP Events subscriptions expire within 24 hours and depend on host renewal, regardless of Tunnel key lifetime. Queued events survive backend restart and retry at most six times with backoff. Expired subscriptions and terminal callback responses stop delivery. Callback 2xx means accepted, not answered. Non-null replay cursors are unsupported.

All accepted messages and reply/deduplication state remain in the database. Storage uses a single serialized state row and is intended for low-volume personal use. Retention compaction and a durable operator reconciliation UI are future work; deleting old records without a design can break replay protection and reply recovery. Protect backups and schedule owner-approved maintenance rather than silently deleting history.

## Rollback to the previous consumer

Stop dotg and wait for its outstanding poll to abort. Verify it has stopped before resuming the previous consumer using its recorded supported control. Keep that consumer's configuration intact throughout the trial; do not stop unrelated services. Preserve dotg's private database and reconcile uncertain replies. Telegram updates already acknowledged by dotg cannot be restored to the old consumer.

If retiring dotg, remove its host subscription and stop only its dedicated Tunnel after the previous consumer is verified. Credential revocation and removal of private data are separate owner-authorized actions.
