"""Kiln hook policy. See docs/hooks.md for the small on-disk interfaces."""
import fcntl
import importlib
import json
import os
from pathlib import Path
import re
import shlex
import signal
import sys
import time
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from lib.ledger import live_pid, markers, pending, read_json, workers

PERSISTENT = {"director", "super", "manager", "helper", "chunkmaster"}
BOSSES = {"director", "super", "manager", "chunkmaster"}
SENTENCE = "this is enough; read rules, ledger and panes only where an item points you"


def ledger(home):
    # Same lock as team: a partially appended row is never interpreted.
    with (home / "ledger.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_SH)
        path = home / "ledger.jsonl"
        return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []


def unread(home, seat, rows):
    marked = markers(seat)
    return [r for r in rows if r["to"] == seat["address"] and r["id"] not in marked]


def finished(row):
    if not row.get("path"):
        return False
    path = Path(row["path"])
    candidates = [path / "status.txt"] if path.is_dir() else [path, path.parent / "status.txt"]
    for candidate in candidates:
        if candidate.is_file():
            lines = candidate.read_text().splitlines()
            last = next((line.strip() for line in reversed(lines) if line.strip()), "")
            if re.match(r"^(?:\d{2}:\d{2}\s+)?done:(?:\s|$)", last):
                return True
    return False


def stop(home, seat, payload):
    if payload.get("stop_hook_active"):
        return None
    rows = ledger(home)
    reasons = []
    new = unread(home, seat, rows)
    if new:
        reasons.append("Unread rows " + ", ".join(r["id"] for r in new) + "; run: team inbox --mark")
    for child in workers(home, seat):
        worker = child["address"]
        if not live_pid(home / "waits" / f"{worker}.pid"):
            command = f"herdr agent wait {shlex.quote(worker)} --timeout 30000"
            marker = shlex.quote(str(home / "waits" / f"{worker}.pid"))
            # The Claude native tool must finish its Bash call with '&'.
            command = (f"mkdir -p {shlex.quote(str(home / 'waits'))}; "
                       f"{command} & wait_pid=$!; echo \"$wait_pid\" > {marker}; wait \"$wait_pid\"")
            if seat["family"] == "claude":
                command = f"( {command} ) &"
            reasons.append(f"Worker {worker} has no armed wait; run: {command}")
    marked = markers(seat)
    done = {r["cites"] for r in rows if r["kind"] == "done"}
    for row in rows:
        if (row["kind"] == "request" and row["to"] == seat["address"]
                and row["id"] in marked and row["id"] not in done and finished(row)):
            args = ["team", "send", "--from", seat["address"], "--to", row["from"],
                    "--kind", "done", "--task", row["task"], "--cites", row["id"],
                    "--headline", "Completed", "--path", row["path"]]
            reasons.append(f'Finished request {row["id"]} has no done; run: {shlex.join(args)}')
    rotation = home / "rotations" / f'{seat["address"]}.json'
    state = read_json(rotation, {})
    if state.get("pane") == seat["pane"] and state.get("acked") is False:
        reasons.append(f'Rotation {state["id"]} awaits replacement ack; run: cat {shlex.quote(str(rotation))}')
    return "\n".join(reasons) or None


def start(home, seat):
    parts = []
    for key in ("card", "handoff"):
        path = Path(seat[key]) if seat.get(key) else None
        if path and path.is_file():
            parts.append(path.read_text())
    parts.append("Pending ids: " + (", ".join(r["id"] for r in pending(ledger(home), seat)) or "none"))
    parts.append(SENTENCE)
    return "\n\n".join(parts)


def fence(seat, payload, adapter):
    tool, data = payload["tool_name"], payload["tool_input"]
    cwd = Path(payload.get("cwd", seat["root"]))
    roots = [Path(p).resolve() for p in [seat["root"], *seat.get("extra_roots", [])]]
    for value in adapter.paths(tool, data):
        path = (cwd / value).resolve()
        if not any(path.is_relative_to(root) for root in roots):
            return f"path {value} is outside root + extra_roots; use a declared writable path"
    if tool != "Bash" or seat["role"] not in BOSSES:
        return None
    # Recognize only literal Herdr command shapes; no shell execution or poll-loop heuristics.
    command = data["command"]
    lexer = shlex.shlex(command, posix=True, punctuation_chars=";&|()\n")
    lexer.whitespace = " \t\r"
    lexer.whitespace_split = True
    words = list(lexer)
    def boundary(word):
        return bool(word) and all(c in ";&|()\n" for c in word)
    for index, word in enumerate(words):
        if Path(word).name != "herdr" or (index and not boundary(words[index - 1])):
            continue
        end = next((i for i in range(index + 1, len(words)) if boundary(words[i])), len(words))
        tail = words[index + 1:end]
        if tail[:2] in (["agent", "wait"], ["pane", "wait-output"]):
            if not any(w == "--timeout" or w.startswith("--timeout=") for w in tail[2:]):
                return "Herdr waits require --timeout; add --timeout 30000"
            if tail[:2] == ["agent", "wait"] and seat["family"] == "claude" and not command.rstrip().endswith("&"):
                return "Claude Herdr agent waits must end in &; run the wait in the background"
        if tail[:2] in (["agent", "prompt"], ["pane", "send-text"], ["pane", "send-keys"]):
            target = tail[2] if len(tail) > 2 else ""
            home = Path(os.environ["KILN_HOME"])
            children = workers(home, seat)
            addresses = {c["address"] for c in children} - {"director", seat["pane"]}
            panes = {c["pane"] for c in children if c["address"] in addresses}
            director = read_json(home / "seats/director.json", {}).get("pane")
            allowed = addresses - {director} if tail[0] == "agent" else panes - {director, None}
            if target not in allowed:
                return f"target {target} is outside my workers; use a worker target (never the director's pane)"
    return None


def listen(home, seat):
    """Proven asyncRewake pattern: unread check, sleep, exit 2. Never consumes rows."""
    directory = home / "listeners"
    directory.mkdir(exist_ok=True)
    marker = directory / f'{seat["address"]}.json'
    token = uuid.uuid4().hex
    pid_marker = directory / f'{seat["address"]}.pid'
    lock_path = directory / f'{seat["address"]}.lock'
    def terminate(signum, frame):
        raise SystemExit(0)
    handlers = {sig: signal.signal(sig, terminate) for sig in (signal.SIGTERM, signal.SIGINT)}
    try:
        # Serialize listener generations; publish a complete PID marker atomically.
        with lock_path.open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            marker.write_text(json.dumps({"pane": seat["pane"], "token": token}))
            temporary = pid_marker.with_suffix(".tmp")
            temporary.write_text(str(os.getpid()) + "\n")
            temporary.replace(pid_marker)
        deadline = time.monotonic() + 280
        while time.monotonic() < deadline:
            if read_json(Path(os.environ["KILN_SEAT"]), {}).get("pane") != seat["pane"]:
                return 0
            if read_json(marker, {}).get("token") != token:
                return 0
            rows = unread(home, seat, ledger(home))
            if rows:
                print("Unread rows " + ", ".join(r["id"] for r in rows) + "; run: team inbox --mark", file=sys.stderr)
                return 2
            time.sleep(0.25)
        return 0
    finally:
        try:
            with lock_path.open("a") as lock:
                fcntl.flock(lock, fcntl.LOCK_EX)
                if pid_marker.exists() and pid_marker.read_text().strip() == str(os.getpid()):
                    pid_marker.unlink()
        finally:
            for sig, handler in handlers.items():
                signal.signal(sig, handler)


def main():
    event = sys.argv[1]
    home = None
    outcome = "allow"
    try:
        seat = read_json(Path(os.environ["KILN_SEAT"]), {})
        if not os.environ.get("HERDR_PANE_ID") or seat.get("pane") != os.environ["HERDR_PANE_ID"]:
            return 0
        home = Path(os.environ["KILN_HOME"])
        payload = json.load(sys.stdin)
        family = seat["family"]
        if family not in ("claude", "codex"):
            return 0
        adapter = importlib.import_module(family)
        output = None
        if event in ("stop", "start", "listen") and seat["role"] not in PERSISTENT:
            return 0
        if event == "stop":
            reason = stop(home, seat, payload)
            if reason:
                outcome, output = "refuse", adapter.stop(reason)
        elif event == "start":
            output = adapter.start(start(home, seat))
        elif event == "fence":
            reason = fence(seat, payload, adapter)
            if reason:
                outcome, output = "deny", adapter.deny(reason, payload["tool_name"])
        elif event == "listen" and family == "claude":
            result = listen(home, seat)
            outcome = "wake" if result else "retire"
            return result
        if output is not None:
            print(json.dumps(output))
    except Exception as error:
        outcome = f"error {type(error).__name__}: {error}"
        # A broken seat is still logged when KILN_HOME is available; mismatched panes are not seats.
        if home is None and os.environ.get("KILN_HOME"):
            home = Path(os.environ["KILN_HOME"])
    finally:
        if home is not None:
            try:
                with (home / "hooks.log").open("a") as stream:
                    stream.write(json.dumps({"event": event, "outcome": outcome}) + "\n")
            except OSError:
                pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
