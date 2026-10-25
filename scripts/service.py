"""Manage only dotg's per-user macOS jobs using a private installation record.

No credential lookup, shell interpolation, automatic handover or data deletion.
"""
import argparse
import json
import os
from pathlib import Path
import plistlib
import socket
import stat
import subprocess
import sys
import time

LABELS = {'backend': 'io.dotg.backend', 'tunnel': 'io.dotg.tunnel'}
FIELDS = {'version', 'checkout', 'nodeExecutable', 'pythonExecutable', 'configPath',
          'databasePath', 'runtimeDirectory', 'pollingEnabled', 'callbackDnsServers',
          'tunnelLauncher', 'tunnelSettingsPath'}


class ServiceError(Exception):
    """A fixed, safe operator message; never wrap raw OS or configuration errors."""


def private_json(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o600 or info.st_size > 65536:
            raise ServiceError('JSON input must be a private regular file, owned by this user, with mode 0600.')
        with os.fdopen(fd, 'r', closefd=False) as source:
            return json.load(source)
    finally:
        os.close(fd)


def absolute(value):
    if not isinstance(value, str) or not value.startswith('/') or any(char in value for char in ['\0', '\n', '\r']):
        raise ServiceError('Record paths must be absolute and contain no control characters.')
    return Path(value)


def settings(path):
    record = private_json(path)
    if not isinstance(record, dict) or set(record) - FIELDS or type(record.get('version')) is not int or record['version'] != 1 or type(record.get('pollingEnabled')) is not bool:
        raise ServiceError('Use installation record version 1 and an explicit pollingEnabled boolean; unknown fields are refused.')
    required = ['checkout', 'nodeExecutable', 'pythonExecutable', 'configPath', 'databasePath', 'runtimeDirectory']
    for field in required + [key for key in ['tunnelLauncher', 'tunnelSettingsPath'] if key in record]:
        absolute(record[field])
    if ('tunnelSettingsPath' in record) != ('tunnelLauncher' in record):
        raise ServiceError('Tunnel service requires both the background-capable launcher and its settings path.')
    dns = record.get('callbackDnsServers', '')
    if not isinstance(dns, str) or len(dns) > 1024 or any(char in dns for char in ['\0', '\n', '\r']):
        raise ServiceError('Invalid callback DNS setting.')
    return record


def job(record, component):
    if component == 'backend':
        arguments = [record['pythonExecutable'], str(Path(record['checkout']) / 'scripts/run-backend.py'), '--node', record['nodeExecutable']]
        directory = record['checkout']
        environment = {'PATH': '/usr/bin:/bin', 'DOTG_CONFIG': record['configPath'], 'DOTG_DATABASE': record['databasePath'],
                       'DOTG_ENABLE_POLLING': '1' if record['pollingEnabled'] else '0'}
        if record.get('callbackDnsServers'):
            environment['DOTG_CALLBACK_DNS_SERVERS'] = record['callbackDnsServers']
    else:
        arguments = [record['tunnelLauncher'], '--run-background', record['tunnelSettingsPath']]
        directory = record['runtimeDirectory']
        environment = {'PATH': '/usr/bin:/bin'}
    return {'Label': LABELS[component], 'ProgramArguments': arguments, 'WorkingDirectory': directory,
            'EnvironmentVariables': environment, 'RunAtLoad': True,
            'KeepAlive': {'SuccessfulExit': False}, 'ThrottleInterval': 60, 'ExitTimeOut': 45,
            'ProcessType': 'Background', 'Umask': 0o077,
            'StandardOutPath': '/dev/null', 'StandardErrorPath': '/dev/null'}


def verify_files(record, component):
    paths = [record['pythonExecutable'], record['nodeExecutable']] if component == 'backend' else [record['tunnelLauncher']]
    for value in paths:
        path = absolute(value).resolve(strict=True)
        info = path.stat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid not in [0, os.getuid()] or stat.S_IMODE(info.st_mode) & 0o022 or not os.access(path, os.X_OK):
            raise ServiceError('Executable must be owned by this user or root, executable, and not writable by others.')
    if component == 'backend':
        for name in ['scripts/run-backend.py', 'scripts/runtime_lease.py', 'scripts/check-runtime.mjs', 'src/server.mjs']:
            info = (Path(record['checkout']) / name).stat()
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o022:
                raise ServiceError('Checkout entry points must be owned by this user and not writable by others.')
        subprocess.run([record['nodeExecutable'], str(Path(record['checkout']) / 'scripts/check-runtime.mjs')], check=True, timeout=10, capture_output=True)
    # Validate file privacy without printing or copying any credential values.
    private_json(record['configPath'])
    if component == 'tunnel' and record.get('tunnelSettingsPath'):
        private_json(record['tunnelSettingsPath'])
    runtime = absolute(record['runtimeDirectory'])
    info = runtime.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o077:
        raise ServiceError('Runtime directory must be owned by this user, private, and not a symlink.')


def plist_path(component):
    return Path.home() / 'Library/LaunchAgents' / (LABELS[component] + '.plist')


def existing_job(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o077 or info.st_size > 65536:
            raise ServiceError('Existing job file is unsafe; preserve it and inspect its owner and permissions.')
        return plistlib.loads(os.read(fd, 65537))
    finally:
        os.close(fd)


def install(record, component):
    verify_files(record, component)
    # A loaded definition can differ from its current file, or outlive that file.
    status(component, record)
    path = plist_path(component)
    expected = job(record, component)
    path.parent.mkdir(parents=True, exist_ok=True)
    if os.path.lexists(path):
        if existing_job(path) != expected:
            raise ServiceError('A different dotg job exists; preserve it and inspect before replacing.')
        return 'already-installed'
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as target:
        target.write(plistlib.dumps(expected))
        target.flush()
        os.fsync(target.fileno())
    return 'installed-not-started'


def launchctl(*args, timeout=15):
    return subprocess.run(['/bin/launchctl', *args], capture_output=True, text=True, timeout=timeout)


def service_target(component):
    return f'gui/{os.getuid()}/{LABELS[component]}'


def remaining(deadline, maximum=15):
    if deadline is None:
        return maximum
    value = deadline - time.monotonic()
    if value <= 0:
        raise ServiceError('Service inspection timed out; process exit is not confirmed. Do not start another consumer.')
    return min(value, maximum)


def loaded_matches(output, record, component):
    """Fail closed on an unfamiliar launchctl format or another loaded definition."""
    fields, arguments, environment = {}, [], {}
    section = None
    for line in output.splitlines():
        if line.startswith('\t\t'):
            value = line[2:]
            if section == 'arguments':
                arguments.append(value)
            elif section == 'environment':
                key, separator, item = value.partition(' => ')
                if separator:
                    environment[key] = item
        elif line.startswith('\t'):
            key, separator, value = line[1:].partition(' = ')
            section = key if separator and value == '{' else None
            if separator and value != '{':
                fields[key] = value
    expected = job(record, component)
    try:
        same_path = Path(fields['path']).resolve() == plist_path(component).resolve()
    except KeyError:
        same_path = False
    return (same_path and fields.get('program') == expected['ProgramArguments'][0]
            and arguments == expected['ProgramArguments']
            and fields.get('working directory') == expected['WorkingDirectory']
            and all(environment.get(key) == value for key, value in expected['EnvironmentVariables'].items())
            and not any(key.startswith('DOTG_') and key not in expected['EnvironmentVariables'] for key in environment))


def status(component, record=None, deadline=None):
    result = launchctl('print', service_target(component), timeout=remaining(deadline))
    if result.returncode:
        # A missing service and an unavailable login domain are different states.
        # Refuse mutations when inspection fails rather than assuming it stopped.
        if result.returncode != 113 or launchctl('print', f'gui/{os.getuid()}', timeout=remaining(deadline)).returncode:
            raise ServiceError('Cannot inspect the current login domain. No stopped-service claim is possible; do not start another consumer.')
        return {'component': component, 'loaded': False, 'state': 'not-loaded'}
    if record is not None and not loaded_matches(result.stdout, record, component):
        raise ServiceError('The loaded job differs from this record, or its definition cannot be verified. Preserve it; no mutation was attempted.')
    # launchctl print may contain environment details: return a strict small subset.
    details = {'component': component, 'loaded': True, 'state': 'loaded'}
    for line in result.stdout.splitlines():
        # Only the top-level job fields; ignore nested environment/endpoints.
        if not line.startswith('\t') or line.startswith('\t\t'):
            continue
        key, separator, value = line[1:].partition(' = ')
        if separator and key == 'state' and value in ['running', 'waiting', 'exited', 'spawn scheduled']:
            details['state'] = value
        if separator and key in ['pid', 'last exit code'] and value.lstrip('-').isdigit():
            details[key.replace(' ', '_')] = int(value)
    if component == 'tunnel' and details.get('last_exit_code') == 78 and 'pid' not in details:
        details['action'] = 'Check launcher configuration and owner-controlled Keychain access. Background retries never display authorization prompts.'
    return details


def ensure_matches(record, component):
    if existing_job(plist_path(component)) != job(record, component):
        raise ServiceError('Installed job does not match this record; preserve it and inspect before changing it.')


def start(record, component):
    ensure_matches(record, component)
    current = status(component, record)
    if current['loaded']:
        return 'already-loaded; use status and doctor to verify readiness (automatic retries are throttled)'
    verify_files(record, component)
    if component == 'backend':
        # Actual lease exclusion remains authoritative. This additionally prevents
        # a managed/manual port collision during migration from an older version.
        with socket.socket() as probe:
            probe.settimeout(1)
            if probe.connect_ex(('127.0.0.1', 8787)) == 0:
                raise ServiceError('Loopback backend is already running; perform a controlled handover first.')
    result = launchctl('bootstrap', f'gui/{os.getuid()}', str(plist_path(component)))
    if result.returncode:
        raise ServiceError('launchd did not confirm loading the job; inspect status before retrying.')
    return 'loaded; use doctor and the real host to verify readiness'


def stop(record, component):
    ensure_matches(record, component)
    # Cover launchd's 45-second exit grace with one bounded overall budget.
    deadline = time.monotonic() + 55
    current = status(component, record, deadline)
    if not current['loaded']:
        return 'not-loaded'
    result = launchctl('bootout', service_target(component), timeout=remaining(deadline, 55))
    if result.returncode:
        raise ServiceError('launchd did not confirm unloading the job; do not start another consumer.')
    pid = current.get('pid')
    while time.monotonic() < deadline:
        if not status(component, record, deadline)['loaded']:
            if pid is None:
                return 'unloaded-without-a-process-snapshot; process exit unverified, inspect the listener and consumers before handover'
            if not process_exists(pid):
                return 'unloaded-and-observed-process-exited; check for other manual consumers before handover'
        time.sleep(.1)
    raise ServiceError('Unload was requested but process exit is not confirmed. Inspect status and the listener before handover; do not force a second consumer.')


def process_exists(pid):
    if pid is None:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True


def uninstall(record, component):
    ensure_matches(record, component)
    if status(component, record)['loaded']:
        raise ServiceError('Stop the matching job and verify shutdown before uninstalling it.')
    plist_path(component).unlink()
    return 'removed-login-job-only; credentials, database, record and runtime files preserved'


def main():
    parser = argparse.ArgumentParser(description='Manage only the current user\'s dotg launchd jobs; private data is never deleted.')
    parser.add_argument('action', choices=['plan', 'install', 'start', 'stop', 'status', 'uninstall'])
    parser.add_argument('--record', required=True)
    parser.add_argument('--component', choices=['backend', 'tunnel'], default='backend')
    parser.add_argument('--handover-complete', action='store_true', help='Confirm the prior backend/client is stopped and sole-consumer handover is complete')
    args = parser.parse_args()
    if sys.platform != 'darwin':
        raise ServiceError('This service manager requires macOS.')
    record = settings(args.record)
    component = args.component
    if component == 'tunnel' and 'tunnelLauncher' not in record:
        raise ServiceError('This record has no approved Tunnel launcher.')
    if args.action == 'start' and not args.handover_complete:
        raise ServiceError('Confirm the prior consumer/client is stopped with --handover-complete.')
    if args.action == 'plan':
        result = {'component': component, 'label': LABELS[component], 'polling': record['pollingEnabled'] if component == 'backend' else None,
                  'effect': 'Install a login job for the current user; no credentials are stored in its plist.'}
    elif args.action == 'status':
        result = status(component, record)
    else:
        action = {'install': install, 'start': start, 'stop': stop, 'uninstall': uninstall}[args.action]
        result = {'component': component, 'result': action(record, component)}
    print(json.dumps({'result': result, 'scope': 'Job state only, not end-to-end readiness. Keychain access remains owner-controlled.'}, indent=2))


if __name__ == '__main__':
    try:
        main()
    except ServiceError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
    except (OSError, ValueError, KeyError, subprocess.SubprocessError):
        print('dotg service action could not complete. Check the private record, exact job ownership, local permissions and handover. No raw configuration or command output was disclosed.', file=sys.stderr)
        sys.exit(1)
