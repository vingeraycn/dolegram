# Install dolegram with an Agent

For Codex or ChatGPT desktop, start with [Desktop Agent installation](docs/desktop-install.md): check actual local capabilities and explain necessary owner participation first. Return here for the installation procedure.

This guide is for an Agent operating on the owner's Mac. Complete the authorized work; do not turn executable setup into a checklist for the user. Resume verified resources instead of rebuilding them. Use the preferred local browser when account UI is necessary, and respect the active execution environment's actual permissions.

## Outcome and boundaries

Success means an allowlisted Telegram message reaches the existing Dot and receives a real Bot reply, with a long answer edited in place. A healthy backend, Tunnel, installed connection, or accepted callback alone is not success.

Use one Bot consumer, one dolegram database, one dedicated Tunnel profile, and one existing or newly authorized private connection. Keep the previous consumer and a rollback path. Never publish the repository, expose the backend, widen access, or replace the user's existing model/integration as an installation shortcut.

## 1. Inspect and record the starting point

Check for an existing checkout, Git changes, runtime processes, listener, database lock, Tunnel profile, private connection, and event subscription. Inspect configuration metadata without printing secrets. Record nonsecret checkpoints in a local ignored installation note: paths, versions, process identifiers, resource identifiers, current stage, exact blocker, and rollback. Do not put personal installation notes in Git.

Confirm only information that cannot be obtained from authorized local sources: the intended Bot, owner/private chat, Platform organization, ChatGPT workspace, and existing consumer. A Bot username is not a chat ID. Never infer an allowlist from the first stranger who messages the Bot. `getWebhookInfo` cannot reveal competing long-poll consumers; inspect local services too.

For a fresh checkout:

```sh
git clone https://github.com/vingeraycn/dolegram.git
cd dolegram
npm ci --ignore-scripts
npm run check
npm test
npm run verify:local
```

Do not overwrite an existing checkout or discard changes. Use Node.js 22.16+ within 22.x, or 24.x, npm, and Python 3.11 or newer. The built-in SQLite API may emit an experimental warning. These checks need no credentials.

## 2. Configure through a protected local destination

Never request secrets in chat or print them. Reuse an explicitly authorized existing Bot credential through a protected local reference if the available tools permit it. Read only that approved item/file. For new input, use a secure credential UI or the hidden-input helper below; only ask the user to enter a secret when the Agent cannot safely perform that step. A rejected credential operation is not permission to use a different tool to bypass it.

```sh
npm run configure
```

The helper makes no network calls, refuses an existing file and noninteractive secret input, and writes `config.local.json` with mode 0600. Leaving the MCP bearer blank generates a fresh independent secret locally without displaying it. Never rerun it to replace a working installation. Authorized Agents may create equivalent configuration directly with exclusive file creation and mode 0600; do not put secret values in shell arguments, logs, or transcripts.

| Field | Required value |
| --- | --- |
| `ownerId` | Stable identifier for this installation, independent of display names. |
| `allowedChatIds` | Explicit positive private chat IDs as strings; no wildcard. |
| `telegramBotToken` | The approved Bot's token. |
| `mcpBearerToken` | Independent printable ASCII secret, at least 32 characters. |
| `telegramMode` | `polling` for this route. |
| `expectedBotId`, `expectedBotUsername` | Numeric Bot ID as a string and username without `@`; checked with `getMe`. |

The optional webhook route additionally requires `telegramWebhookSecret`; do not enable it for this installation. MCP Events signing secrets come from the host during subscription, not from the user. Never confuse the Bot token, MCP bearer, Tunnel runtime key, or Events signing secret.

## 3. Start with Telegram intake disabled

```sh
npm start
```

