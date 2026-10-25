"""Record independently observed Telegram success; never send or infer absence."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import sys
import time

import backup
from runtime_lease import acquire_lease


class ReconciliationError(Exception):
    """Fixed guidance without private message contents or upstream errors."""


def require(condition, guidance):
    if not condition:
        raise ReconciliationError(guidance)


def digest(value):
    result = hashlib.sha256()
    encoder = json.JSONEncoder(sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False)
    for chunk in encoder.iterencode(value):
        result.update(chunk.encode())
    return result.hexdigest()


def positive_id(value):
    return type(value) is int and 0 < value <= 9007199254740991


def candidate(state, config, key):
    require(isinstance(config, dict) and config.get('telegramMode') == 'polling'
            and isinstance(config.get('expectedBotId'), str)
            and config['expectedBotId'].isdigit(), 'Use the verified polling installation configuration.')
    message = state['messages'].get(key)
    require(isinstance(message, dict) and message.get('owner') == config.get('ownerId')
            and isinstance(message.get('owner'), str) and message['owner']
            and isinstance(config.get('allowedChatIds'), list)
            and message.get('chatId') in config['allowedChatIds']
            and message.get('messageKey') == key and positive_id(message.get('messageId')),
            'Message is outside this installation or has an unsupported identity.')
    reply = message.get('reply')
    require(isinstance(reply, dict) and reply.get('status') in ['pending', 'uncertain'],
            'Only an unresolved stored write can be reconciled. Do not alter completed replies.')
    revision = reply.get('revision')
    require(type(revision) is int and 1 <= revision <= 4 and type(reply.get('final')) is bool
            and isinstance(reply.get('text'), str) and reply['text'].strip()
            and len(reply['text'].encode('utf-16-le')) // 2 <= 4096,
            'Stored reply intent is unsupported; preserve it for diagnosis.')
    require((revision == 1 and reply.get('messageId') is None)
            or (revision > 1 and positive_id(reply.get('messageId'))),
            'Stored send/edit identity is inconsistent; preserve it for diagnosis.')
    require(not (revision == 2 and reply['final']) and not (revision == 4 and not reply['final']),
            'Stored revision does not follow the reply contract.')
    return message, reply


def inspect(database, config_path, key, output):
    config = backup.read_json(config_path)
    with backup.database(database) as db:
        state, _ = backup.state_summary(db)
        message, reply = candidate(state, config, key)
    output = Path(output).absolute()
    backup.private_directory(output.parent)
    backup.write_json(output, {'format': 1, 'messageKey': key, 'expectedMessageSha256': digest(message),
                              'reference': {'botId': config['expectedBotId'], 'chatId': message['chatId'],
                                            'replyToMessageId': message['messageId'], 'intent': reply},
                              'observed': None})
    backup.sync_directory(output.parent)
    return {'result': 'private-review-created',
            'action': 'Independently inspect the actual Telegram reply. Fill observed only from that evidence; reference is stored intent, not proof of delivery.'}


def validate_review(state, config, review):
    require(isinstance(review, dict) and type(review.get('format')) is int and review['format'] == 1
            and isinstance(review.get('messageKey'), str), 'Unsupported private review format.')
    message, reply = candidate(state, config, review['messageKey'])
    require(review.get('expectedMessageSha256') == digest(message),
            'Message changed since inspection; create a new review before proceeding.')
    observed = review.get('observed')
    require(isinstance(observed, dict) and set(observed) ==
            {'botId', 'chatId', 'replyToMessageId', 'messageId', 'text'},
            'Independent Telegram evidence is missing or incomplete.')
    require(observed['botId'] == config['expectedBotId'] and observed['chatId'] == message['chatId']
            and type(observed['replyToMessageId']) is int and observed['replyToMessageId'] == message['messageId']
            and positive_id(observed['messageId']) and observed['text'] == reply['text'],
            'Observed sender, chat, original message or exact reply text does not match the stored intent.')
    require(reply.get('messageId') is None or reply['messageId'] == observed['messageId'],
            'An edited reply must keep its existing Telegram message ID.')
    for key, item in state['messages'].items():
        if key != review['messageKey'] and item.get('chatId') == message['chatId']:
            other = item.get('reply')
            require(not isinstance(other, dict) or other.get('messageId') != observed['messageId'],
                    'That Telegram reply is already attached to another stored message.')
    return message, reply, observed


def confirm_sent(database, config_path, review_path, snapshot, observed_in_telegram):
    require(observed_in_telegram, 'Actual Telegram observation is required; absence or a timeout is not evidence of success.')
    path = Path(database).absolute()
    backup.private_directory(path.parent)
    config = backup.read_json(config_path)
    review = backup.read_json(review_path)
    # Same kernel lease as production. Never stop a process or remove a lock.
    lease = acquire_lease(path)
    try:
        with backup.database(path) as db:
            state, _ = backup.state_summary(db)
            validate_review(state, config, review)
            before = digest(state)
        del state
        backup.backup(path, snapshot)
        snapshot_manifest = backup.verify(snapshot)
        with backup.database(Path(snapshot) / backup.DATABASE) as saved:
            require(digest(backup.state_summary(saved)[0]) == before,
                    'State changed while creating the snapshot; no reconciliation was applied.')
        with backup.database(path, writable=True) as db, db:
            db.execute('BEGIN IMMEDIATE')
            state, _ = backup.state_summary(db)
            require(digest(state) == before, 'State changed after backup; no reconciliation was applied.')
            message, reply, observed = validate_review(state, config, review)
            # Do not invent sentAt/firstReplyAt: observation time is not delivery time.
            message['reply'] = {**reply, 'status': 'sent', 'messageId': observed['messageId']}
            records = state.setdefault('reconciliations', [])
            require(isinstance(records, list), 'Existing reconciliation history is unsupported; no change was applied.')
            records.append({
                'messageKey': review['messageKey'], 'revision': reply['revision'],
                'previousStatus': reply['status'], 'messageId': observed['messageId'],
                'observedAt': int(time.time() * 1000), 'reviewSha256': digest(review),
                'snapshotSha256': snapshot_manifest['sha256'],
            })
            db.execute('UPDATE state SET value=? WHERE id=1', (json.dumps(state),))
    finally:
        os.close(lease)
    return {'result': 'observed-success-recorded',
            'action': 'No Telegram request was made. Preserve the private review and snapshot. Ordinary installations may restart through the supported launcher; restored candidates still require separate recovery approval. Inspect the reply state afterward.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    preview = sub.add_parser('inspect')
    apply = sub.add_parser('confirm-sent')
    for command in [preview, apply]:
        command.add_argument('--database', required=True)
        command.add_argument('--config', required=True)
    preview.add_argument('--message-key', required=True)
    preview.add_argument('--output', required=True)
    apply.add_argument('--review', required=True)
    apply.add_argument('--backup-destination', required=True)
    apply.add_argument('--observed-in-telegram', action='store_true')
    args = parser.parse_args()
    result = inspect(args.database, args.config, args.message_key, args.output) if args.action == 'inspect' else \
        confirm_sent(args.database, args.config, args.review, args.backup_destination, args.observed_in_telegram)
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (ReconciliationError, backup.BackupError) as error:
        sys.exit(str(error))
    except (OSError, ValueError, KeyError, TypeError, AttributeError, sqlite3.Error):
        sys.exit('Reconciliation could not complete. Check private paths, supported state and exclusive lease. Preserve the database and any snapshot; no raw data was disclosed.')
