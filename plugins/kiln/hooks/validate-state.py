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
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from xml.etree import ElementTree


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
    "builder_reported_commands:",
    "builder_reported_results:",
    "reviewer_reran_commands:",
    "reviewer_rerun_results:",
    "independent_verification_status:",
    "limitations:",
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


PLACEHOLDER_PREFIXES = (
    "n/a",
    "na",
    "none",
    "null",
    "unknown",
    "not applicable",
    "not run",
    "pending",
    "tbd",
)

SUBSTANTIVE_LIMITATION_DENYLIST = {
    "",
    "-",
    "n/a",
    "na",
    "none",
    "null",
    "unknown",
    "not applicable",
    "tbd",
}

UNVERIFIED_EXPLANATION_TERMS = (
    "did not establish",
    "does not establish",
    "didn't establish",
    "not establish",
    "not verified",
    "could not verify",
    "unable to verify",
    "cannot verify",
    "failed",
    "failure",
    "blocked",
    "unavailable",
    "missing",
    "skipped",
    "inconclusive",
    "partial",
    "degraded",
    "timed out",
    "error",
)


def is_placeholder(value: str | None) -> bool:
    if value is None:
        return True
    cleaned = value.strip().strip("`'\"{}[]").lower()
    if not cleaned:
        return True
    if cleaned in {"-", "--"}:
        return True
    return any(cleaned == p or cleaned.startswith(f"{p} ") or cleaned.startswith(f"{p} -") for p in PLACEHOLDER_PREFIXES)


def is_substantive(value: str | None, min_len: int = 20) -> bool:
    if is_placeholder(value):
        return False
    text = value.strip()
    words = re.findall(r"[A-Za-z]{3,}", text)
    return len(text) >= min_len and len(words) >= 3


def is_substantive_limitation(value: str | None) -> bool:
    if value is None:
        return False
    text = value.strip()
    cleaned = re.sub(r"\s+", " ", text.strip("`'\"")).lower()
    if cleaned in SUBSTANTIVE_LIMITATION_DENYLIST:
        return False
    words = re.findall(r"[A-Za-z]+", text)
    return len(text) >= 20 and len(words) >= 3


def explains_unverified_review(rerun_results: str | None, limitations: str | None) -> bool:
    text = f"{rerun_results or ''}\n{limitations or ''}".lower()
    return any(term in text for term in UNVERIFIED_EXPLANATION_TERMS)


def current_git_head(root: Path) -> str | None:
    try:
        proc = subprocess.run(
            ["git", "-C", str(root), "rev-parse", "HEAD"],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
        )
    except OSError:
        return None
    if proc.returncode != 0:
        return None
    head = proc.stdout.strip()
    return head or None


def check_current_head(path: Path, root: Path | None, recorded: str | None, label: str) -> list[Finding]:
    if root is None:
        return []
    if is_placeholder(recorded):
        return [Finding(path, f"{label} missing substantive `head_sha`")]
    head = current_git_head(root)
    if head is None:
        return [Finding(path, f"{label} cannot verify current git HEAD")]
    if recorded != head:
        return [Finding(path, f"{label} head_sha `{recorded}` does not match current HEAD `{head}`")]
    return []


def split_paths(value: str | None) -> list[str]:
    if is_placeholder(value):
        return []
    parts = re.split(r"[,\n]+", value or "")
    out: list[str] = []
    for part in parts:
        cleaned = part.strip().strip("-* `\"'")
        if cleaned:
            out.append(cleaned)
    return out


def path_exists_under_root(root: Path | None, value: str) -> bool:
    if root is None:
        return True
    path = Path(value)
    if not path.is_absolute():
        path = root / path
    return path.exists()


def xml_text(root: ElementTree.Element, tag: str) -> str | None:
    found = root.find(f".//{tag}")
    if found is None or found.text is None:
        return None
    return found.text.strip()


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


