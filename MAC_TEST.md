> Superseded as the preferred route by [TUNNEL.md](TUNNEL.md). The public HTTPS procedures below are an unexecuted alternative and require separate approval. Do not start them as part of the Tunnel installation.

# Personal Mac HTTPS test preparation

This is the alternative Node backend path approved for investigation and local testing. No public tunnel, real credential configuration, Bot webhook change or old-consumer stop has been performed. The Sites source adapter remains separate.

## Verified local prerequisites

- `cloudflared` is installed. The inspected 2026.3.0 source supports accountless Quick Tunnels and the flags below.
- The official Quick Tunnel API responds over HTTPS to a read-only request. This does not prove successful tunnel registration or edge connectivity.
- `npm run verify:local` temporarily binds the actual bridge HTTP server to `127.0.0.1:8787` with synthetic values and disabled external transports. It verifies authentication and path boundaries, then closes the listener.
- `npm run probe:local` starts a separate deny-all loopback probe with no database, credentials, proxying or external calls. It can be used for an explicitly approved public reachability check before entering any secrets. Stop it with Ctrl-C or SIGTERM.

Do not tunnel the synthetic bridge used internally by `verify:local`. Public reachability testing uses only the deny-all probe until real configuration is separately approved.

## Existing routes must not be repurposed

Inspect only the selected service configuration's nonsecret ingress metadata, never certificate or credential-file contents. Existing named tunnels may expose unrelated applications. If no running, appropriately scoped route exists, do not restart a multi-service tunnel, repurpose its hostname, change its DNS, or read its stored credentials merely to get dotg online.

For this test, the proposed fallback is a new, temporary accountless Quick Tunnel with a dedicated empty configuration. This does not require buying hosting or a domain, using an existing account certificate, or manually creating an API token. Cloudflared negotiates transient tunnel credentials in memory. Starting it is still a new public network path and requires explicit confirmation.

## Exact proposed exposure

| Boundary | Scope |
| --- | --- |
| Public hostname | Random HTTPS `*.trycloudflare.com` hostname returned after an approved start; no hostname is invented now. |
| Tunnel origin | Only `http://127.0.0.1:8787`. No arbitrary proxy destination or LAN binding. |
| Active application routes | `POST /mcp` and `POST /telegram/webhook`; all unrelated paths and methods return 404. |
| Reachability-only phase | Both recognized routes return 401 unconditionally; there are no credentials or Bot actions. |
| Live phase, separately approved | `/mcp` requires the MCP bearer secret; Telegram intake requires its configured secret header and explicit private allowlist. |
| Diagnostics | Cloudflared metrics bind to `127.0.0.1` on an ephemeral port; management diagnostics are disabled and never routed by dotg. |
| Other local services | DSH, model gateways, existing tunnel origins and the rest of the Mac are not forwarded. |

Cloudflare terminates the public HTTPS connection and proxies the requests through its encrypted tunnel to local HTTP. That third-party processing scope is part of the approval. This path does not require an inbound router port-forward or disabling a firewall. If outbound connectivity is blocked, report the exact failed connection instead of changing network security settings.

## Prepared configuration and command, not executed publicly

Create a new ignored `runtime/quick-tunnel.yml` containing exactly `{}` with mode 0600 in a mode-0700 runtime directory. Refuse to overwrite an existing nonempty file. This dedicated config prevents accidental reuse of an existing multi-service ingress configuration. It intentionally contains no ingress rules: `ingress validate` reports that absence, which is expected for the `--url` Quick Tunnel path.

After explicit confirmation, start the deny-all probe first and use the following command from the repository root. CLI version and binary location must already have been verified on the target Mac:

```sh
env -u TUNNEL_TOKEN -u TUNNEL_TOKEN_FILE -u TUNNEL_ORIGIN_CERT \
  -u TUNNEL_NAME -u TUNNEL_URL -u TUNNEL_CRED_FILE \
  cloudflared tunnel --config ./runtime/quick-tunnel.yml \
  --no-autoupdate --protocol http2 --metrics 127.0.0.1:0 \
  --management-diagnostics=false --url http://127.0.0.1:8787
```

