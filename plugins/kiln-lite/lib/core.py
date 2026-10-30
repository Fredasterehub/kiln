"""Kiln-Lite run discovery and worker execution, using only the standard library."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import time
import tomllib

from lib.adapters import argv_for, parse_output, status_line
from lib.ledger import append, records, inferred_runner, render
from lib.worktree import head_sha, worktree_mark
from lib.paths import run_path

PLUGIN = Path(__file__).resolve().parents[1]


def cache_root():
    return Path.home() / ".cache" / "kiln-lite"


def routing():
    with (PLUGIN / "config/routing.toml").open("rb") as source:
        return tomllib.load(source)["lanes"]


def start(args):
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", args.slug):
        raise ValueError("slug must contain only letters, digits, dots, underscores or hyphens")
    project = Path(args.project).resolve()
    brief = Path(args.brief).read_bytes()
    home = cache_root() / f"{project.name}-{args.slug}"
    home.mkdir(parents=True, exist_ok=False)
    result = subprocess.run(["git", "-C", str(project), "worktree", "add", "-b",
                             f"kiln/{args.slug}", str(home / "wt"), "HEAD"],
                            capture_output=True, text=True)
    if result.returncode:
        home.rmdir()  # Only the empty directory this attempt created.
        raise ValueError(result.stderr.strip())
    for folder in ("research", "plan", "council", "build/gates", "build/chunks", "verify", "deploy", "calls"):
        (home / folder).mkdir(parents=True, exist_ok=True)
    (home / "brief.md").write_bytes(brief)
    (home / "lane.txt").write_text(args.lane + "\n", encoding="utf-8")
    exclude = Path(subprocess.check_output(
        ["git", "-C", str(project), "rev-parse", "--git-path", "info/exclude"], text=True).strip())
    if not exclude.is_absolute():
        exclude = project / exclude
    exclude.parent.mkdir(parents=True, exist_ok=True)
    with exclude.open("a+") as target:
        target.seek(0)
        if "/.kiln-lite-run" not in target.read().splitlines():
            target.write("\n/.kiln-lite-run\n")
    (project / ".kiln-lite-run").write_text(str(home) + "\n", encoding="utf-8")
    append(home, "start", slug=args.slug, project=str(project), lane=args.lane,
           branch=f"kiln/{args.slug}", worktree=str(home / "wt"), phase="brief")
    print(home)
    return 0


def find_home(explicit=None, cwd=None):
    if explicit or os.environ.get("KILN_LITE_RUN"):
        home = Path(explicit or os.environ["KILN_LITE_RUN"]).resolve()
        if not (home / "ledger.jsonl").is_file():
            raise ValueError(f"not a run home: {home}")
        return home
    current = Path(cwd or Path.cwd()).resolve()
    for parent in (current, *current.parents):
        if (parent / "ledger.jsonl").is_file() and (parent / "lane.txt").is_file():
            return parent
        pointer = parent / ".kiln-lite-run"
        if pointer.is_file():
            try:
                return find_home(pointer.read_text().strip())
            except (OSError, ValueError):
                pass  # A stale pointer must not hide an otherwise discoverable run.
    candidates = []
    for ledger in cache_root().glob("*/ledger.jsonl"):
        rows = records(ledger.parent)
        if rows and not any(r["kind"] == "accept" and r.get("artifact_kind") == "deploy" for r in rows) and rows[0].get("project") and current.is_relative_to(Path(rows[0]["project"])):
            candidates.append(ledger.parent)
    if len(candidates) != 1:
        raise ValueError("select a run with --run <home> or KILN_LITE_RUN (no unique active run)")
    return candidates[0]


def resolve_role(lane, role, model=None, effort=None):
    key = role.replace("-", "_")
    aliases = {"researcher": "researcher_gpt", "reviewer": "review_of_gpt",
               "verifier": "verifier_claude", "council_expert": "conceptual.0"}
    key = aliases.get(key, key)
    name, _, seat = key.partition(".")
    route = routing()[lane][name]
    if isinstance(route, list):
        route = route[int(seat or "0")]
    route = dict(route)
    if model:
        route["model"] = model
        # A model override can choose the other research/verification family.
        route["cli"] = ("claude" if model.startswith("claude-") else
                        "agy" if model.startswith("gemini-") else
                        "codex" if model.startswith("gpt-") else route["cli"])
    if effort:
        route["effort"] = effort
    return route, PLUGIN / "cards" / f"{name}.md"


def allocate_call(home, role):
    with (home / "calls" / ".lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        n = max((int(p.name.split("-", 1)[0]) for p in (home / "calls").iterdir()
                 if p.is_dir() and re.match(r"^\d+-", p.name)), default=0) + 1
        call = home / "calls" / f"{n}-{role}"
        call.mkdir()
        return n, call


def resume_meta(home, identifier):
    candidates = [p for p in (home / "calls").glob("*/meta.json")
                  if re.match(r"^\d+-", p.parent.name)]
    for path in sorted(candidates, key=lambda p: int(p.parent.name.split("-", 1)[0]), reverse=True):
        try:
            meta = json.loads(path.read_text())
        except (OSError, ValueError):
            continue
        if identifier in (meta.get("ids") or {}).values() and meta.get("launch_cwd"):
            if not Path(meta["launch_cwd"]).is_dir():
                raise ValueError(f"resume directory is missing: {meta['launch_cwd']}")
            return meta
    raise ValueError(f"no earlier call records resume id {identifier}")


def call_worker(args, emit=True):
    home = find_home(args.run)
    role = args.role.replace("-", "_")
    if not re.fullmatch(r"[a-z_]+(?:\.\d+)?", role):
        raise ValueError("invalid role")
    route, card = resolve_role((home / "lane.txt").read_text().strip(), role, args.model, args.effort)
    packet_path = run_path(home, args.packet)
    if not packet_path.is_file():
        raise ValueError("packet must be a path to an existing file (a .md file; not the text)")
    packet = packet_path.read_text(encoding="utf-8")
    previous = resume_meta(home, args.resume) if args.resume else None
    runner = os.environ.get("KILN_LITE_RUNNER") or inferred_runner(records(home), role)
    card_text = card.read_text(encoding="utf-8")
    default_cwd = previous.get("product_cwd", previous.get("cwd")) if previous else home / "wt"
    cwd = Path(args.cwd).resolve() if args.cwd else Path(default_cwd)
    if not cwd.is_dir():
        raise ValueError(f"cwd is not a directory: {cwd}")
    read_only = args.read_only or route["read_only"]
    before = worktree_mark(cwd, home) if read_only else None
    head_before = head_sha(cwd)
    n, call = allocate_call(home, role)
    packet += (f"\n\nCall artifacts: {call}\nWrite your result to {call / 'result.md'}.\n"
               f"Product working directory: {cwd}\nRead only: {str(read_only).lower()}\n")
    if route["cli"] != "claude" and not args.resume:
        packet = card_text.rstrip() + "\n\n" + packet
    (call / "packet.md").write_text(packet, encoding="utf-8")
    reviewer = card.stem in ("review_of_gpt", "review_of_claude")
    launch_cwd = call if route["cli"] == "agy" or (read_only and not args.cwd and not reviewer) else cwd
    if getattr(args, "call_cwd", False):
        launch_cwd = call
    if previous:
        launch_cwd = Path(previous["launch_cwd"])
    argv = argv_for(route, launch_cwd, call, card, packet, args.resume, home)
    effort = None if route["cli"] == "agy" else route["effort"]
    started = time.monotonic()
    error = None
    with (call / "events.jsonl").open("wb") as stdout, (call / "stderr.log").open("wb") as stderr:
        try:
            with subprocess.Popen(argv, cwd=launch_cwd, stdout=stdout, stderr=stderr,
                                  stdin=subprocess.DEVNULL if route["cli"] == "agy" else subprocess.PIPE,
                                  start_new_session=True) as proc:
                append(home, "call_start", n=n, role=role, cli=route["cli"],
                       model=route["model"], effort=effort, packet=str(packet_path),
                       launch_cwd=str(launch_cwd), pid=proc.pid)
                try:
                    proc.communicate(input=None if route["cli"] == "agy" else packet.encode(),
                                     timeout=route["timeout_s"])
                except (subprocess.TimeoutExpired, KeyboardInterrupt):
                    try:
                        os.killpg(proc.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    proc.wait()
                    raise
            rc = proc.returncode
        except subprocess.TimeoutExpired:
            rc, error = 124, "timeout"
        except OSError as exc:
            rc, error = 127, str(exc)
    wall = time.monotonic() - started
    raw = (call / "events.jsonl").read_text(encoding="utf-8", errors="replace")
    meta = dict(ids={}, cost=None, observed_model=None, usage=None)
    try:
        final, completed, meta = parse_output(route["cli"], raw)
        if final is not None:
            (call / "final.md").write_text(final, encoding="utf-8")
    except (ValueError, KeyError, TypeError, AttributeError) as exc:
        completed = False
        error = error or f"invalid CLI output: {exc}"
    (call / "final.md").touch(exist_ok=True)
    finished = rc == 0 and completed
    copied = not (call / "result.md").exists() and finished and bool((call / "final.md").read_text().strip())
    if copied:
        shutil.copyfile(call / "final.md", call / "result.md")
    result = call / "result.md"
    status, headline = status_line(result.read_text(encoding="utf-8", errors="replace") if result.exists() else "")
    if not finished:
        status, headline = "failed", f"failed: {error or 'CLI did not complete'} (rc {rc})"
    result_note = ""
    if not result.exists():
        result_note = "\nresult-absent: " + ("CLI did not finish successfully" if not finished else "final.md is empty")
    after = worktree_mark(cwd, home) if read_only else None
    if read_only and before != after:
        status, headline = "rejected", "rejected worktree-changed"
    meta.update(requested_model=route["model"], requested_effort=effort, cli=route["cli"],
                resume=args.resume, wall_seconds=wall,
                cwd=str(launch_cwd if getattr(args, "call_cwd", False) else cwd), read_only=read_only,
                launch_cwd=str(launch_cwd), product_cwd=str(cwd),
                head_before=head_before, head=head_sha(cwd),
                rc=rc, status=status, argv=argv)
    if read_only:
        meta.update(fingerprint_before=before, fingerprint_after=after)
    if error:
        meta["error"] = error
    (call / "meta.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    (call / "rc").write_text(f"{rc}\n", encoding="utf-8")
    (call / "status.txt").write_text(headline + ("\nresult-from-final" if copied else result_note) + "\n", encoding="utf-8")
    row = append(home, "call", n=n, role=role, cli=route["cli"], model=route["model"], effort=effort,
           rc=rc, status=status, headline=headline, result=str(result) if result.exists() else None,
           ids=meta["ids"], cost=meta["cost"], wall=wall, resume=args.resume, runner=runner)
    if not emit:
        return dict(row, folder=call, meta=meta)
    print(f"{headline}\n{call}")
    return 1 if status in ("failed", "rejected", "unparsed") else 0


def main(argv=None):
    parser = argparse.ArgumentParser(description="Kiln-Lite: runners, foreground workers and durable receipts")
    sub = parser.add_subparsers(dest="command", required=True)
    begin = sub.add_parser("start", help="create a run and isolated Git worktree")
    begin.add_argument("slug")
    begin.add_argument("--brief", required=True)
    begin.add_argument("--lane", choices=list(routing()), default="balanced")
    begin.add_argument("--project", default=".")
    call = sub.add_parser("call", help="call a routed worker, fresh or resumed")
    call.add_argument("role")
    call.add_argument("packet", help="path to the packet file (a .md file; not the text)")
    for flag in ("resume", "cwd", "model", "effort"):
        call.add_argument(f"--{flag}")
    call.add_argument("--read-only", action="store_true")
    for cmd in (call, sub.add_parser("status", help="print generated run.md"),
                sub.add_parser("follow", help="print one ledger headline per row")):
        cmd.add_argument("--run", help="run home; also KILN_LITE_RUN or auto-detected from cwd")
    sub.choices["status"].add_argument("--json", action="store_true")
    from lib.commands import add_parsers, execute
    add_parsers(sub)
    args = parser.parse_args(argv)
    try:
        if args.command == "start":
            return start(args)
        if args.command == "call":
            return call_worker(args)
        if args.command not in ("status", "follow"):
            return execute(args)
        home = find_home(args.run)
        if args.command == "status":
            rows = records(home)
            print(json.dumps(rows, indent=2) if args.json else render(rows), end="\n" if args.json else "")
        else:
            print("Lore Keepah: " + records(home)[0]["slug"])
            for row in records(home):
                values = (row.get("time"), "call-start" if row["kind"] == "call_start" else row["kind"], row.get("role", ""), row.get("model", ""),
                          row.get("trigger") or "" if row["kind"] == "compact" else row.get("status", ""),
                          row.get("text") if row["kind"] == "note" else row.get("result", row.get("worktree", "")))
                print(" ".join(str(v).replace("\n", " ") for v in values))
        return 0
    except (OSError, ValueError, KeyError, IndexError) as exc:
        print("kl: " + " ".join(str(exc).splitlines()), file=sys.stderr)
        return 1