def validate_codebase_state(path: Path, root: Path | None = None) -> list[Finding]:
    text = read_text(path)
    out: list[Finding] = []
    first = text.splitlines()[0] if text.splitlines() else ""
    if first != "<!-- status: complete -->":
        out.append(Finding(path, "codebase-state.md line 1 must be `<!-- status: complete -->`"))
    lowered = text.lower()
    for marker in sorted(CODEBASE_REQUIRED):
        if marker.lower() not in lowered:
            out.append(Finding(path, f"codebase-state.md missing required schema marker `{marker}`"))
    out.extend(check_current_head(path, root, field_value(text, "head_sha"), "codebase-state.md"))
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
    waiver = fields.get("no_test_waiver_reason")
    if testable == "no" and not is_substantive(waiver):
        out.append(Finding(
            path,
            "non-testable chunks require a substantive `no_test_waiver_reason`; placeholders like N/A do not count",
        ))
    if testable == "yes":
        if waiver and not is_placeholder(waiver):
            out.append(Finding(path, "testable chunks must not use `no_test_waiver_reason` as a bypass"))
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


def validate_fresh_living_doc(path: Path, label: str) -> list[Finding]:
    text = read_text(path)
    out: list[Finding] = []
    first = text.splitlines()[0] if text.splitlines() else ""
    if first != "<!-- status: complete -->":
        out.append(Finding(path, f"{label} line 1 must be `<!-- status: complete -->`"))
    if is_placeholder(field_value(text, "head_sha")):
        out.append(Finding(path, f"{label} missing required freshness field `head_sha`"))
    if is_placeholder(field_value(text, "last_updated")) and is_placeholder(field_value(text, "timestamp")):
        out.append(Finding(path, f"{label} missing required freshness field `last_updated` or `timestamp`"))
    return out


def validate_assignment(path: Path, root: Path | None = None) -> list[Finding]:
    text = read_text(path)
    out: list[Finding] = []
    try:
        xml_root = ElementTree.fromstring(text)
    except ElementTree.ParseError as exc:
        return [Finding(path, f"assignment XML is not well-formed: {exc}")]

    required_tags = (
        "assignment_id",
        "milestone_id",
        "chunk",
        "head_sha",
        "dirty_status",
        "codebase_state_head_sha",
        "timestamp",
        "source_artifacts",
    )
    values = {tag: xml_text(xml_root, tag) for tag in required_tags}
    for tag, value in values.items():
        if is_placeholder(value):
            out.append(Finding(path, f"assignment XML missing substantive `<{tag}>`"))

    head_sha = values.get("head_sha")
    codebase_head = values.get("codebase_state_head_sha")
    if not is_placeholder(head_sha) and not is_placeholder(codebase_head) and head_sha != codebase_head:
        out.append(Finding(
            path,
            f"assignment XML scoped from stale codebase-state: codebase_state_head_sha `{codebase_head}` != head_sha `{head_sha}`",
        ))

    source_paths = split_paths(values.get("source_artifacts"))
    if not source_paths:
        out.append(Finding(path, "assignment XML `<source_artifacts>` must list scoped source evidence paths"))
    return out


def validate_chunk_summary(path: Path) -> list[Finding]:
    text = read_text(path)
    out: list[Finding] = []
    for field in ("milestone_id", "chunk_id", "head_sha"):
        if is_placeholder(field_value(text, field)):
            out.append(Finding(path, f"chunk summary missing required field `{field}`"))
    return out


def validate_milestone_summary(path: Path) -> list[Finding]:
    text = read_text(path)
    out: list[Finding] = []
    for field in ("milestone_id", "head_sha"):
        if is_placeholder(field_value(text, field)):
            out.append(Finding(path, f"milestone summary missing required field `{field}`"))
    if is_placeholder(field_value(text, "timestamp")) and is_placeholder(field_value(text, "last_updated")):
        out.append(Finding(path, "milestone summary missing required field `timestamp` or `last_updated`"))
    return out


