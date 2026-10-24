# Private OpenAI Tunnel installation

This is the preferred private Mac route. It needs no public Telegram webhook, reverse proxy, domain, Cloudflare tunnel, paid hosting, or inbound firewall change. It has not been tested against a live OpenAI Tunnel or Bot. The existing consumer must remain running until replacement readiness is established.

## Data flow and verified contract

1. A dedicated OpenAI Secure MCP Tunnel forwards authenticated MCP JSON-RPC requests to `http://127.0.0.1:8787/mcp`.
2. The host discovers four tools and `telegram.message.received`, then supplies a callback and signing secret through `events/subscribe`.
3. dotg verifies that callback with a signed challenge. The Node callback transport validates and pins public DNS addresses for each connection, preserves TLS hostname verification and refuses redirects.
4. After a separately approved consumer handover, dotg fetches Telegram messages through outbound `getUpdates`, applies the private chat allowlist and persists accepted messages, events and offsets.
5. dotg posts signed events directly to the host callback over outbound HTTPS. This callback does not travel through the Tunnel. Dot calls the reply/edit tools through the Tunnel; dotg sends the Telegram response outbound.

The [official Tunnel guide](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) documents forwarding MCP JSON-RPC, HTTP upstreams and private ChatGPT plugin connections. The [official client dispatcher](https://github.com/openai/tunnel-client/blob/master/pkg/dispatcher/internal/processor.go) forwards request envelopes rather than implementing a tools-only method list. Together with the [MCP Events contract](https://developers.openai.com/plugins/build/mcp-events), this supports the architecture. It is not evidence of a successful live Events subscription through a particular workspace. Verify that checkpoint before enabling Telegram intake. Tunnel is not a general public HTTP ingress, and private Tunnel connections are not a public plugin distribution mechanism.

## Prepare without taking over Telegram

Run the checks in INSTALL.md and `npm run verify:local`. After the user approves secure local credential configuration, run `npm run configure` in an interactive terminal. Choose `polling`; enter the expected numeric Bot ID, username without `@`, and explicit private chat IDs. Secret fields use hidden local input. Do not retrieve credentials from another application's store.

The helper writes only `config.local.json`, mode 0600. It refuses overwrite and makes no network calls. Bot token and MCP bearer secret remain in that ignored file; subscriptions, callback signing secrets and message state live in ignored `runtime/dotg.sqlite`, mode 0600, under a private directory. Do not put them in Git or backups shared with others. Polling mode needs no Telegram webhook secret.

Start the prepared backend with `npm start`. With polling mode selected, this binds only `127.0.0.1:8787`, accepts authenticated `/mcp`, and returns 404 for `/telegram/webhook`. **Telegram intake is disabled unless `DOTG_ENABLE_POLLING=1` is explicitly set.** Existing subscription callbacks may still be delivered from the selected database; use a fresh, independent dotg database for initial setup.

## Create a dedicated Tunnel only after approval

Confirm the intended Platform organization and ChatGPT workspace, a dedicated dotg Tunnel identity, and their association. Do not repurpose another integration's Tunnel, key, profile, admin port or route. Creators need Tunnels Read + Manage; the runtime key and plugin operator need Read + Use. Workspace permission to add custom MCP plugins is separate.

Use the official latest-release client and inspect `tunnel-client help quickstart` and `tunnel-client init --help` on that installed version. The guide documents `--mcp-server-url` for HTTP upstreams, and these verification commands:

```sh
tunnel-client doctor --profile dotg --explain
tunnel-client run --profile dotg
```

These commands require an already configured, approved profile; this repository does not fabricate a Tunnel ID, runtime key, sample name or deploy command. Set its MCP upstream to `http://127.0.0.1:8787/mcp`. Keep admin/health listeners on loopback with ports distinct from other integrations. Enter the restricted runtime key through secure local input into the client process environment (`CONTROL_PLANE_API_KEY`) using the installed client's documented environment reference. Store nonsecret profile metadata in a dedicated `~/.config/dotg-tunnel/` directory, mode 0700, with profile files mode 0600. Do not store the literal runtime key in the profile. Persistent startup or secret storage requires a separate concrete user-approved arrangement; initially use a foreground process with an ephemeral environment.

Configure upstream bearer authentication through the host's secure API-key prompt as documented by the selected connection workflow. Do not disable dotg authentication to make discovery pass. If that host or client cannot securely convey authorization for discovery and calls, stop at that exact checkpoint. Never place bearer secrets in command arguments, URLs, logs or package files.

The official ChatGPT flow is Plugins → Add custom MCP server → Connection: Tunnel → select the same Tunnel → configure authentication → review and create privately. This Agent must not operate ChatGPT's own UI through computer automation. If no authorized management API is available, the user must perform that host step; an Agent cannot promise unattended installation.

## Real handshake before consumer handover

1. With Telegram polling still disabled, verify client readiness and make a safe `get_bridge_status` tool call from the connected plugin. Check `server/discover`, four tools and `events/list` through the actual host connection.
2. In a supported Dot conversation, explicitly request a subscription to `telegram.message.received` for the allowed private `chat_id`. The host supplies the real callback and signing secret. Never invent them or enter them into chat. A successful signed verification must return a subscription ID. If the workspace refuses Events over Tunnel, record the actual error and stop before changing Telegram.
3. Obtain action-time approval for the exact existing-consumer stop scope and rollback. A successful `getWebhookInfo` check proves no webhook, not absence of another `getUpdates` consumer. Telegram has no reliable consumer-list API. Do not test `getUpdates` against a Bot still used by another application.
4. Only after handover, restart the backend explicitly with:

```sh
DOTG_ENABLE_POLLING=1 npm start
```

This starts real Telegram polling and is not a mock command. It checks `getMe` against the configured ID and username and requires an empty webhook URL before every poll. A mismatch, existing webhook, rejected credential or Telegram 409 conflict stops intake without deleting webhooks, dropping queued updates, rotating tokens or retrying a competing consumer indefinitely. A stopped poller prints a redacted operator message; the MCP server remains available for inspection. Stop and restart it only after resolving the cause.

5. Send nonpersonal test text. Verify one event, one short reply, and a useful long reply with two or three cumulative edits of the same message. Verify restart, expiry and unsubscribe. A callback 2xx proves acceptance only, not Dot execution. Report success only after observing the full Telegram → event → Dot → Telegram chain.

## Offset safety and rollback

Offsets are bound to the local owner and expected Bot ID and persist in SQLite. Acceptance commits message deduplication and its outbox before a separate cursor commit. A crash between commits can replay an update safely. Advancing the cursor confirms previously retrieved updates on the next poll, as specified by the [Telegram Bot API](https://core.telegram.org/bots/api#getupdates). Ignored unauthorized or unsupported messages are also acknowledged. Updates older than the bridge's one-day age window are ignored. Messages received before an active subscription are not replayed automatically. No negative offset or `drop_pending_updates` is used.

The database lock protects one dotg instance using that database, not other programs or another database. A separate existing-consumer handover is mandatory. Roll back by stopping dotg polling, waiting for its outstanding request to abort, then restoring the previous consumer through its supported service controls. Do not delete its Bot, configuration or credentials. Already acknowledged Telegram updates cannot be restored to the old consumer; preserve the private dotg database and reconcile any uncertain reply before resuming. Stop the dedicated Tunnel foreground process and revoke its temporary host subscription when the test is over; do not change other tunnels.
