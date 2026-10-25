"""Synthetic snapshots, live SQLite writers and offline recovery safety."""
from contextlib import closing
import copy
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import backup
from runtime_lease import acquire_lease


class BackupTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='dotg-backup-test-')
        self.root = Path(self.temporary.name)
        self.source = self.root / 'source.sqlite'
        self.snapshot = self.root / 'snapshot'
        self.restored = self.root / 'restored'
        self.state = {
            'messages': {'telegram_1': {'owner': 'synthetic', 'chatId': '123', 'text': 'PRIVATE CONTENT SENTINEL',
                'reply': {'status': 'sent', 'revision': 1, 'final': True, 'messageId': 22, 'text': 'PRIVATE REPLY'}}},
            'subscriptions': {'sub': {'owner': 'synthetic', 'secret': 'PRIVATE SECRET', 'expiresAt': 9999999999999}},
            'deliveries': {'event': {'done': True, 'event': {'data': {'text': 'PRIVATE CONTENT SENTINEL'}}}},
            'polling': {'synthetic:456': 2},
        }
        with closing(sqlite3.connect(self.source)) as db, db:
            db.execute('CREATE TABLE state (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)')
            db.execute('INSERT INTO state VALUES (1,?)', (json.dumps(self.state),))
        self.source.chmod(0o600)
        self.addCleanup(self.temporary.cleanup)

    def read(self, path):
        with backup.database(path) as db:
            return backup.state_summary(db)[0]

    def write(self, state):
        with closing(sqlite3.connect(self.source)) as db, db:
            db.execute('UPDATE state SET value=? WHERE id=1', (json.dumps(state),))

    def test_snapshot_preserves_private_state_without_mutating_pending_intents(self):
        self.state['messages']['telegram_1']['reply']['status'] = 'pending'
        self.write(self.state)
        report = backup.backup(self.source, self.snapshot)
        self.assertEqual(self.read(self.source), self.state)
        self.assertEqual(self.read(self.snapshot / backup.DATABASE), self.state)
        self.assertEqual(report['summary']['uncertain'], 1)
        self.assertNotIn('PRIVATE', json.dumps(report))
        self.assertEqual(self.snapshot.stat().st_mode & 0o777, 0o700)
        for name in [backup.DATABASE, backup.MANIFEST]:
            self.assertEqual((self.snapshot / name).stat().st_mode & 0o777, 0o600)
        self.assertNotIn('PRIVATE', (self.snapshot / backup.MANIFEST).read_text())
        self.assertEqual(backup.verify(self.snapshot)['summary'], report['summary'])

    def test_online_snapshot_includes_committed_wal_data(self):
        with closing(sqlite3.connect(self.source)) as writer:
            writer.execute('PRAGMA journal_mode=WAL')
            changed = dict(self.state, marker='new committed WAL value')
            writer.execute('UPDATE state SET value=? WHERE id=1', (json.dumps(changed),))
            writer.commit()
            self.assertTrue(Path(str(self.source) + '-wal').exists())
            backup.backup(self.source, self.snapshot)
            self.assertEqual(self.read(self.snapshot / backup.DATABASE), changed)

    def test_concurrent_writer_snapshot_is_internally_consistent(self):
        stop = threading.Event()
        ready = threading.Event()
        failures = []
        def writer():
            try:
                with closing(sqlite3.connect(self.source, timeout=2)) as db:
                    db.execute('PRAGMA journal_mode=WAL')
                    count = 0
                    while not stop.is_set():
                        state = dict(self.state, pair=[count, count])
                        db.execute('UPDATE state SET value=? WHERE id=1', (json.dumps(state),))
                        db.commit()
                        ready.set()
                        count += 1
                        stop.wait(.001)
            except BaseException as error:
                failures.append(type(error).__name__)
                ready.set()
        thread = threading.Thread(target=writer)
        thread.start()
        try:
            self.assertTrue(ready.wait(3))
            backup.backup(self.source, self.snapshot)
        finally:
            stop.set()
            thread.join(3)
        self.assertFalse(thread.is_alive())
        self.assertFalse(failures)
        state = self.read(self.snapshot / backup.DATABASE)
        self.assertEqual(state['pair'][0], state['pair'][1])

    def test_restore_is_a_new_guarded_copy_and_approval_requires_review(self):
        backup.backup(self.source, self.snapshot)
        backup.restore(self.snapshot, self.restored)
        restored = self.read(self.restored / backup.DATABASE)
        self.assertTrue(restored['recovery']['required'])
        self.assertEqual(restored['polling'], self.state['polling'])
        self.assertEqual(restored['messages'], self.state['messages'])
        self.assertEqual(self.read(self.source), self.state)
        with self.assertRaises(backup.BackupError):
            backup.approve_restore(self.restored, False)
        backup.approve_restore(self.restored, True)
        restored = self.read(self.restored / backup.DATABASE)
        self.assertFalse(restored['recovery']['required'])
        self.assertEqual(restored['subscriptions']['sub']['expiresAt'], 0)
        self.assertEqual(restored['subscriptions']['sub']['verifiedAt'], 0)
        self.assertEqual(restored['subscriptions']['sub']['secret'], 'PRIVATE SECRET')
        self.assertTrue(Path(str(self.restored / backup.DATABASE) + '.lease').exists())

    def test_unresolved_replies_and_deliveries_block_restore_approval(self):
        for kind in ['pending', 'uncertain', 'nonfinal', 'callback']:
            with self.subTest(kind=kind):
                state = copy.deepcopy(self.state)
                if kind == 'callback':
                    state['deliveries']['event']['done'] = False
                elif kind == 'nonfinal':
                    state['messages']['telegram_1']['reply']['final'] = False
                else:
                    state['messages']['telegram_1']['reply']['status'] = kind
                self.write(state)
                snapshot, restored = self.root / ('snapshot-' + kind), self.root / ('restored-' + kind)
                backup.backup(self.source, snapshot)
                backup.restore(snapshot, restored)
                with self.assertRaisesRegex(backup.BackupError, 'reconciliation'):
                    backup.approve_restore(restored, True)
                self.assertTrue(self.read(restored / backup.DATABASE)['recovery']['required'])

    def test_approval_cannot_modify_an_in_use_database(self):
        backup.backup(self.source, self.snapshot)
        backup.restore(self.snapshot, self.restored)
        fd = acquire_lease(self.restored / backup.DATABASE)
        try:
            with self.assertRaises(BlockingIOError):
                backup.approve_restore(self.restored, True)
        finally:
            os.close(fd)
        self.assertTrue(self.read(self.restored / backup.DATABASE)['recovery']['required'])

    def test_existing_destinations_are_preserved(self):
        self.snapshot.mkdir(mode=0o700)
        sentinel = self.snapshot / 'sentinel'
        sentinel.write_text('preserve')
        with self.assertRaises(FileExistsError):
            backup.backup(self.source, self.snapshot)
        self.assertEqual(sentinel.read_text(), 'preserve')
        self.assertEqual(self.read(self.source), self.state)

    def test_corruption_and_incomplete_snapshots_fail_closed(self):
        backup.backup(self.source, self.snapshot)
        database = self.snapshot / backup.DATABASE
        with database.open('ab') as target:
            target.write(b'changed')
        with self.assertRaisesRegex(backup.BackupError, 'checksum'):
            backup.restore(self.snapshot, self.restored)
        self.assertFalse(self.restored.exists())
        (self.snapshot / backup.MANIFEST).unlink()
        with self.assertRaises(FileNotFoundError):
            backup.verify(self.snapshot)

    def test_copy_failure_never_publishes_a_restored_database(self):
        backup.backup(self.source, self.snapshot)
        with patch.object(backup, 'copy_database', side_effect=backup.BackupError('Synthetic interruption')):
            with self.assertRaises(backup.BackupError):
                backup.restore(self.snapshot, self.restored)
        self.assertFalse((self.restored / backup.DATABASE).exists())
        self.assertEqual(self.read(self.source), self.state)

    def test_copy_deadline_is_bounded(self):
        with self.assertRaisesRegex(backup.BackupError, 'timed out'):
            backup.copy_database(self.source, self.root / 'partial.sqlite', seconds=0)

    def test_unsafe_sources_are_rejected_without_following_links_or_fifo(self):
        link = self.root / 'link.sqlite'
        link.symlink_to(self.source)
        with self.assertRaises(OSError):
            backup.backup(link, self.snapshot)
        hard = self.root / 'hard.sqlite'
        os.link(self.source, hard)
        with self.assertRaises(backup.BackupError):
            backup.backup(hard, self.snapshot)
        hard.unlink()
        fifo = self.root / 'fifo'
        os.mkfifo(fifo, 0o600)
        with self.assertRaises(backup.BackupError):
            backup.backup(fifo, self.snapshot)
        self.source.chmod(0o644)
        with self.assertRaises(backup.BackupError):
            backup.backup(self.source, self.snapshot)

    def test_cli_reports_fixed_errors_without_private_data(self):
        self.source.write_bytes(b'PRIVATE SQLITE ERROR SENTINEL')
        result = subprocess.run([sys.executable, str(ROOT / 'scripts/backup.py'), 'create', '--database', str(self.source),
                                 '--destination', str(self.snapshot)], capture_output=True, text=True, timeout=5)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('PRIVATE', result.stdout + result.stderr)
        self.assertNotIn(str(self.source), result.stdout + result.stderr)
        self.assertFalse(self.snapshot.exists())

    def test_logical_size_limit_covers_committed_wal_pages(self):
        with closing(sqlite3.connect(self.source)) as writer:
            writer.execute('PRAGMA journal_mode=WAL')
            changed = dict(self.state, large='x' * 40000)
            writer.execute('UPDATE state SET value=? WHERE id=1', (json.dumps(changed),))
            writer.commit()
            self.assertLess(self.source.stat().st_size, 16384)
            with patch.object(backup, 'MAX_DATABASE_BYTES', 16384):
                with self.assertRaisesRegex(backup.BackupError, 'WAL'):
                    backup.backup(self.source, self.snapshot)
            self.assertFalse(self.snapshot.exists())

    def test_success_syncs_output_and_its_parent_directory(self):
        with patch.object(backup, 'sync_directory') as sync:
            backup.backup(self.source, self.snapshot)
            self.assertEqual([call.args[0] for call in sync.call_args_list], [self.snapshot, self.root])
        with patch.object(backup, 'sync_directory') as sync:
            backup.restore(self.snapshot, self.restored)
            self.assertEqual([call.args[0] for call in sync.call_args_list], [self.restored, self.root])


if __name__ == '__main__':
    unittest.main()
