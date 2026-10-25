"""Real process/OS-lock tests with isolated state and no external transports."""
import fcntl
from contextlib import closing
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which('node')
sys.path.insert(0, str(ROOT / 'scripts'))
import backup


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


class RuntimeTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='dotg-runtime-test-')
        self.root = Path(self.directory.name)
        self.database = self.root / 'dotg.sqlite'
        self.config = self.root / 'config.json'
        self.config.write_text(json.dumps({
            'ownerId': 'synthetic-owner', 'allowedChatIds': ['123'],
            'telegramMode': 'polling', 'expectedBotId': '456',
            'expectedBotUsername': 'synthetic_bot',
            'mcpBearerToken': 'synthetic-bearer-' * 3,
            'telegramBotToken': 'synthetic-never-used',
        }))
        self.config.chmod(0o600)
        self.port = free_port()
        self.children = []

    def tearDown(self):
        for child in self.children:
            if child.poll() is None:
                child.kill()
            child.communicate(timeout=5)
        self.directory.cleanup()

    def env(self, **extra):
        return dict(os.environ, DOTG_DATABASE=str(self.database), DOTG_CONFIG=str(self.config),
                    DOTG_ENABLE_POLLING='0', DOTG_PORT=str(self.port), DOTG_CALLBACK_DNS_SERVERS='', **extra)

    def start(self, env=None, direct=False):
        command = [NODE, str(ROOT / 'src/server.mjs')] if direct else [sys.executable, str(ROOT / 'scripts/run-backend.py'), '--node', NODE]
        child = subprocess.Popen(command, env=env or self.env(), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.children.append(child)
        return child

    def wait_ready(self, child):
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            if child.poll() is not None:
                self.fail('Isolated backend exited before becoming ready: ' + str(child.communicate()))
            request = urllib.request.Request(f'http://127.0.0.1:{self.port}/mcp', data=b'{}')
            try:
                urllib.request.urlopen(request, timeout=.2).close()
            except urllib.error.HTTPError as error:
                error.close()
                if error.code == 401:
                    return
            except OSError:
                pass
            time.sleep(.03)
        self.fail('Isolated backend did not become ready')

    def lease_is_held(self):
        with open(str(self.database) + '.lease', 'r+b') as lease:
            with self.assertRaises(BlockingIOError):
                fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)

    def test_exclusive_lease_survives_exec_and_releases_after_graceful_stop(self):
        first = self.start()
        self.wait_ready(first)
        self.lease_is_held()
        env = self.env()
        env['DOTG_PORT'] = str(free_port())
        second = self.start(env)
        _, error = second.communicate(timeout=5)
        self.assertEqual(second.returncode, 1)
        self.assertIn('already using this database', error)
        self.lease_is_held()
        first.terminate()
        first.communicate(timeout=8)
        self.assertEqual(first.returncode, 0)
        self.assertTrue(Path(str(self.database) + '.lease').is_file())
        replacement = self.start()
        self.wait_ready(replacement)
        replacement.terminate()
        replacement.communicate(timeout=8)
        self.assertEqual(replacement.returncode, 0)

    def test_crash_restart_needs_no_lock_deletion_and_recovers_uncertain_intent(self):
        first = self.start()
        self.wait_ready(first)
        first.terminate()
        first.communicate(timeout=8)
        # Synthetic offline pending intent represents the external write crash gap.
        with closing(sqlite3.connect(self.database)) as db, db:
            state = json.loads(db.execute('SELECT value FROM state WHERE id=1').fetchone()[0])
            state['messages']['synthetic'] = {'owner': 'synthetic-owner', 'chatId': '123', 'reply': {'status': 'pending'}}
            db.execute('UPDATE state SET value=? WHERE id=1', (json.dumps(state),))
        second = self.start()
        self.wait_ready(second)
        os.kill(second.pid, signal.SIGKILL)
        second.communicate(timeout=5)
        third = self.start()
        self.wait_ready(third)
        with closing(sqlite3.connect(f'file:{self.database}?mode=ro', uri=True)) as db:
            state = json.loads(db.execute('SELECT value FROM state WHERE id=1').fetchone()[0])
            self.assertEqual(state['messages']['synthetic']['reply']['status'], 'uncertain')
        self.lease_is_held()

    def test_legacy_lock_is_never_deleted_or_adopted(self):
        legacy = Path(str(self.database) + '.lock')
        legacy.write_text('')
        child = self.start()
        child.communicate(timeout=5)
        self.assertEqual(child.returncode, 1)
        self.assertTrue(legacy.exists())
        self.assertFalse(self.database.exists())

    def test_direct_entry_and_invalid_config_fail_without_a_stale_lock(self):
        child = self.start(direct=True)
        child.communicate(timeout=5)
        self.assertEqual(child.returncode, 1)
        self.assertFalse(self.database.exists())
        good = self.config.read_text()
        self.config.write_text('not json; PRIVATE SENTINEL')
        child = self.start()
        out, error = child.communicate(timeout=5)
        self.assertEqual(child.returncode, 1)
        self.assertNotIn('PRIVATE SENTINEL', out + error)
        self.assertFalse(self.database.exists())
        self.config.write_text(good)
        self.wait_ready(self.start())

    def test_port_collision_exits_cleanly_and_allows_a_later_start(self):
        with socket.socket() as occupied:
            occupied.bind(('127.0.0.1', self.port))
            occupied.listen()
            child = self.start()
            child.communicate(timeout=5)
            self.assertEqual(child.returncode, 1)
        self.wait_ready(self.start())

    def test_lease_symlink_is_rejected_without_modifying_target(self):
        target = self.root / 'untouched'
        target.write_text('preserve')
        Path(str(self.database) + '.lease').symlink_to(target)
        child = self.start()
        child.communicate(timeout=5)
        self.assertEqual(child.returncode, 1)
        self.assertEqual(target.read_text(), 'preserve')
        self.assertFalse(self.database.exists())

    def test_restored_state_requires_review_then_fresh_subscription_before_polling(self):
        first = self.start()
        self.wait_ready(first)
        first.terminate()
        first.communicate(timeout=8)
        snapshot, restored = self.root / 'snapshot', self.root / 'restored'
        backup.backup(self.database, snapshot)
        backup.restore(snapshot, restored)
        env = self.env()
        env['DOTG_DATABASE'] = str(restored / backup.DATABASE)
        blocked = self.start(env)
        blocked.communicate(timeout=5)
        self.assertEqual(blocked.returncode, 1)
        backup.approve_restore(restored, True)
        env['DOTG_ENABLE_POLLING'] = '1'
        no_subscription = self.start(env)
        no_subscription.communicate(timeout=5)
        self.assertEqual(no_subscription.returncode, 1)
        # No Telegram transport is reached by either refusal. MCP setup can now
        # run with intake off, without reusing copied callback credentials.
        env['DOTG_ENABLE_POLLING'] = '0'
        self.wait_ready(self.start(env))


if __name__ == '__main__':
    unittest.main()
