# Validation record

## Current verification: 2026-10-25

Local runtime: Node.js 22.23.2 on macOS. All tests use synthetic data and mocked external Telegram/callback transports unless explicitly identified as live acceptance.

- `npm run check`: TypeScript JavaScript checking and ESLint passed.
- `npm test`: 59 tests passed, with no failures or skips.
- `npm run verify:local`: authenticated route checks passed on an isolated ephemeral loopback port without production credentials or external transports.
- `npm run build:sites`: Worker source bundle built. Production Sites callback delivery remains disabled.
- `python3 -m unittest discover -s test -p '*_test.py'`: three tests passed, covering private generated configuration, no secret output, overwrite refusal, noninteractive refusal and header-injection rejection.
- macOS launcher compiled and its synthetic self-test passed without reading Keychain or starting a client. Apple currently emits a deprecation warning for `SecKeychainOpen`, used to constrain lookup to the exact login Keychain; this is not a failed compile or evidence of live template acceptance.
- Production dependency audit reported no known vulnerabilities. This is a registry snapshot, not a security guarantee.
- Current source and all reachable historical blobs were scanned for the known local Bot/bearer values and common credential patterns, without printing the values. No matches were found. Historical versions of SOURCE_STATUS.md still contain private development identifiers and require explicit handling before publication.

Regression coverage includes callback delivery independent of MCP reads, single-flight delivery, shutdown draining, delayed request bodies and disconnected clients, subscription generation changes during an in-flight callback, partial reply recovery, per-message native drafts, feedback rate-limit deadlines, late first-read feedback windows, and private configuration file validation.

## Live acceptance boundary

The private Mac installation completed actual Tunnel discovery, four-tool discovery, signed Events subscription and callback delivery, automatic short replies, cumulative edits to a single reply, successful identical write retries, and backend state retention across restart. Queued and processing feedback were observed in the Telegram client. A runtime credential's scheduled expiration can be changed independently of the stored Keychain secret.

Host scheduling remains variable. Callback acceptance is not proof of Dot execution. A long-running event task previously left a sent nonfinal reply; read-tool output now includes its exact text and revision for safe continuation. Recovery of any particular production reply must be observed separately, not inferred from passing tests.

The generic distributable launcher has only synthetic verification; the existing private installation uses its previously approved dedicated launcher. Unattended login/reboot recovery, a clean installation on an independent account, actual Telegram rate limits, portable public HTTPS plugin deployment, and Sites production acceptance remain unverified.

## Earlier checkpoints

On 2026-10-24 the initial implementation passed 41 synthetic tests after a supported executor resolved an earlier loopback-listener permission block. Those historical blocked attempts are not a current product limitation. Earlier source-only reports of no live connection were superseded by the private Mac acceptance described above.

Remote CI is intentionally deferred by the owner. The checks above ran locally; no GitHub Actions run is claimed. A future CI setup should cover supported Node LTS versions and the macOS launcher after the required repository authorization is approved.