Do not execute this command based only on approval of the general Mac architecture. Do not use `--name`, `login`, `create`, `route dns`, a stored account certificate, or a service-install command. Do not enable debug logging because request headers can contain credentials. If logs are retained for the test, create their ignored runtime file with mode 0600 and never print request headers or bodies.

The API uses HTTPS; `--protocol http2` uses outbound TCP port 7844 to Cloudflare's edge. No UDP or inbound security rule change is proposed. Quick Tunnels have changing hostnames, no uptime guarantee and no SSE support. The implemented stateless JSON-RPC POST workflow does not require SSE. A restarted tunnel invalidates the old URL, requiring explicit endpoint and webhook reconfiguration before reuse.

## Credentials: a later, concrete approval

The reachability probe uses none. For live integration, the current supported local input helper writes only `config.local.json` in this checkout, mode 0600, and refuses overwriting an existing file. It makes no network requests and does not create or rotate the Bot token.

The planned file contains the existing Bot token, independently supplied MCP bearer secret, webhook verification secret, local owner ID and private chat allowlist. The service's private SQLite data is stored at `runtime/dotg.sqlite`, mode 0600 inside `runtime/`, mode 0700. Subscriptions and callback signing secrets remain in that database; no secret goes into plugin files, source control or command arguments.

Immediately before this step, confirm the exact storage destination and permission to use that Bot credential. Do not read an existing credential store to fill it. Use a supported secure input surface. The present helper requires a visible local interactive terminal; while the user is on their phone, defer real credential entry unless a verified mobile-capable secure input route is available. Do not request tokens in chat or require desktop work for the preceding credential-free probe.

## Verification and cutover order

1. With permission, expose only the deny-all probe, record the actual returned HTTPS hostname and PID, and verify TLS, 401 on the two POST routes, and 404 elsewhere. Keep DSH running. If this fails, stop only the new probe/tunnel and leave everything else untouched.
2. After separate secure configuration approval, stop the probe and start the real loopback Node bridge using the approved private configuration. Verify authenticated discovery and redacted status locally and through the same tunnel; anonymous requests must still fail.
3. Prepare the private plugin package with the actual verified HTTPS `/mcp` endpoint. Complete official plugin installation and secure MCP API-key input, then verify subscription creation and signed challenge acceptance before touching Telegram routing.
4. Confirm the intended private chat ID and a reversible old-consumer stop. A normal stop of a shared DSH Host also affects its other channels; do not silently substitute it for a Telegram-only pause. Do not modify DSH source or delete its Bot account.
5. Only after the replacement is ready, stop the approved old consumer, verify its exit, and set the Bot webhook without dropping pending updates. Run the authorized nonpersonal Telegram -> Dot -> Telegram test and same-message edit checks.

## Rollback

Before any Bot switch: stop only the recorded Quick Tunnel process and the local probe/bridge. The random public URL stops working; the old consumer continues unchanged. Do not use a broad `pkill cloudflared` or restart an existing named tunnel.

After an approved Bot switch: stop new Dot-driven writes and the replacement intake, remove the replacement webhook without dropping pending updates, confirm that its URL is empty, then restore the old consumer from the preserved configuration and cursor. Verify no duplicate consumers. Required credential use and the impact of any whole-service restart must already have been explicitly approved.

For a bounded reachability test, stop both newly started processes at the end of the agreed window. Do not install launchd jobs or establish an ongoing tunnel as part of a temporary test.

Sources: [Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/), [installed-version Quick Tunnel implementation](https://github.com/cloudflare/cloudflared/blob/2026.3.0/cmd/cloudflared/tunnel/quick_tunnel.go), and [Cloudflare tunnel firewall requirements](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/tunnel-with-firewall/).
