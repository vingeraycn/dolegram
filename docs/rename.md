# Renaming dotg to dolegram

The public project is now **dolegram**: Use ChatGPT Dot in Telegram.

The canonical repository is https://github.com/vingeraycn/dolegram. Update existing Git remotes to that URL when convenient. Public documentation, the npm package name and the separately hosted HTTPS plugin template use dolegram. The original v0.1.0 tag is preserved; use the default branch for current branding and guides.

## Existing installations

This is a branding change, not a runtime migration. Keep these identifiers unchanged for both existing installations and the current setup scripts:

- `DOTG_*` environment variables and configuration schema.
- `io.dotg.backend` and `io.dotg.tunnel` launchd labels.
- The `dotg` Tunnel profile and existing host connection identity.
- The default `runtime/dotg.sqlite` database path, SQLite table names and `dotg-snapshot` backup format.
- Existing Keychain service/account, trusted launcher executable and its code signature.

Operator messages and some internal names may still say dotg. Do not rebuild or replace an approved Keychain launcher, recreate a connection, rename runtime directories, or start another Telegram consumer just to match the new name. No credentials, subscriptions or message data need migration. The unchanged service labels intentionally prevent the branding change from installing a second managed consumer.

## Portable plugin template

The separate HTTPS packaging helper now reads `plugin-template/dolegram/` and emits a server named `dolegram`. This template remains noninstallable until an independently verified HTTPS endpoint is supplied. It does not modify an existing private Tunnel connection; keep that connection and its event subscription intact.
