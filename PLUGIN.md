> Preferred private Mac installation: follow [TUNNEL.md](TUNNEL.md), using the official Tunnel connection workflow. The HTTPS package helper below is for a separately chosen public endpoint; it neither provisions a Tunnel nor installs a private Tunnel plugin.

# ChatGPT plugin packaging and connection

The backend alone is not a completed cloud plugin installation. Hosting, account plugin creation, secure host credential entry, and a Dot subscription remain required and untested.

The [official plugin package guide](https://developers.openai.com/plugins/build/plugins) and Plugin Creator package requirements define portable Agent Plugins 1.0 packages with root `plugin.json`, `mcp.json`, and `skills/`. MCP authentication belongs in each server's `extensions.com.openai.auth`; a fixed bearer secret uses `type: api_key` and `headerScheme: bearer`. Credentials must never be included in the package.

`plugin-template/dotg/` contains a manifest, the response workflow skill, and an explicitly noninstallable `mcp.json.example`. A real endpoint is intentionally absent because no backend has been deployed. After a separately authorized deployment and independent endpoint verification, the Agent can prepare package files with the implemented helper:

```sh
python3 scripts/prepare-plugin.py --endpoint https://YOUR_VERIFIED_HOST/mcp --output plugin-build/dotg
```

Replace the uppercase placeholder with the verified backend hostname first. The helper refuses invalid placeholder domains and existing output directories, adds `mcp.json`, and does not contact, deploy, upload, or install anything. Its endpoint syntax validation does not prove ownership, reachability or TLS safety; those must already have been checked. The output is ignored by Git.

The resulting package layout is:

```text
dotg/
  plugin.json
  mcp.json
  skills/telegram-response/SKILL.md
```

For a standalone backend, the Agent can package this one directory into a ZIP through its supported plugin-authoring workflow. After explicit user approval, use the available account Plugin Creator upload/create workflow to save it privately. Check the returned component diagnostics; install/connect through the official host interface. Enter the independently supplied MCP bearer secret only into the host's secure API-key credential prompt. Do not put it in the ZIP, URL, command arguments, or chat. If the selected host/workspace lacks that auth or upload workflow, stop and report the precise gap.

After connection, verify that all four tools and `telegram.message.received` are discovered. In a supported Dot or Work Cloud conversation, obtain the user's explicit instruction to subscribe to that event with its allowed `chat_id` filter. The host, not the Agent, supplies its callback URL and signing secret through `events/subscribe`. A deployed endpoint, an installed package and an active event subscription are separate checks; none has been verified in this work.

If choosing Sites later, do not upload this standalone package as a second wrapper around a Site: [Sites publication creates its corresponding App/plugin](https://help.openai.com/en/articles/20001547-hosting-a-plugin-with-chatgpt-sites). A source-only Sites/D1 adapter and owner-only retry tool are implemented; see sites/README.md. Production callback transport remains disabled until its official trust/egress contract is established, and live publication/connection have not been validated.
