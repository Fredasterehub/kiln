"""Copied from Kiln 4 hooks/lib/worktree.py; Lite also supports plain cwd dirs."""
import hashlib
import os
from pathlib import Path
import subprocess


def worktree_mark(root, run):
    def git(*args, directory=None):
        return subprocess.run(["git", "-C", directory or root, *args], capture_output=True,
                              stdin=subprocess.DEVNULL, timeout=30)

    probe = git("rev-parse", "--is-inside-work-tree")
    if probe.returncode or probe.stdout.strip() != b"true":
        return directory_mark(root, run)

    def output(*args):
        result = git(*args)
        if result.returncode:
            raise ValueError(result.stderr.decode(errors="replace").strip() or "cannot fingerprint worktree")
        return result.stdout

    # Use repository-relative paths even when the seat reads from a subdirectory.
    root = os.fsdecode(output("rev-parse", "--show-toplevel").rstrip(b"\n"))
    paths = []
    run_path = Path(run).resolve()
    if run_path.is_relative_to(Path(root)):
        excluded = run_path.relative_to(root).as_posix()
        paths = ["--", ".", f":(top,exclude,literal){excluded}"]
    # Hash the resulting tree, not HEAD-relative diff/status encodings: staging
    # and committing unchanged bytes must leave the fingerprint unchanged.
    names = set(output("ls-files", "--cached", "-z", *paths).split(b"\0"))
    names.update(output("ls-files", "--others", "--exclude-standard", "-z", *paths).split(b"\0"))
    digest = hashlib.sha256()
    for name in sorted(names - {b""}):
        path = Path(root) / os.fsdecode(name)
        if path.is_symlink():
            kind, contents = b"link", os.fsencode(os.readlink(path))
        elif path.is_file():
            kind = b"exec" if path.stat().st_mode & 0o111 else b"file"
            contents = path.read_bytes()
        elif path.is_dir():
            # A tracked file replaced by a directory, or an uninitialized
            # submodule, still resolves to this repository: do not recurse
            # back into the same tree.
            nested = git("rev-parse", "--show-toplevel", directory=path)
            nested_root = Path(os.fsdecode(nested.stdout.rstrip(b"\n"))) if nested.returncode == 0 else None
            mark = worktree_mark(path, run) if nested_root and nested_root != Path(root) else directory_mark(path, run)
            kind, contents = b"tree", mark.encode()
        else:
            continue  # A tracked deletion has no resulting tree entry.
        digest.update(name + b"\0" + kind + b"\0" + len(contents).to_bytes(8, "big") + contents)
    return digest.hexdigest()


def head_sha(root):
    try:
        result = subprocess.run(["git", "-C", str(root), "rev-parse", "--verify", "HEAD"],
                                capture_output=True, text=True, stdin=subprocess.DEVNULL)
    except FileNotFoundError:
        return None
    return result.stdout.strip() if result.returncode == 0 else None


def directory_mark(root, run):
    """Fingerprint a non-Git --cwd, excluding the run's changing receipts."""
    root, run = Path(root).resolve(), Path(run).resolve()
    if not root.is_dir():
        return None
    digest = hashlib.sha256()
    for path in sorted(root.rglob("*")):
        if path.is_relative_to(run):
            continue
        name = os.fsencode(path.relative_to(root))
        mode = path.lstat().st_mode.to_bytes(4, "big")
        if path.is_symlink():
            contents = os.fsencode(os.readlink(path))
        elif path.is_file():
            contents = path.read_bytes()
        else:
            contents = b""
        digest.update(name + b"\0" + mode + len(contents).to_bytes(8, "big") + contents)
    return digest.hexdigest()
