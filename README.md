# dotg

Connect your private Telegram Bot to your existing ChatGPT Dot. Messages arrive on your Mac, trigger MCP Events, and receive replies through the Bot—including cumulative edits to the same message.

```text
Telegram → local dotg → signed MCP Events → Dot
Telegram ← Bot API   ← local dotg        ← private MCP Tunnel
```

No public Telegram webhook, domain, or inbound port is needed for the preferred Mac installation. You need a Telegram Bot, a Mac running Node.js, and a ChatGPT workspace that supports private Tunnel connections and MCP Events.

## Install with your Agent

Give this sentence to an Agent that can work on your Mac:

> Read https://github.com/vingeraycn/dotg/blob/main/INSTALL.md and install and configure dotg on my Mac to connect my Telegram Bot to my existing Dot; reuse authorized local resources, protect credentials, complete a safe consumer handover and real reply/edit verification, and ask me only for missing choices or actions that genuinely require me.

The Agent follows a resumable guide: inspect → configure → connect → verify → hand over. This is an installation prompt, not a shell command or a promise to bypass account permissions or macOS security prompts. The repository is currently private; read access is required. Publication and an open-source license are still pending.

## What you get

- Explicit private-chat allowlists and expected Bot identity checks.
- A temporary queued draft, then Telegram Thinking/typing once Dot actually reads the message. No permanent receipt clutter. Current status copy is Chinese.
- One formal reply for short answers. Longer answers use a useful first chunk followed by two or three cumulative edits to the same message, up to 4096 UTF-16 code units. This is chunked output; dotg cannot access Dot's internal token stream.
- Durable incoming-message deduplication, bounded signed-event retries, consecutive reply revisions, and idempotent successful write retries.
- Separate receipt, callback, read, and reply timestamps. Callback acceptance does not imply that Dot has started; host scheduling can add substantial variable delay.
- Fail-closed handling of ambiguous Telegram writes. An operator reconciles uncertain results instead of risking duplicate replies.

The private Mac route has passed live discovery, Events subscription, short reply, cumulative edit, successful retry, and backend restart checks. This is a low-volume, single-owner service. Unattended boot/login recovery, every account configuration, and predictable response latency are not established.

## Guides

| Goal | Guide |
| --- | --- |
| Install or resume with an Agent | [INSTALL.md](INSTALL.md) |
| Connect the private Tunnel | [TUNNEL.md](TUNNEL.md) |
| Configure the Dot event handler | [Dot task instructions](docs/dot-task.md) |
| Inspect, restart, recover, or roll back | [OPERATIONS.md](OPERATIONS.md) |
| Understand security and reporting | [SECURITY.md](SECURITY.md) |
| Contribute and run checks | [CONTRIBUTING.md](CONTRIBUTING.md) |
| Prepare the public release | [Release readiness](docs/release-readiness.md) |
| Understand design and provenance | [ARCHITECTURE.md](ARCHITECTURE.md), [SOURCE_STATUS.md](SOURCE_STATUS.md) |

The [portable plugin template](PLUGIN.md) is for a separately hosted HTTPS backend. Its placeholder is deliberately not installable and is not a Tunnel package. The [Sites adapter](sites/README.md) is source-only with production callback delivery disabled; it is not the supported onboarding route.

## Local development

Use Node.js 22.13+ within 22.x, or 24+, npm, and Python 3 for the optional configuration helper. Prefer a maintained Node LTS.

```sh
npm ci --ignore-scripts
npm run check
npm test
npm run verify:local
npm run build:sites
```

Automated tests use synthetic data and mocked external transports. The loopback probe uses a temporary port and does not interfere with a running installation. These checks do not send real Telegram messages or prove a live Dot connection.
