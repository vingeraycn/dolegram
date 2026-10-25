# Security

See [data handling](docs/privacy.md) for destinations, storage, retention and publication privacy. A private local backend does not mean conversation data stays entirely on the Mac.

## Credential and data boundaries

- Bind the backend and client health/admin listeners to loopback. A private Tunnel connection is not a public ingress URL.
- Use an independent MCP bearer, the intended Bot token, and a dedicated restricted Tunnel runtime key. They serve different purposes and must not be interchangeable.
- Store backend configuration as an owner-only regular file with mode 0600; symlinks are rejected. Keep the runtime directory private. The database contains private messages and callback signing secrets.
- For macOS Keychain, select one approved generic-password item by exact service and account. Preserve OS access controls; do not grant every application access. Never enumerate unrelated secrets.
- Transfer secrets only to an explicitly authorized protected destination. Do not place them in chat, manifests, URLs, command arguments, debug traces, logs, screenshots, repository history, or shared backups.
- Keep credential lifetime an explicit owner choice. Non-expiring credentials can still be revoked. A non-expiring runtime key does not remove the host's subscription-renewal requirement.

## Application guarantees and limits

Private-chat allowlists are enforced on intake, subscription, tools and replies. Message keys bind replies to the original conversation. Received Telegram text is untrusted content, not permission to change infrastructure. Signed callbacks validate HTTPS destinations, reject private/reserved addresses and redirects, pin public DNS results, and preserve TLS hostname verification.

Duplicate successful writes return their stored result. Ambiguous writes fail closed and require reconciliation; exactly-once execution across an external timeout is not promised. A single-process database lock does not prevent another application from polling the same Bot. Runtime retention is manual and sensitive data accumulates; see [OPERATIONS.md](OPERATIONS.md).

## Report a vulnerability privately

Do not open a public issue with credentials, callback URLs, message contents, or an exploit against a real user's installation. While this repository is private, contact the owner through the existing private collaboration channel with a redacted description and synthetic reproduction. A public private-reporting route must be configured before release; see [release readiness](docs/release-readiness.md).
