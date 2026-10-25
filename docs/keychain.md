# macOS Keychain and the Tunnel runtime

The runtime key is separate from the Telegram Bot token and MCP bearer. Use a dedicated key restricted to Tunnels Read + Use. The organization/workspace must already be associated with the intended Tunnel. Select the credential lifetime with the owner; the official API-key editor may offer **Never** for an existing key, avoiding rotation and another secret transfer. Verify the saved expiration and unchanged permissions afterward. Do not automatically renew keys or widen their scope.

## Store and select one item

Use an approved secure credential flow to save the runtime key as one generic-password item in the local login Keychain. Record its exact service and account, without its value. Keep “Allow all applications” off and preserve the system confirmation requirement. Do not write the secret through command arguments or copy it into chat. Tool-specific credential or OS restrictions take precedence over this guide.

The owner may have to approve the compiled launcher in the macOS system prompt. The Agent must not bypass that prompt. An existing approved launcher can be retained; replacing its executable may cause macOS to ask again.

## Reproducible launcher template

`scripts/keychain-launcher.swift` uses Apple Security APIs to read exactly the configured item. It reads the MCP bearer from an owner-only regular configuration file and passes both secrets only in the official client's process environment. Normal and discovery requests receive `Authorization: Bearer …`. The private host connection can use No authentication while the backend keeps bearer enforcement; obtain authorization for this local upstream credential use.

Install and verify the official [tunnel-client release](https://github.com/openai/tunnel-client/releases) first. The template's flags were checked against v0.0.18; inspect your installed client's help before using a different version. Put the verified executable at `RUNTIME/bin/tunnel-client`, owned by the current user and not group/world-writable. Use a dedicated runtime directory with mode 0700. Never execute an unverified download merely because its filename matches.

Compile and test without accessing any real credential:

```sh
mkdir -p runtime
chmod 700 runtime
swiftc scripts/keychain-launcher.swift -o runtime/dotg-keychain-launcher
runtime/dotg-keychain-launcher --self-test
```

Create an ignored `launcher.local.json` with mode 0600. The following is a schema example, not runnable configuration; replace every placeholder with a verified nonsecret value:

```json
{
  "runtimeDirectory": "/ABSOLUTE/PRIVATE/RUNTIME",
  "backendConfig": "/ABSOLUTE/CHECKOUT/config.local.json",
  "keychainService": "APPROVED_ITEM_SERVICE",
  "keychainAccount": "APPROVED_ITEM_ACCOUNT",
  "organizationID": "org-VERIFIED",
  "tunnelID": "tunnel_VERIFIED"
}
```

After exact-item access and the destination are authorized, check the compiled launcher without stopping a working client:

```sh
runtime/dotg-keychain-launcher --check-access /ABSOLUTE/PATH/launcher.local.json
```

This mode disables optional Keychain prompts, validates the same configuration and credential reads as a real launch, and exits without starting a client or contacting the control plane. Success confirms access at that moment only; it does not prove access after login, reboot, locking or an executable update. Failure leaves the working client intact and returns fixed guidance with exit code 78.

If foreground authorization is needed, use the same binary at its final installation path:

```sh
runtime/dotg-keychain-launcher --authorize-access /ABSOLUTE/PATH/launcher.local.json
```

This reads only the configured item and permits the owner-controlled system prompt; it still never starts a client. The Agent must not operate the prompt or change the item's access policy. A one-time Allow may not authorize later background reads. After the owner responds, repeat `--check-access` as a new process. If it still fails, preserve the existing policy and report that unattended startup is unavailable. Persistently trusting the dedicated executable is a separate owner decision, not implied by one-time read approval. Never enable access for all applications.

After successful preflight and an authorized sole-client handover, run:

```sh
runtime/dotg-keychain-launcher --run /ABSOLUTE/PATH/launcher.local.json
```

The launcher replaces itself with the official client, preserving normal signal handling and avoiding an orphaned child. It does not create/update Keychain items, change ACLs, create Tunnels, or enable Telegram polling. It does not write literal secrets to arguments or profiles. Raw client output and tracing are disabled; use the client's loopback `health.url`, `/healthz`, and `/readyz`, then verify a real host tool call. A synthetic self-test is not a live Keychain/Tunnel test.

For opt-in login startup, use the separate [service manager](service.md). It invokes `--run-background`, which disables optional Keychain interaction in that process and fails closed when access is unavailable. It never changes the item's ACL or unlocks Keychain. A policy requiring confirmation may prevent unattended startup. Keep a verified existing runtime running until an explicitly planned replacement is ready; never start a second client or backend blindly. See [OPERATIONS.md](../OPERATIONS.md) for shutdown, restart and acceptance boundaries.
