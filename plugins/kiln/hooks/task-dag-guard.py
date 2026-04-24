#!/usr/bin/env python3
"""TaskCreated / TaskCompleted guard for Kiln agent-team task flow.

The hook input does not expose the full task DAG, so this script enforces
the invariants that are visible at task-create/task-complete time and makes
the remaining requirements explicit in task metadata.
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path


VALID_ROLES = {
    "boss",
    "builder",
    "reviewer",
    "qa",
    "pm",
    "archivist",
    "validator",
    "engine",
}


def find_root(cwd: str) -> Path | None:
    cur = Path(cwd).resolve()
    while cur != cur.parent:
        if (cur / ".kiln" / "STATE.md").exists():
            return cur
        cur = cur.parent
    return None


def active_stage(root: Path) -> str | None:
    try:
        text = (root / ".kiln" / "STATE.md").read_text(encoding="utf-8")
    except OSError:
        return None
    match = re.search(r"\*\*stage\*\*:\s*(\S+)", text)
    if not match:
        return None
    stage = match.group(1)
    return stage if stage != "complete" else None


def block(message: str) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(2)


def metadata(text: str, key: str) -> str | None:
    match = re.search(rf"(?im)^\s*{re.escape(key)}\s*:\s*(.+?)\s*$", text)
    return match.group(1).strip() if match else None


def has_milestone(text: str) -> bool:
    return bool(re.search(r"(?i)\bmilestone(?:[_ -]?id)?\s*[:=#-]\s*[\w.-]+|\bmilestone[-_ ]?\d+\b", text))


def has_chunk(text: str) -> bool:
    return bool(re.search(r"(?i)\bchunk(?:[_ -]?id)?\s*[:=#-]\s*[\w.-]+|\bchunk[-_ ]?\d+\b", text))


def has_role(text: str) -> bool:
    role = metadata(text, "role")
    if role and role.lower() in VALID_ROLES:
        return True
    return any(re.search(rf"(?i)\b{role_name}\b", text) for role_name in VALID_ROLES)


def critical_kind(text: str) -> str | None:
    lowered = text.lower()
    if "cycle_workers" in lowered or "cycle workers" in lowered or "worker-cycle" in lowered:
        return "worker_cycle"
    if "build_complete" in lowered or "build complete" in lowered:
        return "build_complete"
    if "milestone qa" in lowered or "qa tribunal" in lowered:
        return "milestone_qa"
    if "review" in lowered or "verdict" in lowered:
        return "review"
    if "implement" in lowered or "builder" in lowered or "chunk" in lowered:
        return "implementation"
    return None


def validate_created(payload: dict, root: Path) -> None:
    subject = payload.get("task_subject") or ""
    description = payload.get("task_description") or ""
    text = f"{subject}\n{description}"
    kind = critical_kind(text)
    if not kind:
        return

    if not has_milestone(text):
        block("Kiln task blocked: critical tasks must include milestone_id or milestone-N.")
    if kind in {"implementation", "review", "worker_cycle"} and not has_chunk(text):
        block("Kiln task blocked: implementation/review/worker-cycle tasks must include chunk_id or chunk-N.")
    if not has_role(text):
        block("Kiln task blocked: critical tasks must include role: boss|builder|reviewer|qa|pm|archivist|validator|engine.")

    if kind == "worker_cycle":
        if not re.search(r"(?i)\bduo_id\s*:", text):
            block("Kiln task blocked: worker-cycle tasks must include duo_id.")
        lock = root / ".kiln" / "tmp" / "active-worker-cycle-task"
        task_id = str(payload.get("task_id") or "unknown")
        if lock.exists() and lock.read_text(encoding="utf-8").strip() not in {"", task_id}:
            block("Kiln task blocked: another worker-cycle task is already active.")
        lock.parent.mkdir(parents=True, exist_ok=True)
        lock.write_text(task_id + "\n", encoding="utf-8")


def path_exists(root: Path, value: str | None) -> bool:
    if not value:
        return False
    p = Path(value)
    if not p.is_absolute():
        p = root / p
    return p.exists()


def validate_completed(payload: dict, root: Path) -> None:
    subject = payload.get("task_subject") or ""
    description = payload.get("task_description") or ""
    text = f"{subject}\n{description}"
    kind = critical_kind(text)
    if not kind:
        return

    if kind == "implementation":
        if not metadata(text, "review_task") and not metadata(text, "review_task_id"):
            block("Kiln task blocked: implementation completion must link review_task or review_task_id.")
        if not metadata(text, "tdd_evidence"):
            block("Kiln task blocked: implementation completion must include tdd_evidence path or explicit no-test waiver artifact.")

    if kind == "review":
        verdict = metadata(text, "verdict_path")
        if not path_exists(root, verdict):
            block("Kiln task blocked: review completion must include an existing verdict_path.")

    if kind == "milestone_qa":
        if (metadata(text, "all_chunk_tasks_resolved") or "").lower() not in {"yes", "true", "pass"}:
            block("Kiln task blocked: milestone QA completion requires all_chunk_tasks_resolved: yes.")
        if not path_exists(root, metadata(text, "qa_verdict_path")):
            block("Kiln task blocked: milestone QA completion must include an existing qa_verdict_path.")

    if kind == "build_complete":
        if (metadata(text, "open_blocking_tasks") or "").strip() != "0":
            block("Kiln task blocked: BUILD_COMPLETE cannot close with open_blocking_tasks other than 0.")
        if (metadata(text, "final_archive_check") or "").lower() not in {"pass", "passed", "yes"}:
            block("Kiln task blocked: BUILD_COMPLETE requires final_archive_check: pass.")

    if kind == "worker_cycle":
        lock = root / ".kiln" / "tmp" / "active-worker-cycle-task"
        task_id = str(payload.get("task_id") or "")
        if lock.exists() and (not task_id or lock.read_text(encoding="utf-8").strip() == task_id):
            lock.unlink()


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError:
        return 0

    root = find_root(payload.get("cwd") or os.getcwd()) or find_root(os.getcwd())
    if not root or not active_stage(root):
        return 0

    event = payload.get("hook_event_name")
    if event == "TaskCreated":
        validate_created(payload, root)
    elif event == "TaskCompleted":
        validate_completed(payload, root)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
