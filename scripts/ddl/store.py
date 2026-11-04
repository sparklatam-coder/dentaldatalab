"""Timestamps and durable JSON checkpoints shared by the collectors."""
import datetime
import json
import os
from pathlib import Path


def now():
    """ISO-8601 UTC timestamp with millisecond precision (one format for every collector)."""
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds')


def atomic_json(path, value, indent=2, separators=None):
    """Write JSON to ``path`` via a sibling temporary file, fsync, then rename.

    A reader never observes a partial document; a crash leaves either the old
    file or the complete new one. ``separators=(',', ':')`` gives compact output.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.tmp')
    with temporary.open('w', encoding='utf-8') as handle:
        json.dump(value, handle, ensure_ascii=False, indent=indent, separators=separators)
        handle.write('\n')
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)
    try:
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    except OSError:
        pass
