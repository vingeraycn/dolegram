# Private OpenAI Tunnel installation

This is the preferred private Mac route. It needs no public Telegram webhook, reverse proxy, domain, Cloudflare tunnel, paid hosting, or inbound firewall change. Live private Tunnel discovery, signed Events subscription, and Telegram end-to-end acceptance were verified on 2026-10-25. The tested private chat completed an automatic short reply and an independent automatic long reply with two cumulative edits to the same message. Exact reply/update retries and state retention across a backend restart were also verified. This does not establish unattended restart behavior, indefinite credential validity, or a delivery latency guarantee. For a new installation, preserve the existing consumer until replacement readiness is established.

## Data flow and verified contract

Live acceptance has shown variable delays between callback acceptance and the first read tool call. Native feedback communicates queued versus actual processing states; it does not remove host scheduling latency. The handler must process each event in a batch and may use the bounded pending list once per event-triggered run. Use the canonical instructions in [docs/dot-task.md](docs/dot-task.md).

1. A dedicated OpenAI Secure MCP Tunnel forwards authenticated MCP JSON-RPC requests to `http://127.0.0.1:8787/mcp`.
2. The host discovers four tools and `telegram.message.received`, then supplies a callback and signing secret through `events/subscribe`.
3. dolegram verifies that callback with a signed challenge. The Node callback transport validates and pins public DNS addresses for each connection, preserves TLS hostname verification and refuses redirects.
4. After a separately approved consumer handover, dolegram fetches Telegram messages through outbound `getUpdates`, applies the private chat allowlist and persists accepted messages, events and offsets.
5. dolegram posts signed events directly to the host callback over outbound HTTPS. This callback does not travel through the Tunnel. Dot calls the reply/edit tools through the Tunnel; dolegram sends the Telegram response outbound.