The backend binds `127.0.0.1:8787`. `npm start` uses Python 3 to acquire an OS-managed lease before executing Node; direct `node src/server.mjs` is not a supported startup path. Default private storage is `runtime/dotg.sqlite`. `DOTG_CONFIG` and `DOTG_DATABASE` can select paths; they are not secret-value variables. For initial setup use a new installation's database, not another service's data. Existing stored subscriptions may deliver callbacks even while Telegram polling is off.

Verify unauthorized MCP access returns 401 and an authenticated local `get_bridge_status` succeeds. Pass authorization from the protected file in process memory; do not type a token into a command. The polling configuration returns 404 for `/telegram/webhook`. Stop cleanly with SIGTERM, not by deleting a lock.

## 4. Connect the actual host

Follow [TUNNEL.md](TUNNEL.md) for the official Tunnel client and private connection. Reuse an existing matching connection. Confirm organization/workspace association, least-privilege runtime access, and a protected credential destination before a new credential operation. Honor authorization already provided; request additional consent only when scope or the tool's mandatory action-time rule requires it.

Prefer a restricted runtime key with Tunnels Read + Use. Choose its lifetime with the owner; do not silently create or renew short-lived credentials. For macOS Keychain, retain exact-item lookup and the system access prompt. “Never” means no scheduled expiry, not immunity to revocation or account policy changes. See the reproducible [Keychain launcher guide](docs/keychain.md).

The private connection can use **No authentication** with bearer authentication injected locally into both normal and discovery upstream headers. This requires the owner's approval for local upstream secret use. The backend must continue enforcing the bearer. Never invent a public Tunnel URL, embed secrets in a manifest, or install `mcp.json.example`.

Verify through the real host: discovery, all four tools, `events/list`, a safe tool call, and a signed subscription verification. Let the host generate the callback and signing secret. Use [docs/dot-task.md](docs/dot-task.md) for the event handler, substituting only the verified private chat filter. If the account lacks the feature, report the exact error and leave the old consumer running.

## 5. Hand over exactly one consumer

Prepare the supported stop/resume actions for the old Telegram consumer and identify any effects on shared services. Reuse existing authorization; ask only for an additional material effect. Pause that consumer without deleting its configuration. Confirm it has stopped, then restart dolegram with:

```sh
DOTG_ENABLE_POLLING=1 npm start
```

Never run two `getUpdates` consumers to test which one wins. dolegram checks Bot identity and empty webhook status before polling, and stops intake on mismatch, rejected credentials, a webhook, or a Telegram conflict. It never deletes webhooks or drops pending updates. Follow [OPERATIONS.md](OPERATIONS.md) if intake stops.

## 6. Perform real acceptance

Using an authorized Telegram account and the intended private chat, send harmless test messages through the actual client. The Agent may do this when authorized and supported; do not make the user repeat tests the Agent can perform.

1. Observe durable receipt and one matching event. The queued draft must not imply Dot has already started.
2. Observe callback acceptance, then an actual read tool call, then one short final Bot reply.
3. Ask for a useful long reply. Observe one message ID, increasing revisions, cumulative content, and a final edit. Thinking/typing should reflect processing and end after completion.
4. Reissue an identical successful tool operation and verify no second Telegram write. Never test ambiguous writes by blindly resending them.
5. Restart the backend cleanly and verify state and host access survive. Record separately whether boot/login recovery has been tested; a manual restart is not evidence of autostart.

Do not create duplicate subscriptions to repair a slow task. Check bounded pending recovery and timestamps first. A callback 2xx is transport acceptance, and mock tests are not end-to-end acceptance.

## 7. Handoff with useful evidence

Report installed commit and versions, credential lifetime (no values), protected storage location, exact active consumer, connection/subscription status, observed real reply/edit results, remaining limits, and the rollback action. Keep a redacted local installation record so another Agent can resume. Stop only at a real missing permission or capability; name the failed action and actual error without inventing a product limitation.

Runtime retention is currently manual and the service is intended for low-volume personal use. See [OPERATIONS.md](OPERATIONS.md) for backups, uncertain writes, expiration, and rollback.
