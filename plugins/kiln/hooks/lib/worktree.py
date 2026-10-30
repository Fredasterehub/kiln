"""Worktree fingerprints shared by launch and acceptance."""
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
        return None

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
    digest = hashlib.sha256()
    head = git("rev-parse", "--verify", "HEAD")
    digest.update(head.stdout if head.returncode == 0 else b"")
    digest.update(output("status", "--porcelain=v1", "-z", *paths))
    if head.returncode == 0:
        digest.update(output("diff", "HEAD", "--binary", *paths))
    else:
        # An unborn branch has no HEAD tree; retain both index and worktree changes.
        digest.update(output("diff", "--cached", "--binary", *paths))
        digest.update(output("diff", "--binary", *paths))
    for name in output("ls-files", "-o", "--exclude-standard", "-z", *paths).split(b"\0"):
        if not name:
            continue
        path = Path(root) / os.fsdecode(name)
        if path.is_symlink():
            contents = os.fsencode(os.readlink(path))
        elif path.is_dir():
            nested_head = git("rev-parse", "--verify", "HEAD", directory=path)
            contents = nested_head.stdout if nested_head.returncode == 0 else b""
        else:
            contents = path.read_bytes()
        # Frame binary contents so embedded NULs cannot blur file boundaries.
        digest.update(name + b"\0" + len(contents).to_bytes(8, "big") + contents)
    return digest.hexdigest()
