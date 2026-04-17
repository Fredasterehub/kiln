#!/usr/bin/env python3
"""orphans.py — dead code + vestigial reference detection.

Flags:
  - reference files with zero references from agent bodies / SKILLs
  - signals defined in protocol but never sent by any agent
  - "removed v..." tombstones in hook scripts (candidates for CHANGELOG)
  - snake_case tool aliases in hook matchers (never match real tools)
  - mentions of deleted agent roles (sphinx, clio) outside valid contexts

Exit code: 0 clean, 1 findings. Pass --warn-only to exit 0 on findings.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import _common as c  # noqa: E402


def _all_plugin_text() -> dict[Path, str]:
    """Return {path: full text} for every agent/md + hook script."""
    files: dict[Path, str] = {}
    for p in c.plugin_root().rglob("*.md"):
        files[p] = c.read_text(p)
    for p in c.plugin_root().rglob("*.sh"):
        files[p] = c.read_text(p)
    return files


def check_orphan_references() -> list[c.Violation]:
    """Reference files with 0 incoming links (outside their own filename)."""
    out: list[c.Violation] = []
    # Scan references dir recursively
    refs: list[Path] = list(c.references_dir().rglob("*.md"))
    # Exclude blueprints dir — those are entry points, not referenced by name
    # in the same way; they have their own registry in engine SKILL.md
    refs = [r for r in refs if "/blueprints/" not in str(r) and r.name != "README.md"]

    corpus = _all_plugin_text()
    # Also include engine SKILL.md, protocol SKILL.md (already in rglob)

    for ref in refs:
        # Count references to the basename from all files except the ref itself
        basename = ref.name
        ref_hits = 0
        for path, text in corpus.items():
            if path == ref:
                continue
            if basename in text:
                ref_hits += 1
        if ref_hits == 0:
            out.append(c.Violation(
                code="ORPHAN_REFERENCE",
                message=f"reference file '{basename}' has zero incoming references",
                location=str(ref.relative_to(c.repo_root())),
            ))
    return out


def check_vestigial_signals() -> list[c.Violation]:
    """Signals defined in vocabulary tables but never sent by any agent."""
    out: list[c.Violation] = []

    # Collect signals from vocab tables (protocol + team-protocol)
    defined: set[str] = set()
    for src in [c.protocol_skill(), c.team_protocol_ref()]:
        text = c.read_text(src)
        for m in re.finditer(
            r'\|\s*`([A-Z][A-Z0-9_]{3,})\b',
            text,
        ):
            defined.add(m.group(1))
        for m in re.finditer(
            r'^\s*-\s*`([A-Z][A-Z0-9_]{3,})[:` ]',
            text,
            re.MULTILINE,
        ):
            defined.add(m.group(1))

    # Find every signal actually sent by at least one agent or engine.
    # Heuristic: scan lines mentioning send-verbs or SendMessage and
    # collect ALL-CAPS tokens as "mentioned in a send context".
    sent: set[str] = set()
    agents = c.load_agents()
    send_line_re = re.compile(
        r'(SendMessage|\bSignal(?:s|ing)?\b|\bSend\s+|\bMessage\s+\S|\bmay\s+send\b|\bMAY\s+send\b)',
        re.IGNORECASE,
    )
    signal_token_re = re.compile(r'\b([A-Z][A-Z0-9_]{3,})\b')
    for agent in agents:
        for line in agent.body.split("\n"):
            if not send_line_re.search(line):
                continue
            for m in signal_token_re.finditer(line):
                tok = m.group(1)
                if tok not in c.STOPLIST:
                    sent.add(tok)

    # Engine SKILL.md also sends signals (WORKERS_SPAWNED, shutdown_request).
    # QA_VERDICT was retired in Wave 2 (judge-dredd signals krs-one direct).
    engine_text = c.read_text(c.engine_skill())
    for line in engine_text.split("\n"):
        if not send_line_re.search(line):
            continue
        for m in signal_token_re.finditer(line):
            tok = m.group(1)
            if tok not in c.STOPLIST:
                sent.add(tok)

    # A signal is vestigial if:
    #   - defined in vocab
    #   - not in STOPLIST
    #   - no sender
    for sig in sorted(defined - sent):
        if sig in c.STOPLIST:
            continue
        # Skip ones explicitly labeled "Engine" as sender in a vocab table —
        # they may be engine outputs without a formal "SendMessage" call we'd
        # detect
        # We still flag them so the operator can confirm they're truly used.
        out.append(c.Violation(
            code="VESTIGIAL_SIGNAL",
            message=f"signal {sig} defined in vocab but no agent or engine sends it",
        ))

    return out


TOMBSTONE_RE = re.compile(
    r'^\s*#\s*\([Hh]ook.+removed\s+v\d+\.\d+',
    re.MULTILINE,
)


def check_tombstones() -> list[c.Violation]:
    """`removed v...` tombstone comments in hook scripts."""
    out: list[c.Violation] = []
    for p in c.scripts_dir().rglob("*.sh"):
        text = c.read_text(p)
        matches = TOMBSTONE_RE.findall(text)
        if matches:
            out.append(c.Violation(
                code="TOMBSTONE",
                message=(
                    f"{len(matches)} `removed v...` comment(s) in {p.name} — "
                    "candidates for CHANGELOG migration"
                ),
                location=str(p.relative_to(c.repo_root())),
            ))
    return out


SNAKE_CASE_ALIASES = ["send_message", "run_terminal_command", "write_to_file", "web_fetch"]


def check_snake_case_aliases() -> list[c.Violation]:
    """Hook script matchers containing snake_case tool name aliases
    (never match real Claude Code v2.1.89 tools)."""
    out: list[c.Violation] = []
    files = list(c.scripts_dir().rglob("*.sh")) + list(c.hooks_dir().rglob("*.sh"))
    for p in files:
        text = c.read_text(p)
        found = [alias for alias in SNAKE_CASE_ALIASES if alias in text]
        if found:
            out.append(c.Violation(
                code="SNAKE_CASE_ALIAS",
                message=f"contains dead snake_case aliases {found}",
                location=str(p.relative_to(c.repo_root())),
            ))
    return out


DELETED_ROLES = ["sphinx", "clio", "critical-drinker"]


def check_deleted_roles() -> list[c.Violation]:
    """Mentions of deleted agent roles (post-v0.99 migration) outside
    valid contexts (duo pool spawn names, historical comments)."""
    out: list[c.Violation] = []
    for name in DELETED_ROLES:
        for path, text in _all_plugin_text().items():
            # Duo pool is fine — sphinx is a spawn name there
            if "duo-pool.md" in str(path):
                continue
            # Changelog / historical mentions are fine
            if any(tag in path.name.lower() for tag in ("changelog", "readme", "migration")):
                continue
            # Find word-boundary mentions
            if re.search(rf'\b{re.escape(name)}\b', text):
                out.append(c.Violation(
                    code="DELETED_ROLE_RESIDUE",
                    message=f"mentions deleted role '{name}'",
                    location=str(path.relative_to(c.repo_root())),
                ))
    return out


ALL_CHECKS = [
    ("Orphan reference files (B1)", check_orphan_references),
    ("Vestigial signals (B2, H1)", check_vestigial_signals),
    ("Tombstone comments (B3)", check_tombstones),
    ("Snake_case tool aliases (B4)", check_snake_case_aliases),
    ("Deleted role residue", check_deleted_roles),
]


def main() -> int:
    warn_only = "--warn-only" in sys.argv
    print("Scanning for orphans and vestigials…")
    exit_code = 0
    for label, fn in ALL_CHECKS:
        print(f"[{label}]")
        violations = fn()
        exit_code |= c.print_violations(violations, label="findings")

    if warn_only:
        return 0
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