def validate_final_archive_readiness(path: Path, root: Path | None = None) -> list[Finding]:
    text = read_text(path)
    out: list[Finding] = []
    ready = (field_value(text, "archive_ready") or "").strip().lower()
    if ready not in {"true", "yes", "pass", "passed"}:
        out.append(Finding(path, "final archive readiness requires `archive_ready: true`"))
    if is_placeholder(field_value(text, "run_id")) and is_placeholder(field_value(text, "build_id")):
        out.append(Finding(path, "final archive readiness missing `run_id` or `build_id`"))
    if is_placeholder(field_value(text, "milestone_id")) and is_placeholder(field_value(text, "final_build_scope")):
        out.append(Finding(path, "final archive readiness missing `milestone_id` or `final_build_scope`"))
    if is_placeholder(field_value(text, "timestamp")) and is_placeholder(field_value(text, "sequence")):
        out.append(Finding(path, "final archive readiness missing `timestamp` or `sequence`"))
    head_sha = field_value(text, "head_sha")
    out.extend(check_current_head(path, root, head_sha, "final archive readiness"))

    sources = split_paths(field_value(text, "source_archive_paths_checked"))
    if not sources:
        out.append(Finding(path, "final archive readiness missing `source_archive_paths_checked`"))
    for source in sources:
        if not path_exists_under_root(root, source):
            out.append(Finding(path, f"final archive readiness source path does not exist: `{source}`"))
    return out


def parse_command_list(value: str | None) -> tuple[list[str] | None, str | None]:
    if value is None:
        return None, "missing"
    raw = value.strip()
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return None, "not a JSON list"
    if not isinstance(parsed, list):
        return None, "not a JSON list"
    commands: list[str] = []
    for item in parsed:
        if not isinstance(item, str):
            return None, "list entries must be strings"
        command = item.strip()
        if is_placeholder(command):
            return None, "list contains placeholder command"
        if command:
            commands.append(command)
    return commands, None


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

    commands, command_error = parse_command_list(field_value(text, "reviewer_reran_commands"))
    if command_error:
        out.append(Finding(path, f"`reviewer_reran_commands` must be a JSON list: {command_error}"))
        commands = []

    rerun_results = field_value(text, "reviewer_rerun_results")
    status = (field_value(text, "independent_verification_status") or "").strip().lower()
    limitations = field_value(text, "limitations")
    verdict = (field_value(text, "verdict") or "").strip().lower()
    test_requirements = field_value(text, "test_requirements")
    tdd_path = field_value(text, "tdd_evidence_path")
    full_pass = verdict.startswith("approved") or verdict in {"pass", "clean_pass", "full_pass"}
    testable_work = not is_placeholder(test_requirements) and (test_requirements or "").strip().lower() != "none"
    testable_work = testable_work or not is_placeholder(tdd_path)

    if status not in {"verified", "partial", "not_verified"}:
        out.append(Finding(path, "`independent_verification_status` must be verified, partial, or not_verified"))

    if status in {"partial", "not_verified"} and not is_substantive_limitation(limitations):
        out.append(Finding(
            path,
            "partial/not_verified review requires substantive limitations explaining what remains unverified or degraded",
        ))

    if status == "verified":
        if not commands:
            out.append(Finding(path, "verified review requires at least one independent rerun command"))
        if not is_substantive(rerun_results, min_len=8):
            out.append(Finding(path, "verified review requires substantive `reviewer_rerun_results`"))
    elif not commands:
        result_text = (rerun_results or "").lower()
        acknowledged_no_rerun = (
            "not independently rerun" in result_text
            or "not rerun" in result_text
            or "unable to rerun" in result_text
        )
        if not acknowledged_no_rerun or not is_substantive(limitations):
            out.append(Finding(
                path,
                "review with no rerun commands must explicitly say not independently rerun and include a substantive limitation",
            ))
    elif is_placeholder(rerun_results):
        out.append(Finding(path, "`reviewer_rerun_results` cannot be a placeholder when rerun commands are listed"))
    elif status == "not_verified" and commands and not explains_unverified_review(rerun_results, limitations):
        out.append(Finding(
            path,
            "not_verified review with rerun commands must explain why the commands did not establish verification",
        ))

    exception = field_value(text, "repo_approved_exception")
    if full_pass and status in {"partial", "not_verified"}:
        out.append(Finding(
            path,
            "full approval cannot be partial or not_verified; full approval for testable work requires independent_verification_status: verified",
        ))
    elif full_pass and testable_work and status != "verified" and not is_substantive(exception):
        out.append(Finding(path, "full approval for testable work requires independent_verification_status: verified"))
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
    s = path.as_posix()
    if name == "STATE.md":
        return "state"
    if name == "codebase-state.md":
        return "codebase"
    if name == "patterns.md":
        return "patterns"
    if name == "pitfalls.md":
        return "pitfalls"
    if name == "tdd-evidence.md":
        return "tdd"
    if name == "assignment.xml" or name.endswith("-assignment.xml"):
        return "assignment"
    if name == "final-archive-readiness.md":
        return "final_archive_readiness"
    if re.search(r"chunk-[^/]+-summary\.md$", name) or re.search(r"/chunk-[^/]+/[^/]*summary\.md$", s):
        return "chunk_summary"
    if re.search(r"milestone-[^/]+(?:-summary)?\.md$", name):
        return "milestone_summary"
    if name == "AGENTS.md":
        return "agents"
    if name.endswith("review.md") or "/review" in s:
        return "review"
    if name in {"report.md", "design-review.md"} or "/validation/" in s:
        return "browser"
    return None


