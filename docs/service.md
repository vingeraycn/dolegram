# macOS login services

The Agent can install per-user launchd jobs for the backend and Tunnel after the manual route has passed real acceptance. These jobs run after the owner logs in, not before login or while the Mac is asleep. This is an opt-in lifecycle feature, not proof of unattended availability on every Mac.

The service manager never creates credentials, reads Keychain, pauses another application, or deletes private data. It operates on one component at a time. It refuses to overwrite a different job using the same label. Keep the exact previous launch commands and reviewed commit for rollback.

## Prepare a private installation record

Have the Agent create an ignored `installation.local.json` with exclusive creation and mode 0600. Resolve the existing paths; do not ask the owner to transcribe them. It contains no secret values. Keep installation evidence, account/resource identifiers and prior-consumer rollback in a separate private `installation.local.md`.

```json
{
  "version": 1,
  "checkout": "/ABSOLUTE/CHECKOUT",
  "nodeExecutable": "/ABSOLUTE/SUPPORTED/NODE",
  "pythonExecutable": "/ABSOLUTE/PYTHON3",
  "configPath": "/ABSOLUTE/CHECKOUT/config.local.json",
  "databasePath": "/ABSOLUTE/PRIVATE/RUNTIME/backend/dotg.sqlite",
  "runtimeDirectory": "/ABSOLUTE/PRIVATE/RUNTIME",
  "pollingEnabled": true,
  "tunnelLauncher": "/ABSOLUTE/PRIVATE/RUNTIME/bin/dotg-keychain-launcher",
  "tunnelSettingsPath": "/ABSOLUTE/PRIVATE/RUNTIME/launcher.local.json"
}
```

Replace every placeholder. `pollingEnabled` must match the authorized consumer state; use false before handover. `callbackDnsServers` is optional and preserves an explicitly selected callback resolver. Omit both Tunnel fields when managing only the backend. Unknown fields are refused so credentials cannot accidentally become plist environment values. Keep private runtime directories mode 0700 and configuration/launcher settings mode 0600.

Use stable absolute executable paths, including a supported Node LTS. Shell version managers and interactive shell profiles are not loaded by launchd. A runtime upgrade that removes an executable requires a reviewed record/plist update, not a global runtime change.

## Keychain behavior

The Tunnel job requires the [current launcher template](keychain.md), including `--run-background` and exec-based process ownership. Do not point it at an older child-spawning launcher. Preserve a working launcher until its replacement has been reviewed and tested; compiling a new binary may trigger a new owner-controlled authorization prompt during a foreground test.

Background mode disables optional Keychain interaction in that process. A locked Keychain, missing item, denied access, or a policy requiring confirmation can prevent startup. No access policy is changed and no system prompt is automated. Pre-client failure exits with code 78; job status reports fixed guidance without raw errors or credential values. launchd retries unsuccessful exits with a minimum 60-second throttle and without authorization popups. The owner's existing confirmation policy can therefore prevent fully unattended recovery. Report that limitation rather than widening Keychain access silently.

To authorize a foreground test, first unload the Tunnel job and verify all previous clients have stopped. Run the approved launcher's `--run` command and let the owner handle any actual system prompt. Stop the foreground client before restarting the job. One-time approval does not establish future background access; test it explicitly.

## Install and hand over

From the checkout, inspect the plan, then install **one** component:

```sh
python3 scripts/service.py plan --record /ABSOLUTE/PATH/installation.local.json --component backend
python3 scripts/service.py install --record /ABSOLUTE/PATH/installation.local.json --component backend
```

The backend label is `io.dotg.backend`; the Tunnel label is `io.dotg.tunnel`. Plists are owner-only files in `~/Library/LaunchAgents`. Installing does not start a job immediately, but schedules it for the next login. Do not install while an unmanaged launcher is also configured to start at login.

Complete the scoped handover: gracefully stop the exact old backend/client, verify process and listener exit, and preserve a private closed-database backup. Keep DSH or other previous-consumer settings intact. Then:

```sh
python3 scripts/service.py start --record /ABSOLUTE/PATH/installation.local.json --component backend --handover-complete
python3 scripts/service.py status --record /ABSOLUTE/PATH/installation.local.json --component backend
```

Repeat for `--component tunnel` only after its own handover is ready. The flag is an operator acknowledgement, not an automatic check for all competing Telegram clients. The backend additionally checks port 8787 and its database lease; neither detects other applications polling the same Bot. Repeating install/start resumes matching resources rather than replacing or duplicating them.

Use `npm run doctor -- --tunnel-health-file /ABSOLUTE/PRIVATE/RUNTIME/health.url`, then verify a real host tool call, signed subscription and Telegram reply/edit. A loaded or running job is not evidence of readiness. Backend identity/conflict failures stop polling while leaving diagnostics available; they are not automatically retried by restarting the backend. Inspect the actual conflict before a controlled stop/start.

## Shutdown, upgrades and rollback

```sh
python3 scripts/service.py stop --record /ABSOLUTE/PATH/installation.local.json --component backend
python3 scripts/service.py uninstall --record /ABSOLUTE/PATH/installation.local.json --component backend
```

`stop` verifies both the installed plist and loaded job definition, then unloads only the matching job. Its total inspection/shutdown budget is 55 seconds, covering launchd's 45-second exit grace. If exit cannot be confirmed, or no PID was available in the snapshot, inspect the process and listener before starting another consumer. `stop` alone leaves the login plist, so it can run at the next login. `uninstall` requires an unloaded matching job and removes only its plist. The database, credentials, private record and runtime are preserved. Apply the same procedure to the Tunnel when retiring it. Service stdout/stderr are discarded; status and doctor provide bounded diagnostics without raw client logs.

Before changing record paths or job settings, stop and uninstall using the **old** record, keep a private copy of that record, then install from the new one. Before updating source in the running checkout, stop the backend and back up the closed database as described in [OPERATIONS.md](../OPERATIONS.md). Do not update underneath an active process and call it deployed. Restore the previous reviewed source and launch configuration if acceptance fails, with only one consumer active.

The backend starts through `npm start` or `python3 scripts/run-backend.py --node /ABSOLUTE/NODE`. Its OS lease survives exec and is released by the kernel on process exit, including crashes. The `.lease` file remains deliberately: never delete it. Direct `node src/server.mjs` refuses startup without the inherited lease. A pre-lease `.lock` blocks startup; stop that legacy backend cleanly so it releases its own lock. Do not delete a lock as a shortcut.

## Acceptance evidence to record

- Synthetic tests: private records, idempotent installation, foreign-job preservation, redacted status, unavailable login domains, crash lease release, startup failure and uncertain-write recovery.
- Local live services: actual job start/stop, one process, loopback authentication, Tunnel readiness, host tools/subscription and a fresh Telegram reply/edit.
- Owner-session recovery: login/reboot, locked Keychain, network interruption and controlled crash recovery. Record which were actually exercised; unit tests and a manual restart do not establish these results.

References: [Apple launchd jobs](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html), [Python flock](https://docs.python.org/3/library/fcntl.html#fcntl.flock), and the installed macOS SDK's Security framework interaction API.
