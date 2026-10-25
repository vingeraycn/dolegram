"""Shared OS lease for the backend and offline state maintenance."""
import fcntl
import json
import os
import stat


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
