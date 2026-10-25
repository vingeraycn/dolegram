"""Configuration helper tests never read credentials or contact a service."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('configure', Path(__file__).resolve().parents[1] / 'scripts/configure.py')
configure = importlib.util.module_from_spec(spec)
spec.loader.exec_module(configure)


class ConfigureTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.previous = os.getcwd()
        os.chdir(self.directory.name)

    def tearDown(self):
        os.chdir(self.previous)
        self.directory.cleanup()

    def run_helper(self, bearer=''):
        output = io.StringIO()
        with patch.object(configure.sys.stdin, 'isatty', return_value=True), \
                patch('builtins.input', side_effect=['polling', '456', 'synthetic_bot', 'owner', '123']), \
                patch.object(configure.getpass, 'getpass', side_effect=[bearer, 'synthetic-bot-token']), \
                contextlib.redirect_stdout(output):
            configure.main()
        return output.getvalue()

    def test_generates_private_independent_bearer_without_printing(self):
        output = self.run_helper()
        path = Path('config.local.json')
        value = json.loads(path.read_text())
        self.assertGreaterEqual(len(value['mcpBearerToken']), 32)
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertNotIn(value['mcpBearerToken'], output)
        self.assertNotIn(value['telegramBotToken'], output)

    def test_preserves_existing_configuration(self):
        Path('config.local.json').write_text('original')
        with self.assertRaises(FileExistsError):
            self.run_helper()
        self.assertEqual(Path('config.local.json').read_text(), 'original')

    def test_rejects_header_injection_and_noninteractive_input(self):
        with self.assertRaises(ValueError):
            self.run_helper('x' * 32 + '\r\n')
        self.assertFalse(Path('config.local.json').exists())
        with patch.object(configure.sys.stdin, 'isatty', return_value=False), self.assertRaises(ValueError):
            configure.main()
