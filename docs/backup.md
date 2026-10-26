# Private backups and staged recovery

The Agent can create and verify a consistent SQLite snapshot while dolegram is running. Recovery is deliberately staged: it never replaces the live database or starts a consumer. An older snapshot cannot establish what Telegram or ChatGPT did afterward, so restoring it directly could repeat an answer or lose acknowledged messages.

This tool supports the local polling route. Use Python 3.11 or newer and a dolegram release containing `scripts/backup.py` and the recovery guards in `src/runtime.mjs`. Do not open a restored database with an older release that lacks these guards. This is a manual operator workflow; scheduled backups, retention deletion and automatic reconciliation are not implemented.

## Create and verify

Use an existing owner-only parent directory (mode 0700). Each destination must be new, even if an existing directory is empty. The Agent should resolve the existing database path from the private installation record and choose a timestamped destination outside Git, rather than asking the owner to transcribe paths.

```sh
python3 scripts/backup.py create --database /PRIVATE/RUNTIME/backend/dotg.sqlite --destination /PRIVATE/BACKUPS/NEW-SNAPSHOT
python3 scripts/backup.py verify --snapshot /PRIVATE/BACKUPS/NEW-SNAPSHOT
```

The destination contains `state.sqlite` and `snapshot.json`, both mode 0600. SQLite's online backup API includes committed WAL data and produces a consistent snapshot during concurrent writes. It does not instantiate the application Store or turn pending replies into uncertain replies in the original database. Copying a live database with a normal file-copy command is not equivalent.

Verification checks the format, SHA-256 checksum, SQLite integrity, state shape and aggregate counts. The checksum detects accidental changes; it does not authenticate a snapshot against a malicious local user. Creation and verification print aggregate counts only. Snapshot files contain plaintext conversation data, callback addresses, signing secrets and reply/deduplication state. They are not encrypted and must not be uploaded, committed or included in diagnostic reports. Configuration and Keychain credentials are excluded and must remain available through their existing protected destinations.

The supported logical database size is at most 256 MiB, including committed WAL pages. Copying has a 30-second deadline and bounded lock waits. Oversized or continuously busy databases require a reviewed maintenance procedure. A failure preserves the source and may leave an incomplete destination: keep it for inspection, choose a new destination on retry, and never treat a directory without a valid manifest as a backup. No snapshots are silently deleted.

## Restore into quarantine

```sh
python3 scripts/backup.py restore --snapshot /PRIVATE/BACKUPS/SNAPSHOT --destination /PRIVATE/RECOVERY/NEW-CANDIDATE
```

The recovery parent must also be private. Restore verifies the snapshot, copies it into a new directory and adds a durable startup guard before publishing `state.sqlite`. It preserves the snapshot and live database, copied offsets and all recorded reply evidence. It does not start a service or contact Telegram or ChatGPT. An interrupted restore may leave `.partial.sqlite`; that file must never be started.

The restored candidate refuses standalone startup until offline review is recorded. Before approving it, the Agent must:

1. Locate and preserve the newer live database, if one exists. Stop the exact current backend and verify process/listener exit before the final comparison and any candidate startup. Keep the old installation record, source release and prior-consumer rollback.
2. Compare snapshot time and offsets against newer state and the authorized Telegram conversation. Account for messages and replies after the snapshot. Messages acknowledged after the snapshot may no longer be retrievable from Telegram; a backup does not reverse an external acknowledgement.
3. Resolve any uncertain writes, unanswered or partial replies, and unfinished callbacks from actual evidence. Never invent a Telegram message ID, clear a pending write, or mark a delivery complete just to pass the guard. There is no supported reconciliation command yet. If evidence or a supported reconciliation procedure is unavailable, preserve the candidate and stop recovery; prefer the newer intact database when possible.

Approval requires zero unresolved replies and zero unfinished callback deliveries in the candidate. That condition alone does not prove external-state reconciliation: even a fully completed older snapshot can omit later activity.

```sh
python3 scripts/backup.py approve-restore --directory /PRIVATE/RECOVERY/CANDIDATE --reviewed-external-state
```

The flag records the operator's completed review, not an automated check of Telegram. Approval holds the same OS lease as the backend, so it refuses a running candidate. It expires copied subscriptions and clears their verification cache, forcing a new signed challenge. No process is started and polling remains gated. Never delete a `.lease` file to bypass contention.

## Reconnect and hand over

1. Using a release with recovery guards, prepare a private candidate installation record with the restored database path and polling disabled. Preserve the original record. Stop/uninstall a matching old job with its original record before installing the new definition; see [service management](service.md).
2. Start only this candidate on the intended loopback endpoint. Verify actual host tool discovery and establish fresh signed subscriptions for every allowlisted chat through the intended private connection. Reuse matching host resources. Copied subscription records are not evidence of a new handshake.
3. Stop and uninstall the candidate job using its original polling-disabled record. Preserve that record, prepare the polling-enabled record, install its matching job definition and start it only after the sole-consumer handover. Merely editing the record leaves a mismatched plist that the service manager will refuse. Startup refuses polling without current subscriptions verified after restoration. Do not modify the recovery marker to bypass this check.
4. Verify a real Telegram message, reply, in-place edits and identical retry behavior. Record any lost post-snapshot state accurately. Keep the old database and release private until the owner decides their retention.

If acceptance fails, stop the candidate before restoring the previous installation record and intact database. Reconcile any external writes made during the trial before switching again. Never automatically replay old events or start two polling consumers.

References: [SQLite online backup](https://www.sqlite.org/backup.html) and [Python SQLite backup](https://docs.python.org/3/library/sqlite3.html#sqlite3.Connection.backup).
