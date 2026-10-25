"""Hold an OS lease across exec so process crashes cannot leave a stale lock.

No credentials are read here. The backend opens its existing private configuration.
"""
import argparse
import fcntl
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys


def acquire_lease(database):
    directory = database.parent
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = directory.stat()
    if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o077:
        raise ValueError('Runtime directory must be private and owned by this user')
    # Pre-lease releases used an existence lock. Never remove or reinterpret it.
    if os.path.lexists(str(database) + '.lock'):
        raise ValueError('Legacy runtime lock present; stop the existing backend cleanly first')
    path = str(database) + '.lease'
    fd = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o600 or info.st_nlink != 1:
            raise ValueError('Unsafe runtime lease file')
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        # Metadata is diagnostic only. The kernel lock, not this PID, is authority.
        os.ftruncate(fd, 0)
        os.write(fd, json.dumps({'version': 1, 'pid': os.getpid()}).encode())
        os.fsync(fd)
        os.set_inheritable(fd, True)
        return fd
    except BaseException:
        os.close(fd)
        raise


def main():
    parser = argparse.ArgumentParser(description='Start one dotg backend with an OS-managed runtime lease.')
    parser.add_argument('--node', default=shutil.which('node'))
    args = parser.parse_args()
    if not args.node:
        raise ValueError('Select a supported Node LTS before starting dotg')
    node = str(Path(args.node).resolve(strict=True))
    root = Path(__file__).resolve().parents[1]
    # Run the same version preflight as the other entry points, before any DB work.
    subprocess.run([node, str(root / 'scripts/check-runtime.mjs')], check=True, timeout=10)
    database_input = Path(os.environ.get('DOTG_DATABASE', 'runtime/dotg.sqlite')).absolute()
    if database_input.is_symlink():
        raise ValueError('Database must not be a symbolic link')
    database = database_input.resolve()
    fd = acquire_lease(database)
    try:
        env = dict(os.environ, DOTG_DATABASE=str(database), DOTG_LOCK_FD=str(fd))
        os.execve(node, [node, str(root / 'src/server.mjs')], env)
    finally:
        os.close(fd)


if __name__ == '__main__':
    try:
        main()
    except BlockingIOError:
        print('dotg is already using this database; no second backend was started.', file=sys.stderr)
        sys.exit(1)
    except (OSError, ValueError, subprocess.SubprocessError):
        print('dotg startup refused; check the supported Node path, private runtime directory, and legacy lock. No lock was deleted.', file=sys.stderr)
        sys.exit(1)