def validate_path(path: Path, root: Path | None = None) -> list[Finding]:
    if not path.exists() or not path.is_file():
        return []
    kind = classify(path)
    if kind == "state":
        return validate_state(path)
    if kind == "codebase":
        return validate_codebase_state(path, root)
    if kind == "patterns":
        return validate_fresh_living_doc(path, "patterns.md")
    if kind == "pitfalls":
        return validate_fresh_living_doc(path, "pitfalls.md")
    if kind == "tdd":
        return validate_tdd_evidence(path)
    if kind == "assignment":
        return validate_assignment(path, root)
    if kind == "chunk_summary":
        return validate_chunk_summary(path)
    if kind == "milestone_summary":
        return validate_milestone_summary(path)
    if kind == "final_archive_readiness":
        return validate_final_archive_readiness(path, root)
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
        root / ".kiln" / "docs" / "patterns.md",
        root / ".kiln" / "docs" / "pitfalls.md",
        root / ".kiln" / "archive" / "step-5-build" / "final-archive-readiness.md",
    ]
    out.extend(root.glob(".kiln/tmp/chunk-*-assignment.xml"))
    out.extend(root.glob(".kiln/archive/milestone-*/chunk-*/assignment.xml"))
    out.extend(root.glob(".kiln/archive/step-5-build/chunk-*/assignment.xml"))
    out.extend(root.glob(".kiln/archive/milestone-*/chunk-*/tdd-evidence.md"))
    out.extend(root.glob(".kiln/archive/step-5-build/chunk-*/tdd-evidence.md"))
    out.extend(root.glob(".kiln/archive/milestone-*/chunk-*/*summary.md"))
    out.extend(root.glob(".kiln/archive/step-5-build/chunk-*/*summary.md"))
    out.extend(root.glob(".kiln/archive/step-5-build/chunk-*/*review.md"))
    out.extend(root.glob(".kiln/archive/milestone-*/chunk-*/*review.md"))
    out.extend(root.glob(".kiln/archive/step-5-build/milestone-*-summary.md"))
    out.extend(root.glob(".kiln/docs/milestones/milestone-*.md"))
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
                findings.extend(validate_path(path, root))
        elif args.path:
            target = (root / args.path).resolve() if not Path(args.path).is_absolute() else Path(args.path)
            findings = validate_path(target, root)
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
    findings = validate_path(path, root)
    return emit_hook_decision(payload.get("hook_event_name") or "", findings)


if __name__ == "__main__":
    raise SystemExit(main())
