#!/usr/bin/env python3
"""agents.py — per-agent schema validation.

Each agent .md must satisfy:
  - Parsable YAML frontmatter
  - `name` matches filename
  - `model` in {opus, sonnet, haiku}
  - Required sections present (Teammate Names, Protocol OR Instructions, Rules)
  - Bootstrap Read line present for belt-and-suspenders skill loading
  - `tools` list is reasonable for the role (no over-provisioning)

Exit code: 0 clean, 1 violations.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import _common as c  # noqa: E402


VALID_MODELS = {"opus", "sonnet", "haiku"}

# Minimum required frontmatter keys
REQUIRED_KEYS = {"name", "description", "model", "color", "skills", "tools"}

# Frontmatter fields that Opus 4.7 rejects with HTTP 400.
# Adaptive thinking is the only mode on 4.7 — these sampling/budget knobs
# must not appear on any agent. Guardrail only: Kiln is currently clean.
# Source: research report 2026-04-16 § 2 "Key Findings → Opus 4.7".
OPUS47_DEPRECATED_FIELDS = {
    "temperature",
    "top_p",
    "top_k",
    "budget_tokens",
}

# Sections that every agent body should contain (one of Protocol/Instructions)
REQUIRED_SECTIONS = [
    ("Teammate Names",),
    ("Protocol", "Instructions", "Your Job", "Job", "Bootstrap"),
    ("Rules",),
]


BOOTSTRAP_RE = re.compile(
    r'\*\*Bootstrap:\*\*\s+Read\s+`?\$\{CLAUDE_PLUGIN_ROOT\}/skills/kiln-protocol/SKILL\.md`?',
)

# Over-provisioned tools per role. Reviewers shouldn't Write source, only their report dir.
TOOL_POLICY = {
    # reviewer agents — should NOT have Write/Edit
    "critical-drinker": {"forbidden": {"Write", "Edit"}},
    "the-curator":      {"forbidden": {"Write", "Edit"}},
    "team-red":         {"forbidden": {"Write", "Edit"}},
    "team-blue":        {"forbidden": {"Write", "Edit"}},
    "the-negotiator":   {"forbidden": {"Write", "Edit"}},
    "i-am-the-law":     {"forbidden": {"Write", "Edit"}},
    # bossman uses Bash+sed for STATE.md — no Write/Edit
    "bossman":          {"forbidden": {"Write", "Edit"}},
    # dial-a-coder — thin codex CLI wrapper, no Write/Edit on deliverables
    "dial-a-coder":     {"forbidden": {"Write", "Edit"}},
    "art-of-war":       {"forbidden": {"Write", "Edit"}},
    # scouts — read-only
    "the-anatomist":    {"forbidden": {"Write", "Edit"}},
    "trust-the-science": {"forbidden": {"Write", "Edit"}},
    "follow-the-scent": {"forbidden": {"Write", "Edit"}},
}


def check_frontmatter(agent: c.Agent) -> list[c.Violation]:
    out: list[c.Violation] = []
    fm = agent.frontmatter
    missing = REQUIRED_KEYS - set(fm.keys())
    if missing:
        out.append(c.Violation(
            code="FRONTMATTER_MISSING_KEYS",
            message=f"'{agent.name}' missing keys {sorted(missing)}",
            location=f"plugins/kiln/agents/{agent.name}.md",
        ))

    # name matches filename
    if fm.get("name") and fm["name"] != agent.name:
        out.append(c.Violation(
            code="NAME_MISMATCH",
            message=f"frontmatter name='{fm['name']}' but filename is '{agent.name}.md'",
            location=f"plugins/kiln/agents/{agent.name}.md",
        ))

    # model validity
    model = fm.get("model")
    if model and model not in VALID_MODELS:
        out.append(c.Violation(
            code="INVALID_MODEL",
            message=f"'{agent.name}' has model='{model}' (valid: {VALID_MODELS})",
            location=f"plugins/kiln/agents/{agent.name}.md",
        ))

    return out


def check_sections(agent: c.Agent) -> list[c.Violation]:
    out: list[c.Violation] = []
    for alternatives in REQUIRED_SECTIONS:
        found = any(c.extract_section(agent.body, h) is not None for h in alternatives)
        if not found:
            out.append(c.Violation(
                code="MISSING_SECTION",
                message=f"'{agent.name}' missing any of sections {list(alternatives)}",
                location=f"plugins/kiln/agents/{agent.name}.md",
            ))
    return out


def check_bootstrap_line(agent: c.Agent) -> list[c.Violation]:
    out: list[c.Violation] = []
    if not BOOTSTRAP_RE.search(agent.body):
        out.append(c.Violation(
            code="MISSING_BOOTSTRAP",
            message=f"'{agent.name}' missing bootstrap `Read ${{CLAUDE_PLUGIN_ROOT}}/skills/kiln-protocol/SKILL.md`",
            location=f"plugins/kiln/agents/{agent.name}.md",
        ))
    return out


def check_opus47_deprecated_fields(agent: c.Agent) -> list[c.Violation]:
    out: list[c.Violation] = []
    hits = sorted(OPUS47_DEPRECATED_FIELDS & set(agent.frontmatter.keys()))
    if hits:
        out.append(c.Violation(
            code="DEPRECATED_FRONTMATTER_FIELD",
            message=(
                f"'{agent.name}' has Opus 4.7-rejected field(s) {hits}. "
                "Adaptive thinking is the only mode on 4.7 — remove these knobs."
            ),
            location=f"plugins/kiln/agents/{agent.name}.md",
        ))
    return out


def check_tools(agent: c.Agent) -> list[c.Violation]:
    out: list[c.Violation] = []
    tools_val = agent.frontmatter.get("tools")
    if tools_val is None:
        return out
    if isinstance(tools_val, list):
        tools_set = set(tools_val)
    else:
        # comma-separated string form
        tools_set = {t.strip() for t in str(tools_val).split(",") if t.strip()}

    policy = TOOL_POLICY.get(agent.name)
    if not policy:
        return out
    forbidden = policy.get("forbidden", set())
    overlap = tools_set & forbidden
    if overlap:
        out.append(c.Violation(
            code="TOOL_OVERPROVISIONED",
            message=(
                f"'{agent.name}' has tools {sorted(overlap)} forbidden per role policy. "
                "Remove or justify."
            ),
            location=f"plugins/kiln/agents/{agent.name}.md",
        ))
    return out


ALL_CHECKS = [
    ("Frontmatter schema", check_frontmatter),
    ("Required sections", check_sections),
    ("Bootstrap Read line", check_bootstrap_line),
    ("Opus 4.7 deprecated fields", check_opus47_deprecated_fields),
    ("Tool policy", check_tools),
]


def main() -> int:
    print("Validating agent schemas…")
    agents = c.load_agents()
    print(f"  loaded {len(agents)} agents")
    exit_code = 0
    for label, fn in ALL_CHECKS:
        print(f"[{label}]")
        all_violations: list[c.Violation] = []
        for agent in agents:
            all_violations.extend(fn(agent))
        exit_code |= c.print_violations(all_violations, label="issues")
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
