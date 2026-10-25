"""Private SQLite snapshots and staged, fail-closed recovery. No network access."""
import argparse
from contextlib import closing, contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import stat
import sys
import time

from runtime_lease import acquire_lease

FORMAT = 1
DATABASE = 'state.sqlite'
MANIFEST = 'snapshot.json'
MAX_DATABASE_BYTES = 256 * 1024 * 1024


class BackupError(Exception):
    """Fixed operator guidance, never a raw path, message body or SQLite error."""


def private_directory(path):
    path = Path(path).absolute()
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o077:
        raise BackupError('Use an existing private directory owned by this user (mode 0700, no symlink).')
    return path


@contextmanager
def private_file(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o600 or info.st_nlink != 1:
            raise BackupError('Use a private regular file owned by this user (mode 0600, no symlink or hard link).')
        yield fd, info
    finally:
        os.close(fd)


def read_json(path):
    with private_file(path) as (fd, info):
        if info.st_size > 65536:
            raise BackupError('Snapshot metadata exceeds its size limit.')
        with os.fdopen(fd, 'r', closefd=False) as source:
            return json.load(source)


def write_json(path, value):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as target:
        json.dump(value, target, indent=2)
        target.flush()
        os.fsync(target.fileno())


def fingerprint(path):
    digest = hashlib.sha256()
    with private_file(path) as (fd, info):
        if info.st_size > MAX_DATABASE_BYTES:
            raise BackupError('Database exceeds the supported snapshot size; use a reviewed SQLite backup procedure.')
        with os.fdopen(fd, 'rb', closefd=False) as source:
            for block in iter(lambda: source.read(1024 * 1024), b''):
                digest.update(block)
        return {'sha256': digest.hexdigest(), 'bytes': info.st_size}


@contextmanager
def database(path, writable=False, seconds=30):
    path = Path(path).absolute()
    # Keep the inspected inode open and check the path again after SQLite opens.
    with private_file(path) as (_, info):
        if info.st_size > MAX_DATABASE_BYTES:
            raise BackupError('Database exceeds the supported snapshot size.')
        uri = path.as_uri() + ('?mode=rw' if writable else '?mode=ro')
        with closing(sqlite3.connect(uri, uri=True, timeout=1)) as db:
            current = path.lstat()
            if (current.st_dev, current.st_ino) != (info.st_dev, info.st_ino):
                raise BackupError('Database path changed during inspection; nothing was approved.')
            deadline = time.monotonic() + seconds
            db.set_progress_handler(lambda: int(time.monotonic() >= deadline), 1000)
            db.setlimit(sqlite3.SQLITE_LIMIT_LENGTH, MAX_DATABASE_BYTES)
            db.execute('PRAGMA trusted_schema=OFF')
            if not writable:
                db.execute('PRAGMA query_only=ON')
            check_size(db)
            yield db


def check_size(db):
    pages = db.execute('PRAGMA page_count').fetchone()[0]
    size = db.execute('PRAGMA page_size').fetchone()[0]
    if pages * size > MAX_DATABASE_BYTES:
        raise BackupError('Logical database including committed WAL data exceeds the supported snapshot size.')
    return size


def state_summary(db):
    check_size(db)
    if db.execute('PRAGMA quick_check').fetchall() != [('ok',)]:
        raise BackupError('SQLite integrity check failed; preserve the files for diagnosis.')
    columns = db.execute('PRAGMA table_info(state)').fetchall()
    if [item[1] for item in columns] != ['id', 'value']:
        raise BackupError('Snapshot does not contain the supported dotg state table.')
    rows = db.execute('SELECT id, value FROM state LIMIT 2').fetchall()
    if len(rows) != 1 or rows[0][0] != 1 or not isinstance(rows[0][1], str):
        raise BackupError('Snapshot does not contain one valid state record.')
    state = json.loads(rows[0][1])
    if not isinstance(state, dict) or not all(isinstance(state.get(key), dict) for key in ['messages', 'subscriptions', 'deliveries']):
        raise BackupError('Snapshot state shape is unsupported.')
    if not all(isinstance(value, dict) for key in ['messages', 'subscriptions', 'deliveries'] for value in state[key].values()):
        raise BackupError('Snapshot contains an unsupported state entry.')
    replies = [message.get('reply') for message in state['messages'].values()]
    if not all(reply is None or isinstance(reply, dict) for reply in replies):
        raise BackupError('Snapshot reply state is unsupported.')
    completed = sum(bool(reply and reply.get('status') == 'sent' and reply.get('final') is True) for reply in replies)
    summary = {'messages': len(replies), 'completed': completed, 'unresolved': len(replies) - completed,
               'uncertain': sum(bool(reply and reply.get('status') in ['pending', 'uncertain']) for reply in replies),
               'subscriptions': len(state['subscriptions']), 'deliveries': len(state['deliveries']),
               'unfinishedDeliveries': sum(item.get('done') is not True for item in state['deliveries'].values())}
    return state, summary


def new_directory(path):
    path = Path(path).absolute()
    private_directory(path.parent)
    path.mkdir(mode=0o700)  # Never merge into an existing destination, even if empty.
    return path


def copy_database(source, target, seconds=30):
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    os.close(fd)
    deadline = time.monotonic() + seconds

    with database(source, seconds=seconds) as original, database(target, writable=True, seconds=seconds) as destination:
        page_size = check_size(original)
        def progress(status, remaining, total):
            if total * page_size > MAX_DATABASE_BYTES:
                raise BackupError('Database grew beyond the snapshot size limit; incomplete output is not valid.')
            if time.monotonic() >= deadline:
                raise BackupError('Snapshot copy timed out; source was preserved and incomplete output is not valid.')
        original.backup(destination, pages=128, progress=progress, sleep=.05)
        _, summary = state_summary(destination)
    with private_file(target) as (fd, _):
        os.fsync(fd)
    return summary


def backup(source, destination):
    # Validate before creating output. Online backup itself takes a consistent
    # SQLite snapshot; no application Store is opened or process lease acquired.
    with database(source) as db:
        state_summary(db)
    directory = new_directory(destination)
    summary = copy_database(source, directory / DATABASE)
    manifest = {'format': FORMAT, 'kind': 'dotg-snapshot',
                'createdAt': datetime.now(timezone.utc).isoformat(), **fingerprint(directory / DATABASE), 'summary': summary}
    write_json(directory / MANIFEST, manifest)  # Written last: missing metadata means incomplete.
    sync_directory(directory)
    sync_directory(directory.parent)
    return {'result': 'snapshot-created', 'summary': summary, 'scope': 'Private database only; configuration and Keychain are not included.'}


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def verify(directory):
    directory = private_directory(directory)
    manifest = read_json(directory / MANIFEST)
    if not isinstance(manifest, dict) or type(manifest.get('format')) is not int or manifest['format'] != FORMAT or manifest.get('kind') != 'dotg-snapshot':
        raise BackupError('Unknown or incomplete snapshot format.')
    actual = fingerprint(directory / DATABASE)
    if any(manifest.get(key) != actual[key] for key in ['sha256', 'bytes']):
        raise BackupError('Snapshot checksum mismatch; source files were preserved.')
    with database(directory / DATABASE) as db:
        _, summary = state_summary(db)
    if summary != manifest.get('summary'):
        raise BackupError('Snapshot metadata does not match the database.')
    return manifest


def restore(snapshot, destination):
    manifest = verify(snapshot)
    directory = new_directory(destination)
    path = directory / '.partial.sqlite'
    copy_database(Path(snapshot) / DATABASE, path)
    if fingerprint(path) != {'sha256': manifest['sha256'], 'bytes': manifest['bytes']}:
        raise BackupError('Snapshot changed during restoration; incomplete output must not be started.')
    with database(path, writable=True) as db, db:
        state, summary = state_summary(db)
        state['recovery'] = {'required': True, 'restoredAt': int(time.time() * 1000), 'snapshotSha256': manifest['sha256']}
        db.execute('UPDATE state SET value=? WHERE id=1', (json.dumps(state),))
    with private_file(path) as (fd, _):
        os.fsync(fd)
    # Publish only after the startup guard is durable. Link is exclusive: never
    # overwrite a file another process might have created during restoration.
    os.link(path, directory / DATABASE, follow_symlinks=False)
    path.unlink()
    sync_directory(directory)
    sync_directory(directory.parent)
    return {'result': 'restored-to-new-directory-startup-blocked', 'summary': summary,
            'action': 'Compare external Telegram outcomes and any newer database before approve-restore. No process was started or live data replaced.'}


def approve_restore(directory, reviewed):
    if not reviewed:
        raise BackupError('External-state review is required. This command cannot establish whether Telegram sent a reply after the snapshot.')
    path = private_directory(directory) / DATABASE
    # Same lease as the backend, never an existence check or lock-file deletion.
    fd = acquire_lease(path)
    try:
        with database(path, writable=True) as db, db:
            state, summary = state_summary(db)
            recovery = state.get('recovery')
            if not isinstance(recovery, dict) or recovery.get('required') is not True:
                raise BackupError('This is not a staged restoration awaiting approval.')
            if summary['unresolved'] or summary['unfinishedDeliveries']:
                raise BackupError('Unresolved replies or callback deliveries require explicit reconciliation; restoration remains blocked.')
            # Keep old subscription evidence but force a fresh signed host
            # handshake before any restored installation can resume polling.
            for subscription in state['subscriptions'].values():
                subscription['expiresAt'] = 0
                subscription['verifiedAt'] = 0
            recovery.update(required=False, approvedAt=int(time.time() * 1000))
            db.execute('UPDATE state SET value=? WHERE id=1', (json.dumps(state),))
    finally:
        os.close(fd)
    return {'result': 'offline-review-recorded-polling-still-gated',
            'action': 'Start this candidate with polling disabled, verify fresh host tools/subscriptions, then perform the sole-consumer handover.'}


def main():
    parser = argparse.ArgumentParser(description='Create verified private SQLite snapshots; stage recovery without replacing live data.')
    sub = parser.add_subparsers(dest='action', required=True)
    create = sub.add_parser('create')
    create.add_argument('--database', required=True)
    create.add_argument('--destination', required=True)
    check = sub.add_parser('verify')
    check.add_argument('--snapshot', required=True)
    recover = sub.add_parser('restore')
    recover.add_argument('--snapshot', required=True)
    recover.add_argument('--destination', required=True)
    approve = sub.add_parser('approve-restore')
    approve.add_argument('--directory', required=True)
    approve.add_argument('--reviewed-external-state', action='store_true')
    args = parser.parse_args()
    if args.action == 'create':
        result = backup(args.database, args.destination)
    elif args.action == 'verify':
        result = {'result': 'snapshot-verified', 'summary': verify(args.snapshot)['summary']}
    elif args.action == 'restore':
        result = restore(args.snapshot, args.destination)
    else:
        result = approve_restore(args.directory, args.reviewed_external_state)
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    try:
        main()
    except BackupError as error:
        sys.exit(str(error))
    except (OSError, ValueError, KeyError, TypeError, sqlite3.Error):
        sys.exit('Backup/recovery could not complete. Check private paths, format, lease ownership and available storage. Source data was not replaced; preserve incomplete output for inspection. No raw data was disclosed.')
