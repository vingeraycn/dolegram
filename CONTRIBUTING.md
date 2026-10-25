# Contributing

The repository is preparing for a public release under the [MIT License](LICENSE). Contributions are made under the same license. Keep code, comments, commit messages and documentation in English. Do not alter repository visibility or rewrite history as routine cleanup.

## Development checks

Use a maintained Node LTS supported by package.json and the committed lockfile, plus Python 3.11 or newer. Python is required by the standalone runtime launcher as well as configuration, backup and lifecycle tests.

```sh
npm ci --ignore-scripts
npm run check
npm test
npm run verify:local
npm run build:sites
python3 -m unittest discover -s test -p '*_test.py'
```

On macOS, also compile and run the launcher self-test described in [docs/keychain.md](docs/keychain.md). Tests use synthetic secrets and mock external transports; do not load production configuration or runtime databases. Keep verification bounded and isolated from port 8787. Live acceptance must be identified separately from mock coverage.

Preserve authorization, deduplication, reply revisions, uncertain-write blocking, callback SSRF checks, single-consumer handover, and graceful shutdown. Add regression coverage for behavioral fixes. Avoid generic abstractions or migrations without a concrete problem. The Sites alternative has distinct limitations; do not assume parity with the Node backend.

Before committing, review the complete diff, staged paths, generated files and history being pushed for secrets and private identifiers. Ignore rules are not proof of absence. Run `git diff --check`. Changes to credential handling, event contracts, or lifecycle behavior require explicit review of failure paths and a rollback description.
