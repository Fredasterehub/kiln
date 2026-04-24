#!/usr/bin/env python3
"""skills.py — skill-body lint for plugin-shipped skills.

Added in v1.5.1 skill-alignment pass. Two deterministic checks designed to
catch the specific regressions the rewrites could introduce:

  1. No `opus-4.6` string in any plugin-shipped skill file. v1.5.0 retired
     the `opus-4.6` pin across the plugin; a rewrite that reintroduces it
     (e.g. by copy-paste from git history) is a regression.

  2. kiln-protocol/SKILL.md contains every canonical Kiln signal name. This
     file is the master signal vocabulary preloaded into every pipeline
     agent. A rewrite that drops a signal breaks downstream agents that
     reference it.

This lint intentionally does not attempt ALL-CAPS heuristic warnings — the
creatah-reviewer cross-family review catches stylistic issues more reliably
than a regex can.

Exit code: 0 clean, 1 violations.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import _common as c  # noqa: E402


# Canonical signals that MUST appear in kiln-protocol/SKILL.md after any
# rewrite. Derived from the three signal tables in kiln-protocol/SKILL.md
# as of v1.5.0. A rewrite that drops any of these breaks downstream agents.
CANONICAL_PROTOCOL_SIGNALS = {
    # Engine / boss / PM signals
    "READY_BOOTSTRAP",
    "READY",
    "REQUEST_WORKERS",
    "REQUEST_WORKERS_READY",
    "CYCLE_WORKERS",
    "WORKERS_SPAWNED",
    "WORKERS_REJECTED",
    "ITERATION_UPDATE",
    "MILESTONE_TRANSITION",
    "MILESTONE_DONE",
    "FINAL_ARCHIVE_CHECK",
    "ARCHIVE_READY",
    "ARCHIVE_BLOCKED",
    "MILESTONE_COMPLETE",
    "BUILD_COMPLETE",
    "ONBOARDING_COMPLETE",
    "BRAINSTORM_COMPLETE",
    "RESEARCH_COMPLETE",
    "ARCHITECTURE_COMPLETE",
    "VALIDATE_PASS",
    "VALIDATE_FAILED",
    "REPORT_COMPLETE",
    "BLOCKED",
    # QA tribunal signals
    "QA_REPORT_READY",
    "RECONCILIATION_COMPLETE",
    "QA_PASS",
    "QA_FAIL",
    # Worker peer-to-peer signals
    "REVIEW_REQUEST",
    "APPROVED",
    "REJECTED",
    "IMPLEMENTATION_APPROVED",
    "IMPLEMENTATION_BLOCKED",
    "IMPLEMENTATION_REJECTED",
    # Archival signal
    "ARCHIVE",
}


def plugin_skill_files() -> list[Path]:
    """Every plugin-shipped skill and reference file."""
    out: list[Path] = []
    out.append(c.protocol_skill())
    out.append(c.engine_skill())
    for p in c.references_dir().rglob("*.md"):
        out.append(p)
    return sorted(out)


def check_no_opus_46(files: list[Path]) -> list[c.Violation]:
    """Hard-fail: `opus-4.6` string must not appear in plugin skill files.

    The v1.5.0 agent pass retired the `opus-4.6` model pin; the v1.5.1 skill
    pass must not reintroduce it in prose, YAML, or example blocks. The
    calibration reference at references/opus-47-calibration.md is the only
    file allowed to mention `opus-4.6` (as historical contrast against 4.7);
    we exempt it by name.
    """
    out: list[c.Violation] = []
    allowed = {c.references_dir() / "opus-47-calibration.md"}
    for path in files:
        if path in allowed:
            continue
        text = c.read_text(path)
        for i, line in enumerate(text.splitlines(), start=1):
            if "opus-4.6" in line:
                out.append(c.Violation(
                    code="OPUS46_STRING",
                    message=f"'{path.name}' line {i} contains `opus-4.6`; v1.5.0 retired this pin",
                    location=f"{path.relative_to(c.repo_root())}:{i}",
                ))
    return out


def check_canonical_signals_in_protocol() -> list[c.Violation]:
    """Every canonical Kiln signal must appear in kiln-protocol/SKILL.md.

    This guards against the M2 rewrite accidentally dropping a signal row.
    Downstream agents reference the protocol file on spawn; a missing
    signal name means either the row is gone or the name has drifted.
    """
    out: list[c.Violation] = []
    path = c.protocol_skill()
    if not path.exists():
        out.append(c.Violation(
            code="PROTOCOL_MISSING",
            message=f"{path} does not exist",
            location=str(path.relative_to(c.repo_root())),
        ))
        return out
    text = c.read_text(path)
    for signal in sorted(CANONICAL_PROTOCOL_SIGNALS):
        if signal not in text:
            out.append(c.Violation(
                code="SIGNAL_DROPPED",
                message=(
                    f"canonical Kiln signal '{signal}' not found in kiln-protocol/SKILL.md — "
                    "either the signal table was truncated or the name drifted"
                ),
                location=str(path.relative_to(c.repo_root())),
            ))
    return out


ALL_CHECKS = [
    ("No opus-4.6 in plugin skill files",
     lambda files: check_no_opus_46(files)),
    ("Canonical signals present in kiln-protocol",
     lambda files: check_canonical_signals_in_protocol()),
]


def main() -> int:
    print("Validating skill bodies…")
    files = plugin_skill_files()
    print(f"  loaded {len(files)} skill/reference files")
    exit_code = 0
    for label, fn in ALL_CHECKS:
        print(f"[{label}]")
        violations = fn(files)
        exit_code |= c.print_violations(violations, label="issues")
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
