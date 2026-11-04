"""Run a compiled CLI with a real Unix TTY (stdlib only, no PTY dependency)."""

import errno
import os
import pty
import sys

pid, master = pty.fork()
if pid == 0:
    os.execvp(sys.argv[1], sys.argv[1:])

try:
    while True:
        try:
            output = os.read(master, 65536)
        except OSError as error:
            if error.errno == errno.EIO:
                break
            raise
        if not output:
            break
        sys.stdout.buffer.write(output)
        sys.stdout.buffer.flush()
finally:
    os.close(master)

_, status = os.waitpid(pid, 0)
sys.exit(os.waitstatus_to_exitcode(status))
