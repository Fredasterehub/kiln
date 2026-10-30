"""Resolve caller paths, with run-relative fallback for artifact packets."""
from pathlib import Path


def run_path(home, value):
    path = Path(value).expanduser()
    if not path.is_absolute() and not path.exists():
        path = home / path
    return path.resolve()
