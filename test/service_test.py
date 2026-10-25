"""Service policy tests: synthetic files and mocked launchctl; no real jobs or keys."""
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('dotg_service', Path(__file__).resolve().parents[1] / 'scripts/service.py')
service = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(service)


def result(code=0, output=''):
    return subprocess.CompletedProcess([], code, output, 'PRIVATE DIAGNOSTIC SENTINEL')


class ServiceTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='dotg-service-test-')
        self.root = Path(self.directory.name)
        self.record = {
            'version': 1, 'checkout': '/synthetic/checkout', 'nodeExecutable': '/synthetic/node',
            'pythonExecutable': '/synthetic/python', 'configPath': '/synthetic/config.json',
            'databasePath': '/synthetic/runtime/db.sqlite', 'runtimeDirectory': '/synthetic/runtime',
            'pollingEnabled': False, 'tunnelLauncher': '/synthetic/launcher',
            'tunnelSettingsPath': '/synthetic/launcher.local.json',
        }
        self.record_path = self.root / 'installation.local.json'
        self.write_record()
        self.path_patch = patch.object(service, 'plist_path', side_effect=lambda component: self.root / (component + '.plist'))
        self.path_patch.start()
        self.addCleanup(self.path_patch.stop)
        self.addCleanup(self.directory.cleanup)

    def write_record(self):
        self.record_path.write_text(json.dumps(self.record))
        self.record_path.chmod(0o600)

    def installed(self, component='backend'):
        path = service.plist_path(component)
        path.write_bytes(plistlib.dumps(service.job(self.record, component)))
        path.chmod(0o600)
        return path

    def test_record_is_private_versioned_strict_and_has_no_secret_fields(self):
        self.assertEqual(service.settings(self.record_path), self.record)
        for field, value in [('telegramBotToken', 'PRIVATE'), ('version', True), ('pollingEnabled', 'yes')]:
            changed = dict(self.record, **{field: value})
            self.record_path.write_text(json.dumps(changed))
            with self.assertRaises(service.ServiceError):
                service.settings(self.record_path)
        self.write_record()
        self.record_path.chmod(0o644)
        with self.assertRaises(service.ServiceError):
            service.settings(self.record_path)
        self.record_path.unlink()
        self.record_path.symlink_to(self.root / 'missing')
        with self.assertRaises(OSError):
            service.settings(self.record_path)

    def test_tunnel_requires_background_settings_and_job_never_allows_prompt(self):
        tunnel = service.job(self.record, 'tunnel')
        self.assertEqual(tunnel['ProgramArguments'][1], '--run-background')
        self.assertEqual(tunnel['KeepAlive'], {'SuccessfulExit': False})
        self.assertGreaterEqual(tunnel['ThrottleInterval'], 60)
        self.assertEqual(tunnel['StandardErrorPath'], '/dev/null')
        self.assertNotIn('CONTROL_PLANE_API_KEY', tunnel['EnvironmentVariables'])
        del self.record['tunnelSettingsPath']
        self.write_record()
        with self.assertRaises(service.ServiceError):
            service.settings(self.record_path)

    def test_backend_preserves_explicit_polling_and_paths(self):
        backend = service.job(self.record, 'backend')
        self.assertEqual(backend['EnvironmentVariables']['DOTG_ENABLE_POLLING'], '0')
        self.assertEqual(backend['ProgramArguments'][1], '/synthetic/checkout/scripts/run-backend.py')
        self.record['pollingEnabled'] = True
        self.record['callbackDnsServers'] = '1.1.1.1'
        backend = service.job(self.record, 'backend')
        self.assertEqual(backend['EnvironmentVariables']['DOTG_ENABLE_POLLING'], '1')
        self.assertEqual(backend['EnvironmentVariables']['DOTG_CALLBACK_DNS_SERVERS'], '1.1.1.1')

    @patch.object(service, 'status', return_value={'loaded': False})
    @patch.object(service, 'verify_files')
    def test_install_is_idempotent_and_preserves_different_job(self, verify, status):
        self.assertEqual(service.install(self.record, 'backend'), 'installed-not-started')
        path = service.plist_path('backend')
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(service.install(self.record, 'backend'), 'already-installed')
        foreign = plistlib.dumps({'Label': 'preserve-foreign-job'})
        path.write_bytes(foreign)
        with self.assertRaises(service.ServiceError):
            service.install(self.record, 'backend')
        self.assertEqual(path.read_bytes(), foreign)

    @patch.object(service, 'launchctl')
    def test_status_distinguishes_missing_service_from_unavailable_domain(self, launchctl):
        launchctl.side_effect = [result(113), result(0)]
        self.assertEqual(service.status('backend')['state'], 'not-loaded')
        launchctl.side_effect = [result(113), result(113)]
        with self.assertRaises(service.ServiceError):
            service.status('backend')
        launchctl.side_effect = [result(1)]
        with self.assertRaises(service.ServiceError):
            service.status('backend')

    @patch.object(service, 'launchctl')
    def test_status_returns_only_top_level_allowlisted_fields(self, launchctl):
        launchctl.return_value = result(output='job = {\n\tstate = waiting\n\tlast exit code = 78\n\t\tpid = 123\n\tsecret = PRIVATE\n}')
        report = service.status('tunnel')
        self.assertNotIn('PRIVATE', json.dumps(report))
        self.assertNotIn('pid', report)
        self.assertIn('Keychain', report['action'])

    @patch.object(service, 'status', return_value={'loaded': True})
    @patch.object(service, 'launchctl')
    def test_start_does_not_spawn_another_loaded_job(self, launchctl, status):
        self.installed()
        self.assertIn('already-loaded', service.start(self.record, 'backend'))
        launchctl.assert_not_called()

    @patch.object(service, 'status')
    @patch.object(service, 'process_exists')
    @patch.object(service, 'launchctl', return_value=result())
    def test_stop_confirms_job_and_observed_pid_exit(self, launchctl, process_exists, status):
        self.installed()
        status.side_effect = [{'loaded': True, 'pid': 123}, {'loaded': False}]
        process_exists.return_value = False
        self.assertIn('process-exited', service.stop(self.record, 'backend'))
        self.assertEqual(launchctl.call_args.args, ('bootout', service.service_target('backend')))
        self.assertGreater(launchctl.call_args.kwargs['timeout'], 45)
        process_exists.assert_called_once_with(123)

    @patch.object(service, 'status', return_value={'loaded': True, 'pid': 123})
    @patch.object(service, 'launchctl', return_value=result(1))
    def test_stop_failure_never_claims_stopped(self, launchctl, status):
        self.installed()
        with self.assertRaisesRegex(service.ServiceError, 'do not start another'):
            service.stop(self.record, 'backend')

    @patch.object(service, 'status')
    def test_uninstall_only_removes_matching_unloaded_plist(self, status):
        path = self.installed()
        status.return_value = {'loaded': True}
        with self.assertRaises(service.ServiceError):
            service.uninstall(self.record, 'backend')
        self.assertTrue(path.exists())
        status.return_value = {'loaded': False}
        self.assertIn('preserved', service.uninstall(self.record, 'backend'))
        self.assertFalse(path.exists())
        self.assertTrue(self.record_path.exists())

    def test_private_fifo_is_rejected_without_blocking(self):
        fifo = self.root / 'fifo'
        os.mkfifo(fifo, 0o600)
        with self.assertRaises(service.ServiceError):
            service.private_json(fifo)

    def loaded_output(self):
        job = service.job(self.record, 'backend')
        return ('job = {\n\tpath = ' + str(service.plist_path('backend')) + '\n\tprogram = ' + job['ProgramArguments'][0]
                + '\n\tworking directory = ' + job['WorkingDirectory'] + '\n\targuments = {\n'
                + ''.join('\t\t' + arg + '\n' for arg in job['ProgramArguments']) + '\t}\n\tenvironment = {\n'
                + ''.join('\t\t' + key + ' => ' + value + '\n' for key, value in job['EnvironmentVariables'].items())
                + '\t}\n\tstate = running\n\tpid = 123\n}')

    @patch.object(service, 'launchctl')
    def test_matching_disk_cannot_authorize_a_different_loaded_job(self, launchctl):
        self.installed()
        output = self.loaded_output()
        launchctl.return_value = result(output=output)
        self.assertTrue(service.status('backend', self.record)['loaded'])
        for changed in [output.replace('/synthetic/python', '/foreign/python'),
                        output.replace('/synthetic/config.json', '/foreign/config.json'),
                        output.replace('DOTG_ENABLE_POLLING => 0', 'DOTG_ENABLE_POLLING => 1'),
                        output.replace('\tworking directory = /synthetic/checkout', '\tworking directory = /foreign')]:
            launchctl.reset_mock()
            launchctl.return_value = result(output=changed)
            with self.assertRaises(service.ServiceError):
                service.stop(self.record, 'backend')
            self.assertTrue(all(call.args[0] == 'print' for call in launchctl.call_args_list))

    @patch.object(service, 'status', side_effect=[{'loaded': True}, {'loaded': False}])
    @patch.object(service, 'launchctl', return_value=result())
    def test_no_pid_snapshot_never_claims_observed_exit(self, launchctl, status):
        self.installed()
        message = service.stop(self.record, 'backend')
        self.assertIn('exit unverified', message)
        self.assertNotIn('observed-process-exited', message)

    @patch.object(service.time, 'monotonic', return_value=100)
    def test_inspection_uses_remaining_shutdown_budget(self, now):
        self.assertEqual(service.remaining(102), 2)
        with self.assertRaises(service.ServiceError):
            service.remaining(99)


if __name__ == '__main__':
    unittest.main()