The [official Tunnel guide](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) documents forwarding MCP JSON-RPC, HTTP upstreams and private ChatGPT plugin connections. The [official client dispatcher](https://github.com/openai/tunnel-client/blob/master/pkg/dispatcher/internal/processor.go) forwards request envelopes rather than implementing a tools-only method list. Together with the [MCP Events contract](https://developers.openai.com/plugins/build/mcp-events), this supports the architecture. It is not evidence of a successful live Events subscription through a particular workspace. Verify that checkpoint before enabling Telegram intake. Tunnel is not a general public HTTP ingress, and private Tunnel connections are not a public plugin distribution mechanism.

## Prepare without taking over Telegram

Run the checks in INSTALL.md and `npm run verify:local`. Use an authorized protected local credential source, or run `npm run configure` for hidden interactive input. Choose `polling`; enter the expected numeric Bot ID, username without `@`, and explicit private chat IDs. Secret fields use hidden local input. Reuse another application's credential only when the owner explicitly authorizes that exact source and destination.

The helper writes only `config.local.json`, mode 0600. It refuses overwrite and makes no network calls. Bot token and MCP bearer secret remain in that ignored file; subscriptions, callback signing secrets and message state live in ignored `runtime/dotg.sqlite`, mode 0600, under a private directory. Do not put them in Git or backups shared with others. Polling mode needs no Telegram webhook secret.

Start the prepared backend with `npm start`. With polling mode selected, this binds only `127.0.0.1:8787`, accepts authenticated `/mcp`, and returns 404 for `/telegram/webhook`. **Telegram intake is disabled unless `DOTG_ENABLE_POLLING=1` is explicitly set.** Existing subscription callbacks may still be delivered from the selected database; use a fresh, independent dolegram database for initial setup.

## Create a dedicated Tunnel only after approval

Confirm the intended Platform organization and ChatGPT workspace, a dedicated dolegram Tunnel identity, and their association. Do not repurpose another integration's Tunnel, key, profile, admin port or route. Creators need Tunnels Read + Manage; the runtime key and plugin operator need Read + Use. Workspace permission to add custom MCP plugins is separate.

Use the official latest-release client and inspect `tunnel-client help quickstart` and `tunnel-client init --help` on that installed version. The guide documents `--mcp-server-url` for HTTP upstreams, and these verification commands:

```sh
tunnel-client doctor --profile dotg --explain
tunnel-client run --profile dotg
```

These commands require an already configured, approved profile; this repository does not fabricate a Tunnel ID, runtime key, sample name or deploy command. Set its MCP upstream to `http://127.0.0.1:8787/mcp`. Keep admin/health listeners on loopback with ports distinct from other integrations. Pass the restricted runtime key to the client in memory (`CONTROL_PLANE_API_KEY`) using its documented environment reference; never print it. Choose its lifetime explicitly with the owner. Store nonsecret profile metadata in a dedicated `~/.config/dotg-tunnel/` directory, mode 0700, with profile files mode 0600. Do not store the literal runtime key in the profile. For approved macOS Keychain storage, use the exact-item launcher in [docs/keychain.md](docs/keychain.md). Persistent startup is a separate lifecycle feature; do not claim boot/login recovery without testing it.

The current ChatGPT Tunnel creation flow offers OAuth and No authentication, without a separate upstream Bearer field. An explicitly approved alternative is to select No authentication for the private Tunnel connection and have a dedicated local launcher read the existing MCP bearer into the client environment. Configure both official client `mcp.extra_headers` and `mcp.discovery_extra_headers` with `Authorization: env:DOTG_MCP_AUTHORIZATION`. The value in that environment variable includes the `Bearer ` prefix. Tunnel access remains restricted, and dolegram still requires its bearer on every request. Keep the runtime key separate. Never place literal secrets in command arguments, URLs, logs, profile files or package files.

The official ChatGPT flow is Plugins → Add custom MCP server → Connection: Tunnel → select the same Tunnel → configure authentication → review and create privately. Follow the active execution environment's actual UI and credential rules; do not infer that a restriction on one tool or target forbids all local browser access. System credential prompts may require the user to act.

## Callback DNS on networks using virtual addresses

Some network tools return reserved virtual addresses to applications. These must remain blocked by the callback SSRF checks. If the system resolver returns virtual addresses, configure a trusted DNS resolver only for the dolegram callback transport, for example `DOTG_CALLBACK_DNS_SERVERS=1.1.1.1`. This optional comma-separated list accepts IP addresses, does not change global DNS, and sends callback hostname queries to the selected resolver. Without it, dolegram uses the system resolver.

Both IPv4 and IPv6 answers are checked before connecting; a private or reserved answer rejects the entire destination. Lookup failures fail closed. The transport still pins the checked address, verifies the original TLS hostname, refuses redirects, and keeps the existing request timeout. Do not allow reserved addresses or disable certificate verification to accommodate virtual DNS.

## Real handshake before consumer handover

1. With Telegram polling still disabled, verify client readiness and make a safe `get_bridge_status` tool call from the connected plugin. Check `server/discover`, four tools and `events/list` through the actual host connection.
2. In a supported Dot conversation, explicitly request a subscription to `telegram.message.received` for the allowed private `chat_id`. The host supplies the real callback and signing secret. Never invent them or enter them into chat. A successful signed verification must return a subscription ID. If the workspace refuses Events over Tunnel, record the actual error and stop before changing Telegram.
3. Confirm that the exact existing-consumer stop scope and rollback are authorized; reuse an existing approval when its scope is unchanged. A successful `getWebhookInfo` check proves no webhook, not absence of another `getUpdates` consumer. Telegram has no reliable consumer-list API. Do not test `getUpdates` against a Bot still used by another application.
4. Only after handover, restart the backend explicitly with:

```sh
DOTG_ENABLE_POLLING=1 npm start
```

This starts real Telegram polling and is not a mock command. It checks `getMe` against the configured ID and username and requires an empty webhook URL before every poll. A mismatch, existing webhook, rejected credential or Telegram 409 conflict stops intake without deleting webhooks, dropping queued updates, rotating tokens or retrying a competing consumer indefinitely. A stopped poller prints a redacted operator message; the MCP server remains available for inspection. Stop and restart it only after resolving the cause.

5. Clarify the event task instructions to process every delivered message independently, including every event in a batch, and to skip only an already-final event. Do not require a separate operator message before replying. Send nonpersonal test text. Verify one event, one short reply, and a useful long reply with two or three cumulative edits of the same message. Verify restart, expiry and unsubscribe. A callback 2xx proves acceptance only, not Dot execution. Report success only after observing the full Telegram → event → Dot → Telegram chain.

## Offset safety and rollback

Offsets are bound to the local owner and expected Bot ID and persist in SQLite. Acceptance commits message deduplication and its outbox before a separate cursor commit. A crash between commits can replay an update safely. Advancing the cursor confirms previously retrieved updates on the next poll, as specified by the [Telegram Bot API](https://core.telegram.org/bots/api#getupdates). Ignored unauthorized or unsupported messages are also acknowledged. Updates older than the bridge's one-day age window are ignored. Events for messages received before an active subscription are not replayed automatically; authorized unanswered messages can still be recovered from the pending list during a later event-triggered run. No negative offset or `drop_pending_updates` is used.

The database lock protects one dolegram instance using that database, not other programs or another database. A separate existing-consumer handover is mandatory. Roll back by stopping dolegram polling, waiting for its outstanding request to abort, then restoring the previous consumer through its supported service controls. Do not delete its Bot, configuration or credentials. Already acknowledged Telegram updates cannot be restored to the old consumer; preserve the private dolegram database and reconcile any uncertain reply before resuming. If the trial is abandoned, stop the dedicated Tunnel process and revoke its temporary host subscription after restoring the previous consumer. If the user wants the connection to remain active, preserve the verified subscription and running processes within the approved credential lifetime. Do not renew or broaden credentials without authorization, and do not change other tunnels.
