#!/usr/bin/env python3
"""Validate Kiln critical state and evidence artifacts.

Usable three ways:
  * PostToolUse / FileChanged hook: reads hook JSON from stdin.
  * Manual all-state check: validate-state.py --root /path/to/project --all.
  * Manual single file check: validate-state.py --root /path --path FILE.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path


VALID_STAGES = {
    "onboarding",
    "brainstorm",
    "research",
    "architecture",
    "build",
    "validate",
    "report",
    "complete",
}

STATE_FIELDS = {
    "skill",
    "roster",
    "stage",
    "team_iteration",
    "chunk_count",
    "milestone_count",
    "milestones_complete",
    "correction_cycle",
    "run_id",
    "path",
    "started",
    "updated",
}

TDD_FIELDS = {
    "testable",
    "assignment_id",
    "milestone_id",
    "chunk_id",
    "current_head_sha_before",
    "current_head_sha_after",
    "red_command",
    "red_result_summary",
    "green_command",
    "green_result_summary",
    "refactor_command",
    "refactor_result_summary",
    "test_files_added_or_changed",
    "production_files_changed",
    "reviewer_reran_commands",
    "reviewer_rerun_results",
    "limitations",
}

CODEBASE_REQUIRED = {
    "## TL;DR",
    "head_sha:",
    "last_update_summary:",
    "changed_files:",
    "known_constraints:",
    "open_risks:",
    "next_boss_consult_notes:",
}

REVIEW_REQUIRED = {
    "verdict:",
    "observed_head_sha:",
    "builder_reported_evidence:",
    "reviewer_reran_commands:",
    "reviewer_rerun_results:",
    "not_verified_or_limitations:",
}

AGENTS_REQUIRED = {
    "## Commands",
    "## Architecture TL;DR",
    "## Conventions",
    "## Key Files",
}


@dataclass
class Finding:
    path: Path
    message: str


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def find_root(cwd: str) -> Path | None:
    cur = Path(cwd).resolve()
    while cur != cur.parent:
        if (cur / ".kiln").exists():
            return cur
        cur = cur.parent
    return None


def field_value(text: str, name: str) -> str | None:
    patterns = [
        rf"(?im)^\s*-\s*\*\*{re.escape(name)}\*\*\s*:\s*(.+?)\s*$",
        rf"(?im)^\s*{re.escape(name)}\s*:\s*(.+?)\s*$",
    ]
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            return match.group(1).strip()
    return None


def validate_state(path: Path) -> list[Finding]:
    text = read_text(path)
    out: list[Finding] = []
    for field in sorted(STATE_FIELDS):
        if field_value(text, field) is None:
            out.append(Finding(path, f"STATE.md missing required field `{field}`"))
    stage = field_value(text, "stage")
    if stage and stage not in VALID_STAGES:
        out.append(Finding(path, f"STATE.md has invalid stage `{stage}`"))
    return out


def validate_codebase_state(path: Path) -> list[Finding]:
    text = read_text(path)
    out: list[Finding] = []
    first = text.splitlines()[0] if text.splitlines() else ""
    if first != "<!-- status: complete -->":
        out.append(Finding(path, "codebase-state.md line 1 must be `<!-- status: complete -->`"))
    lowered = text.lower()
    for marker in sorted(CODEBASE_REQUIRED):
        if marker.lower() not in lowered:
            out.append(Finding(path, f"codebase-state.md missing required schema marker `{marker}`"))
    return out


def validate_tdd_evidence(path: Path) -> list[Finding]:
    text = read_text(path)
    out: list[Finding] = []
    fields = {name: field_value(text, name) for name in sorted(TDD_FIELDS | {"no_test_waiver_reason"})}
    testable = (fields.get("testable") or "").lower()
    for field in sorted(TDD_FIELDS):
        if not fields.get(field):
            out.append(Finding(path, f"tdd evidence missing `{field}`"))
    if testable not in {"yes", "no"}:
        out.append(Finding(path, "tdd evidence `testable` must be yes or no"))
    if testable == "no" and not fields.get("no_test_waiver_reason"):
        out.append(Finding(path, "non-testable chunks require `no_test_waiver_reason`"))
    if testable == "yes":
        for field in (
            "red_command",
            "red_result_summary",
            "green_command",
            "green_result_summary",
            "refactor_command",
            "refactor_result_summary",
        ):
            if not fields.get(field):
                out.append(Finding(path, f"testable chunk requires `{field}`"))
    return out


def validate_review(path: Path) -> list[Finding]:
    text = read_text(path)
    lowered = text.lower()
    out: list[Finding] = []
    for marker in sorted(REVIEW_REQUIRED):
        if marker not in lowered:
            out.append(Finding(path, f"review verdict missing `{marker}`"))
    if "test_requirements:" in lowered and "test_requirements: none" not in lowered:
        if "tdd_evidence_path:" not in lowered:
            out.append(Finding(path, "testable review verdict requires `tdd_evidence_path:`"))
    if "approved" in lowered and "reviewer_rerun_results:" in lowered:
        rerun = field_value(text, "reviewer_rerun_results") or ""
        limitation = field_value(text, "not_verified_or_limitations") or ""
        if not rerun.strip() and not limitation.strip():
            out.append(Finding(path, "approved verdict must show reviewer rerun results or explicit limitation"))
    return out


def validate_agents(path: Path) -> list[Finding]:
    text = read_text(path)
    out: list[Finding] = []
    generated = text.lstrip().startswith("# AGENTS.md") or "Codex auto-discovery" in text
    if not generated:
        return out
    size = len(text.encode("utf-8", errors="replace"))
    if size > 16384:
        out.append(Finding(path, f"AGENTS.md is {size} bytes; Kiln codebase mind limit is 16384"))
    lowered = text.lower()
    for marker in sorted(AGENTS_REQUIRED):
        if marker.lower() not in lowered:
            out.append(Finding(path, f"Kiln-generated AGENTS.md missing required section `{marker}`"))
    return out


def validate_browser_verdict(path: Path) -> list[Finding]:
    text = read_text(path)
    lowered = text.lower()
    out: list[Finding] = []
    full_pass = bool(re.search(r"(?im)^\s*(verdict|status)\s*:\s*(pass|approved)\b", text))
    browser_missing = any(
        phrase in lowered
        for phrase in (
            "playwright mcp unavailable",
            "browser automation skipped",
            "static checks only",
            "static analysis only",
        )
    )
    browser_scope = any(word in lowered for word in ("browser", "web app", "ui acceptance", "visual validation"))
    if full_pass and browser_missing and browser_scope:
        out.append(Finding(path, "browser/UI verdict cannot be full PASS/APPROVED when browser validation is missing"))
    return out


def classify(path: Path) -> str | None:
    name = path.name
    s = str(path)
    if name == "STATE.md":
        return "state"
    if name == "codebase-state.md":
        return "codebase"
    if name == "tdd-evidence.md":
        return "tdd"
    if name == "AGENTS.md":
        return "agents"
    if name.endswith("review.md") or "/review" in s:
        return "review"
    if name in {"report.md", "design-review.md"} or "/validation/" in s:
        return "browser"
    return None


def validate_path(path: Path) -> list[Finding]:
    if not path.exists() or not path.is_file():
        return []
    kind = classify(path)
    if kind == "state":
        return validate_state(path)
    if kind == "codebase":
        return validate_codebase_state(path)
    if kind == "tdd":
        return validate_tdd_evidence(path)
    if kind == "agents":
        return validate_agents(path)
    if kind == "review":
        return validate_review(path) + validate_browser_verdict(path)
    if kind == "browser":
        return validate_browser_verdict(path)
    return []


def candidate_paths(root: Path) -> list[Path]:
    out = [
        root / ".kiln" / "STATE.md",
        root / ".kiln" / "docs" / "codebase-state.md",
    ]
    out.extend(root.glob(".kiln/archive/milestone-*/chunk-*/tdd-evidence.md"))
    out.extend(root.glob(".kiln/archive/step-5-build/chunk-*/tdd-evidence.md"))
    out.extend(root.glob(".kiln/archive/step-5-build/chunk-*/*review.md"))
    out.extend(root.glob(".kiln/validation/*.md"))
    out.append(root / "AGENTS.md")
    out.append(root / ".kiln" / "AGENTS.md")
    return sorted(dict.fromkeys(out))


def hook_path(payload: dict, root: Path) -> Path | None:
    raw = (
        payload.get("file_path")
        or payload.get("tool_input", {}).get("file_path")
        or payload.get("tool_response", {}).get("filePath")
    )
    if not raw:
        return None
    path = Path(raw)
    if not path.is_absolute():
        path = root / path
    return path


def emit_hook_decision(event: str, findings: list[Finding]) -> int:
    if not findings:
        return 0
    message = "\n".join(f"{f.path}: {f.message}" for f in findings)
    if event == "PostToolUse":
        print(json.dumps({"decision": "block", "reason": message}))
        return 0
    print(message, file=sys.stderr)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root")
    parser.add_argument("--path")
    parser.add_argument("--all", action="store_true")
    args = parser.parse_args()

    if args.root:
        root = Path(args.root).resolve()
        if args.all:
            findings: list[Finding] = []
            for path in candidate_paths(root):
                findings.extend(validate_path(path))
        elif args.path:
            findings = validate_path((root / args.path).resolve() if not Path(args.path).is_absolute() else Path(args.path))
        else:
            findings = []
        if findings:
            for finding in findings:
                print(f"{finding.path}: {finding.message}", file=sys.stderr)
            return 1
        return 0

    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError:
        return 0
    root = find_root(payload.get("cwd") or os.getcwd()) or find_root(os.getcwd())
    if not root:
        return 0
    path = hook_path(payload, root)
    if not path:
        return 0
    findings = validate_path(path)
    return emit_hook_decision(payload.get("hook_event_name") or "", findings)


if __name__ == "__main__":
    raise SystemExit(main())
