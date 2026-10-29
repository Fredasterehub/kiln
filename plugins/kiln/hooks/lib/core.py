"""Kiln hook policy; native wire formats live in the family adapters."""
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

PLUGIN = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PLUGIN))
from lib.ledger import live_pid, markers, pending, read_json, records, workers

PERSISTENT = {"director", "super", "manager", "helper", "chunkmaster"}
BOSSES = {"director", "super", "manager", "chunkmaster"}
TEAM = shlex.quote(str(PLUGIN / "bin/team"))
SENTENCE = "this is enough; read rules, ledger and panes only where an item points you"


def ledger(home, metrics, stream=None):
    def bad_line(number, error):
        metrics["bad_lines"] = metrics.get("bad_lines", 0) + 1
    with (home / "ledger.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_SH)
        return records(home, on_error=bad_line, stream=stream)


def unread(seat, rows):
    marked = markers(seat)
    return [r for r in rows if r.get("to") == seat["address"] and r.get("id") not in marked]


def live_worker(child):
    if child["role"] != "worker":
        return False
    run = Path(child["run"])
    candidates = [(0, run / "status.txt")]
    for candidate in run.glob("status-fix*.txt"):
        match = re.fullmatch(r"status-fix(\d+)\.txt", candidate.name)
        if match:
            candidates.append((int(match[1]), candidate))
    existing = [(round_id, path) for round_id, path in candidates if path.is_file()]
    if existing:
        _, path = max(existing)
        last = next((line.strip() for line in reversed(path.read_text().splitlines()) if line.strip()), "")
        return not re.match(r"^(?:\d{2}:\d{2}\s+)?(?:done|question):", last)
    return True


def outgoing_session(state, session):
    return bool(session and state.get("old_session") == session and state.get("acked") is False)


def listener_outgoing(home, seat, session, metrics):
    try:
        state = read_json(home / "rotations" / f'{seat["address"]}.json', {})
        return outgoing_session(state, session)
    except (OSError, ValueError, TypeError, AttributeError) as error:
        metrics["stop_error"] = f"{type(error).__name__}: {error}"
        return False  # An invalid rotation must not suppress a recovery wake.


def stop(home, seat, payload, metrics, outgoing=False):
    rotation = home / "rotations" / f'{seat["address"]}.json'
    state = read_json(rotation, {})
    owns_rotation = outgoing_session(state, payload.get("session_id"))
    outgoing = outgoing or bool(owns_rotation)
    reasons = []
    if not outgoing:
        new = unread(seat, ledger(home, metrics))
        if new:
            metrics["unread_refusal"] = not payload.get("stop_hook_active", False)
            reasons.append("Unread rows " + ", ".join(r["id"] for r in new) + f"; run: {TEAM} inbox --mark")
        for child in workers(home, seat):
            worker = child["address"]
            if live_worker(child) and not live_pid(home / "waits" / f"{worker}.pid"):
                marker = shlex.quote(str(home / "waits" / f"{worker}.pid"))
                command = (f"mkdir -p {shlex.quote(str(home / 'waits'))}; "
                           f"herdr agent wait {shlex.quote(worker)} --timeout {seat.get('wait_ms', 1800000)} & "
                           f'wait_pid=$!; echo "$wait_pid" > {marker}; wait "$wait_pid"')
                how = " with run_in_background: true" if seat["family"] == "claude" else " in the foreground"
                reasons.append(f"Worker {worker} has no armed wait; run{how}: {command}")
    if owns_rotation:
        reasons.append(f"Rotation of session {state['old_session']} awaits handoff-plugin ack; inspect: cat {shlex.quote(str(rotation))}")
    return "\n".join(reasons) or None


def start(home, seat, metrics):
    parts = [f"Role: {seat['role']}\nRoot: {seat['root']}\nInbox: {seat['inbox']}\nParent: {seat['parent']}"]
    paths = []
    if seat.get("card"):
        plugin = Path(os.environ.get("KILN_PLUGIN", str(PLUGIN)))
        paths.append(plugin / "cards/common.md")
    if seat.get("card"):
        paths.append(Path(seat["card"]))
    for path in paths:
        if path.is_file():
            parts.append(path.read_text().rstrip("\n"))
    parts.append("Pending ids: " + (", ".join(r["id"] for r in pending(ledger(home, metrics), seat)) or "none"))
    parts.append(SENTENCE)
    context = "\n\n".join(parts)
    metrics["card_lines"] = len(context.splitlines())
    if metrics["card_lines"] > 40:
        metrics["warning"] = "card exceeds 40 lines"
    handoff = Path(seat["handoff"]) if seat.get("handoff") else None
    if handoff and handoff.is_file():
        parts.insert(-2, handoff.read_text().rstrip("\n"))
    return "\n\n".join(parts)


def fence(seat, payload, adapter):
    tool, data = payload["tool_name"], payload["tool_input"]
    cwd = Path(payload.get("cwd", seat["root"]))
    directories = [seat["root"], *seat.get("extra_roots", [])]
    if payload.get("scratchpad_dir"):
        directories.append(payload["scratchpad_dir"])
    roots = [Path(p).resolve() for p in directories]
    handoff = Path(seat["handoff"]).resolve() if seat.get("handoff") else None
    card = Path(seat["card"]).resolve() if seat.get("card") else None
    for value in adapter.paths(tool, data):
        path = (cwd / value).resolve()
        if path == card:
            return f"card {value} is read-only"
        if path != handoff and not any(path.is_relative_to(root) for root in roots):
            return f"path {value} is outside declared roots; use a declared writable path"
    if tool != "Bash" or seat["role"] not in BOSSES:
        return None
    # Literal Herdr forms only. Never interpret shell writes or nested programs.
    lexer = shlex.shlex(data["command"], posix=True, punctuation_chars=";&|()\n")
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
        if len(tail) > 2 and tail[2] in ("--help", "-h"):
            continue  # Herdr handles help only in the target position.
        if tail[:2] in (["agent", "wait"], ["pane", "wait-output"]):
            if not any(w == "--timeout" or w.startswith("--timeout=") for w in tail[2:]):
                return "Herdr waits require --timeout; use the seat's wait_ms"
            if seat["family"] == "claude" and data.get("run_in_background") is not True:
                return "Claude waits require Bash run_in_background: true"
        if tail[:2] in (["agent", "prompt"], ["pane", "send-text"], ["pane", "send-keys"]):
            if len(tail) <= 2:
                continue  # No target argument: leave the usage error to Herdr.
            target = tail[2]  # Literal target, including options, empty strings and --.
            home = Path(os.environ["KILN_HOME"])
            children = workers(home, seat)
            addresses = {c["address"] for c in children} - {"director", seat["address"]}
            panes = {c["pane"] for c in children if c["address"] in addresses}
            director = read_json(home / "seats/director.json", {}).get("pane")
            allowed = addresses - {director} if tail[0] == "agent" else panes - {director, None}
            if target not in allowed:
                return f"target {target} is outside my workers; use a worker target (never the director's pane)"
    return None


def listen(home, seat, payload, metrics):
    """Read appended bytes only; marker removal precedes the final expiry check."""
    session = payload.get("session_id")
    if listener_outgoing(home, seat, session, metrics):
        return 0
    path = home / "ledger.jsonl"
    with path.open("a+b") as stream:
        stream.seek(0)
        rows = unread(seat, ledger(home, metrics, stream))
        if payload["hook_event_name"] == "Stop" and not payload.get("stop_hook_active") and rows:
            # Both native handlers run independently. Reuse the complete policy,
            # rather than assuming unread rows imply a successful Stop refusal.
            probe = {}
            try:
                reason = stop(home, seat, payload, probe)
            except Exception as error:
                metrics["stop_error"] = f"{type(error).__name__}: {error}"
            else:
                if reason and probe.get("unread_refusal"):
                    return 0
        ignore_ids = {r["id"] for r in rows} if payload.get("stop_hook_active") else set()
        return listen_armed(home, seat, metrics, stream, rows, session, ignore_ids)


def listen_armed(home, seat, metrics, stream, rows, session, ignore_ids):
    directory = home / "listeners"
    directory.mkdir(exist_ok=True)
    marker = directory / f'{seat["address"]}.json'
    pid_marker = directory / f'{seat["address"]}.pid'
    lock_path = directory / f'{seat["address"]}.lock'
    token = uuid.uuid4().hex
    initial_rows = [r for r in rows if r["id"] in ignore_ids]
    expiry_receipt = directory / f'{seat["address"]}.expiry.json'
    def retire():
        with lock_path.open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            if pid_marker.exists() and pid_marker.read_text().strip() == str(os.getpid()):
                pid_marker.unlink()
    def terminate(signum, frame):
        raise SystemExit(0)
    def fresh_unread(items):
        return [r for r in unread(seat, items) if r["id"] not in ignore_ids]
    def wake(items):
        if items:
            print("Unread rows " + ", ".join(r["id"] for r in items) + f"; run: {TEAM} inbox --mark", file=sys.stderr)
            return 2
        return 0
    handlers = {sig: signal.signal(sig, terminate) for sig in (signal.SIGTERM, signal.SIGINT)}
    try:
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
            if read_json(marker, {}).get("token") != token or listener_outgoing(home, seat, session, metrics):
                return 0
            rows = fresh_unread(rows + ledger(home, metrics, stream))
            if rows:
                return wake(rows)
            time.sleep(1)
        retire()
        if listener_outgoing(home, seat, session, metrics):
            return 0
        fresh = fresh_unread(rows + ledger(home, metrics, stream))
        with lock_path.open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            if read_json(marker, {}).get("token") != token:
                return 0  # A replacement owns delivery now.
            woken = set(read_json(expiry_receipt, {"woken": []})["woken"])
            delayed = {r["id"]: r for r in unread(seat, initial_rows) if r["id"] not in woken}
            if delayed:
                temporary = expiry_receipt.with_suffix(".tmp")
                temporary.write_text(json.dumps({"woken": sorted(woken | delayed.keys())}) + "\n")
                temporary.replace(expiry_receipt)
        return wake(fresh + list(delayed.values()))
    finally:
        try:
            retire()
        finally:
            for sig, handler in handlers.items():
                signal.signal(sig, handler)


def main():
    event = sys.argv[1]
    home, metrics, outcome = None, {}, "allow"
    try:
        seat = read_json(Path(os.environ["KILN_SEAT"]), {})
        pane = os.environ.get("HERDR_PANE_ID")
        if not pane:
            return 0
        outgoing = False
        if seat.get("pane") != pane:
            state = read_json(Path(os.environ["KILN_HOME"]) / "rotations" / f'{seat["address"]}.json', {})
            if not (event in ("fence", "stop") and state.get("old_pane") == pane and state.get("acked") is False):
                return 0
            outgoing = True
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
            reason = stop(home, seat, payload, metrics, outgoing=outgoing)
            if reason:
                block = not payload.get("stop_hook_active", False)
                outcome = "refuse" if block else "report"
                output = adapter.stop(reason, block=block)
        elif event == "start":
            output = adapter.start(start(home, seat, metrics))
        elif event == "fence":
            reason = fence(seat, payload, adapter)
            if reason:
                outcome, output = "deny", adapter.deny(reason, payload["tool_name"])
        elif event == "listen" and family == "claude":
            return listen(home, seat, payload, metrics)
        if output is not None:
            print(json.dumps(output))
    except Exception as error:
        outcome = f"error {type(error).__name__}: {error}"
        if home is None and os.environ.get("KILN_HOME"):
            home = Path(os.environ["KILN_HOME"])
    finally:
        if home is not None and (outcome != "allow" or metrics):
            try:
                with (home / "hooks.log").open("a") as stream:
                    stream.write(json.dumps({"event": event, "outcome": outcome, **metrics}) + "\n")
            except OSError:
                pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
