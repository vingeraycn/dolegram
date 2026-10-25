# Reconcile a reply observed in Telegram

A transport timeout cannot tell dotg whether Telegram accepted a write. The backend blocks that message rather than send a possible duplicate. This offline tool supports one recovery case: an authorized operator independently finds the exact Bot reply in Telegram and records the successful outcome. It never sends, edits, deletes, infers that a missing reply was not sent, or clears a blocked intent for retry.

This procedure is for the standalone polling installation, using Python 3.11 or newer. It is not a Sites/D1 repair tool. Synthetic tests cover an actual SQLite snapshot, exclusive lease, refusal paths, and the real Bridge's successful retry and next-edit behavior. Production ambiguous-write recovery has not been exercised deliberately.

## 1. Preserve and inspect

Use the private installation record to locate the exact database and configuration. Confirm the intended Bot and owner. Obtain the blocked message key through authorized local inspection or the original task; do not guess it from the newest Telegram message. No credential goes in an argument.

Create a private review directory, then write a new review file:

```sh
mkdir -m 700 /ABSOLUTE/PRIVATE/REVIEW
python3 scripts/reconcile.py inspect \
  --database /ABSOLUTE/PRIVATE/RUNTIME/dotg.sqlite \
  --config /ABSOLUTE/PRIVATE/config.local.json \
  --message-key telegram_VERIFIED_UPDATE_ID \
  --output /ABSOLUTE/PRIVATE/REVIEW/reply.local.json
```

Inspection is read-only and can run while the backend is active. The output is mode 0600 and must not already exist. It contains private reply text and identifiers: do not commit, upload or paste it into chat. The command prints only fixed guidance. It does not open the application Store or convert pending operations into uncertain ones.

The file contains a `reference` copied from stored intent, a fingerprint of the original message state, and `observed: null`. **Reference data proves only what dotg attempted. It does not prove what Telegram received.**

## 2. Independently verify the reply

Use an authorized Telegram client or export to verify the actual Bot sender, private chat, original message being replied to, exact complete reply text and Telegram message ID. For an edit, the observed ID must equal the previously stored reply ID. Do not mistake an earlier revision, forwarded copy, human message or same-text reply to another question for the intended response.

When authorized and supported, the Agent can perform this inspection. Owner participation is needed only for evidence or access the Agent cannot obtain. If the client does not expose a trustworthy message ID or reply association, preserve the blocked state; do not invent an ID or infer it from neighboring messages.

Fill only `observed` from that independently verified evidence:

```json
{
  "botId": "VERIFIED_BOT_ID",
  "chatId": "VERIFIED_PRIVATE_CHAT_ID",
  "replyToMessageId": 100,
  "messageId": 101,
  "text": "The exact complete reply observed in Telegram."
}
```

This is a shape example, not usable evidence. IDs are strings for Bot/chat and positive integers for messages. Preserve the generated top-level fields. Never populate `observed` by blindly copying `reference`, and never use a checksum or the confirmation flag as a substitute for real observation. Differences in text, including whitespace, must be investigated rather than normalized away.

## 3. Apply while stopped

Stop only the matching backend through its supported service control or SIGTERM, then verify its exit. Preserve the existing consumer arrangement. A running backend holds the same OS lease used by this tool; reconciliation will refuse to proceed. Never delete a lease or legacy lock file.

Choose a new snapshot directory inside an existing private backup parent:

```sh
python3 scripts/reconcile.py confirm-sent \
  --database /ABSOLUTE/PRIVATE/RUNTIME/dotg.sqlite \
  --config /ABSOLUTE/PRIVATE/config.local.json \
  --review /ABSOLUTE/PRIVATE/REVIEW/reply.local.json \
  --backup-destination /ABSOLUTE/PRIVATE/BACKUPS/before-reconciliation \
  --observed-in-telegram
```

The tool checks the exact owner/allowlist, configured Bot, original message association, text and existing edit ID. It rejects another message's reply ID. It creates and verifies a full private snapshot before modification, then compares the current state inside a write transaction. A stale review, changed database, occupied lease, existing backup destination or failed snapshot stops the operation. Preserve any incomplete output for inspection.

Success records the observed message ID and marks only that stored write as sent. An audit entry retains the prior status, revision, observation time, review hash and snapshot hash. The tool does not fabricate the unknown delivery time. Re-running the same reconciliation refuses the already-completed state; ordinary identical Bot tool retries still return the stored result without another Telegram write.

## 4. Resume and verify

Restart through the normal launcher and inspect the reply from the real host. A final reply stays complete. A nonfinal reply can continue from the exact stored text and revision using the normal cumulative-edit contract. No duplicate subscription or automatic resend is needed.

Keep the private review and snapshot for recovery evidence. If a review was wrong, stop and investigate; do not restore an old snapshot over current data. Use the separate [staged recovery](backup.md) procedure. Reconciliation does not clear a restored database's startup guard, expire subscriptions or approve unrelated callback delivery state.

If no matching reply can be confirmed, this tool deliberately leaves the uncertainty unresolved. Telegram's visible absence is not reliable proof of non-delivery. Automatic absence detection, resend approval and arbitrary database repairs are unsupported.
