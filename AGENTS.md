# Agent instructions

Read README.md and INSTALL.md before installation work; read ARCHITECTURE.md and CONTRIBUTING.md before implementation work. Keep repository content in English and communicate in the owner's preferred language.

For desktop installation, read docs/desktop-install.md first. Check actual local capabilities and explain required owner participation before creating resources. Use docs/privacy.md to explain message destinations and storage accurately.

- Inspect and preserve existing changes, running services, credentials and private connections. Resume matching resources instead of rebuilding them.
- Use synthetic configuration and isolated databases for tests. Never print secrets or open the application's Store on a live database for read-only inspection.
- Keep one Telegram consumer. Verify actual host discovery and signed Events subscription before handing over intake. Preserve the old consumer and rollback.
- Keep polling opt-in, loopback binding, private configuration, least-privilege credentials, reply invariants, and fail-closed uncertain writes.
- Do not guess Tunnel URLs or install the placeholder plugin package. The private Tunnel and Sites routes have different capabilities.
- Reuse authorization already given. Respect actual tool restrictions and OS prompts; report an exact blocker rather than inventing a product limitation or bypassing a rejection.
- Run the checks in CONTRIBUTING.md after behavioral changes. Local tests, Tunnel readiness, callback acceptance, and real end-to-end replies are separate evidence levels.
- Do not publish the repository, select a license, rewrite Git history, revoke credentials, or delete runtime data without the owner's instruction.
