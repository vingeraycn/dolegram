# dotg

A new implementation of a private Telegram Bot to Dot bridge using official MCP Events. This is **not recovered original plugin source**.

Standalone Node and source-only Sites/D1 adapters are included. The Sites production entry intentionally refuses unverified callback delivery. Local mock tests and static checks are available. **No deployment, real Bot connection, or end-to-end Dot subscription has been validated.** The existing running plugin remains separate and unchanged.

## Give this sentence to your Agent

> Read https://github.com/vingeraycn/dotg/blob/main/INSTALL.md, install and verify dotg locally, then guide me through secure configuration; ask for explicit approval before deployment, Bot/webhook changes or host authorization, never request secrets in chat, and report any unverified integration instead of claiming success.

This repository is private. Other users and their Agents need owner-granted read access. Do not publish the repository to enable installation.

## Local development

Use Node.js 22.x (22.13+) or Node.js 24+ (a maintained LTS version is recommended), npm, and Python 3 for the optional interactive configuration helper.

```sh
npm ci --ignore-scripts
npm run check
npm test
```

The tests use synthetic fixtures and mocked Telegram/callback transports. One HTTP test binds only to loopback. They do not use Bot tokens or send external messages.

## Behavior

- Accept allowlisted private text messages through an authenticated Telegram webhook.
- Persist incoming update IDs, subscriptions, delivery retries, and reply state in a private SQLite database.
- Advertise `telegram.message.received` and the four tools `get_bridge_status`, `read_telegram_message`, `reply_telegram_message`, and `update_telegram_message`.
- Use the actual MCP Events subscription lifecycle, callback verification and Standard Webhooks signatures. Ordinary MCP notifications are not event delivery.
- Short answers use one formal reply. Long answers begin with useful formal content and then append cumulative content with two or three edits to that same Telegram message. Revisions increase from 1 to at most 4; the last edit is final. No draft API or progress placeholder is used. The Agent must decide what constitutes useful content.
- Maximum reply size is 4096 UTF-16 code units; longer text is rejected rather than silently truncated or split into extra messages.
- A timed-out or interrupted Telegram write is blocked as uncertain, preventing automatic duplicate sends. Operator reconciliation is required.

See [INSTALL.md](INSTALL.md), [Sites adapter and native retry workflow](sites/README.md), [Sites feasibility](SITES_FEASIBILITY.md), [plugin packaging](PLUGIN.md), [implementation decisions](ARCHITECTURE.md), and [provenance](SOURCE_STATUS.md).
