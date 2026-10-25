"""Offline reconciliation with synthetic state, leases and real bridge retry behavior."""
from contextlib import closing
import copy
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import backup
import reconcile
from runtime_lease import acquire_lease


class ReconcileTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='dotg-reconcile-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.db = self.root / 'state.sqlite'
        self.config = self.root / 'config.json'
        self.review = self.root / 'review.json'
        self.snapshot = self.root / 'snapshot'
        self.settings = {'ownerId': 'synthetic', 'telegramMode': 'polling', 'expectedBotId': '456',
                         'allowedChatIds': ['123'], 'telegramBotToken': 'PRIVATE TOKEN'}
        backup.write_json(self.config, self.settings)
        self.state = {'messages': {'telegram_1': {'owner': 'synthetic', 'messageKey': 'telegram_1',
                      'chatId': '123', 'messageId': 1, 'text': 'PRIVATE QUESTION', 'receivedAt': 1000,
                      'reply': {'status': 'uncertain', 'revision': 1, 'final': True, 'text': 'PRIVATE ANSWER'}}},
                      'subscriptions': {}, 'deliveries': {}, 'polling': {'synthetic:456': 2}}
        with closing(sqlite3.connect(self.db)) as db, db:
            db.execute('CREATE TABLE state (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)')
            db.execute('INSERT INTO state VALUES (1,?)', (json.dumps(self.state),))
        self.db.chmod(0o600)

    def read(self, path=None):
        with backup.database(path or self.db) as db:
            return backup.state_summary(db)[0]

    def write_state(self, state):
        with closing(sqlite3.connect(self.db)) as db, db:
            db.execute('UPDATE state SET value=? WHERE id=1', (json.dumps(state),))

    def prepare(self):
        result = reconcile.inspect(self.db, self.config, 'telegram_1', self.review)
        self.assertNotIn('PRIVATE', json.dumps(result))
        review = json.loads(self.review.read_text())
        reply = self.read()['messages']['telegram_1']['reply']
        review['observed'] = {'botId': '456', 'chatId': '123', 'replyToMessageId': 1,
                              'messageId': reply.get('messageId', 22), 'text': reply['text']}
        self.write_review(review)
        return review

    def write_review(self, value):
        self.review.write_text(json.dumps(value))

    def apply(self, confirmed=True):
        return reconcile.confirm_sent(self.db, self.config, self.review, self.snapshot, confirmed)

    def test_inspection_is_private_exclusive_and_does_not_recover_pending_state(self):
        self.state['messages']['telegram_1']['reply']['status'] = 'pending'
        self.write_state(self.state)
        reconcile.inspect(self.db, self.config, 'telegram_1', self.review)
        self.assertIsNone(json.loads(self.review.read_text())['observed'])
        self.assertEqual(self.review.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.read(), self.state)
        with self.assertRaises(FileExistsError):
            reconcile.inspect(self.db, self.config, 'telegram_1', self.review)

    def test_confirmed_send_preserves_snapshot_other_state_and_real_retry_deduplication(self):
        self.prepare()
        result = self.apply()
        self.assertNotIn('PRIVATE', json.dumps(result))
        self.assertEqual(self.read(self.snapshot / backup.DATABASE), self.state)
        current = self.read()
        self.assertEqual(current['polling'], self.state['polling'])
        reply = current['messages']['telegram_1']['reply']
        self.assertEqual((reply['status'], reply['messageId']), ('sent', 22))
        self.assertNotIn('sentAt', reply)
        self.assertNotIn('firstReplyAt', current['messages']['telegram_1'])
        self.assertEqual(len(current['reconciliations']), 1)
        script = '''
import assert from 'node:assert/strict';
import { Store } from './src/store.mjs';
import { Bridge } from './src/bridge.mjs';
const store = new Store(process.argv[1]);
let writes = 0;
const bridge = new Bridge({ store, config: { ownerId: 'synthetic', allowedChatIds: ['123'] },
  telegram: async () => { writes++; throw new Error('Unexpected external write'); } });
const result = await bridge.callTool('reply_telegram_message', {
  message_key: 'telegram_1', revision: 1, final: true, text: 'PRIVATE ANSWER' });
assert.equal(result.message_id, 22);
assert.equal(writes, 0);
store.close();
'''
        subprocess.run(['node', '--input-type=module', '-e', script, str(self.db)],
                       cwd=ROOT, check=True, capture_output=True, timeout=15)
        with self.assertRaises(reconcile.ReconciliationError):
            self.apply()

    def test_confirmed_edit_retains_id_and_allows_next_cumulative_revision(self):
        self.state['messages']['telegram_1']['reply'].update(revision=2, final=False, messageId=22)
        self.write_state(self.state)
        review = self.prepare()
        review['observed']['messageId'] = 23
        self.write_review(review)
        with self.assertRaises(reconcile.ReconciliationError):
            self.apply()
        review['observed']['messageId'] = 22
        self.write_review(review)
        self.apply()
        script = '''
import assert from 'node:assert/strict';
import { Store } from './src/store.mjs';
import { Bridge } from './src/bridge.mjs';
const store = new Store(process.argv[1]);
const calls = [];
const bridge = new Bridge({ store, config: { ownerId: 'synthetic', allowedChatIds: ['123'] },
  telegram: async (method, params) => { calls.push({ method, params }); return { message_id: 22 }; } });
const result = await bridge.callTool('update_telegram_message', {
  message_key: 'telegram_1', revision: 3, final: true, text: 'PRIVATE ANSWER completed' });
assert.equal(result.message_id, 22);
assert.equal(calls.length, 1);
assert.equal(calls[0].method, 'editMessageText');
assert.equal(calls[0].params.message_id, 22);
store.close();
'''
        subprocess.run(['node', '--input-type=module', '-e', script, str(self.db)],
                       cwd=ROOT, check=True, capture_output=True, timeout=15)

    def test_missing_observation_mismatches_and_boolean_ids_cannot_change_state(self):
        review = self.prepare()
        with self.assertRaises(reconcile.ReconciliationError):
            self.apply(False)
        for field, value in [('botId', '999'), ('chatId', '999'), ('replyToMessageId', 2),
                             ('replyToMessageId', True), ('messageId', True), ('messageId', -1),
                             ('text', 'different'), ('text', 'PRIVATE ANSWER ')]:
            with self.subTest(field=field, value=value):
                changed = copy.deepcopy(review)
                changed['observed'][field] = value
                self.write_review(changed)
                with self.assertRaises(reconcile.ReconciliationError):
                    self.apply()
                self.assertEqual(self.read(), self.state)
                self.assertFalse(self.snapshot.exists())
        review['observed'] = None
        self.write_review(review)
        with self.assertRaises(reconcile.ReconciliationError):
            self.apply()

    def test_stale_review_duplicate_message_and_wrong_owner_fail_closed(self):
        review = self.prepare()
        changed = copy.deepcopy(self.state)
        changed['messages']['telegram_1']['readAt'] = 2000
        self.write_state(changed)
        with self.assertRaises(reconcile.ReconciliationError):
            self.apply()
        self.write_state(self.state)
        changed = copy.deepcopy(self.state)
        changed['messages']['telegram_2'] = {'chatId': '123', 'reply': {'messageId': 22}}
        self.write_state(changed)
        with self.assertRaises(reconcile.ReconciliationError):
            self.apply()
        self.write_state(self.state)
        self.settings['ownerId'] = 'other-owner'
        self.config.write_text(json.dumps(self.settings))
        with self.assertRaises(reconcile.ReconciliationError):
            self.apply()
        self.assertFalse(self.snapshot.exists())

    def test_live_lease_backup_failure_and_concurrent_change_preserve_state(self):
        self.prepare()
        lease = acquire_lease(self.db)
        try:
            with self.assertRaises(BlockingIOError):
                self.apply()
        finally:
            os.close(lease)
        self.assertFalse(self.snapshot.exists())
        with patch.object(backup, 'backup', side_effect=backup.BackupError('synthetic failure')):
            with self.assertRaises(backup.BackupError):
                self.apply()
        self.assertEqual(self.read(), self.state)
        original_verify = backup.verify
        changed = copy.deepcopy(self.state)
        changed['polling']['synthetic:456'] = 3
        def racing_verify(path):
            manifest = original_verify(path)
            self.write_state(changed)
            return manifest
        with patch.object(backup, 'verify', side_effect=racing_verify):
            with self.assertRaises(reconcile.ReconciliationError):
                self.apply()
        self.assertEqual(self.read(), changed)
        self.assertEqual(self.read(self.snapshot / backup.DATABASE), self.state)

    def test_cli_failure_never_discloses_raw_input(self):
        self.config.write_text('PRIVATE TOKEN AND MALFORMED JSON')
        result = subprocess.run([sys.executable, str(ROOT / 'scripts/reconcile.py'), 'inspect',
                                 '--database', str(self.db), '--config', str(self.config),
                                 '--message-key', 'telegram_1', '--output', str(self.review)],
                                capture_output=True, text=True, timeout=15)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('PRIVATE', result.stdout + result.stderr)
        self.assertEqual(self.read(), self.state)

    def test_reconciliation_does_not_approve_a_restored_candidate(self):
        self.state['recovery'] = {'required': True, 'snapshotSha256': 'synthetic'}
        self.write_state(self.state)
        self.prepare()
        self.apply()
        self.assertEqual(self.read()['recovery'], self.state['recovery'])
        self.assertEqual(self.read(self.snapshot / backup.DATABASE), self.state)


if __name__ == '__main__':
    unittest.main()
