"""Shared helpers for Kiln lint scripts.

Pure stdlib. No pip dependencies. Python 3.11+.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterator


# ── Project layout ────────────────────────────────────────────────

def repo_root() -> Path:
    """Return the Kiln repo root (parent of tests/)."""
    here = Path(__file__).resolve()
    # tests/layer1-static/lint/_common.py → repo root is 3 levels up
    return here.parent.parent.parent.parent


def plugin_root() -> Path:
    return repo_root() / "plugins" / "kiln"


def agents_dir() -> Path:
    return plugin_root() / "agents"


def references_dir() -> Path:
    return plugin_root() / "skills" / "kiln-pipeline" / "references"


def blueprints_dir() -> Path:
    return references_dir() / "blueprints"


def scripts_dir() -> Path:
    return plugin_root() / "skills" / "kiln-pipeline" / "scripts"


def hooks_dir() -> Path:
    return plugin_root() / "hooks"


def engine_skill() -> Path:
    return plugin_root() / "skills" / "kiln-pipeline" / "SKILL.md"


def protocol_skill() -> Path:
    return plugin_root() / "skills" / "kiln-protocol" / "SKILL.md"


def team_protocol_ref() -> Path:
    return references_dir() / "team-protocol.md"


# ── Frontmatter + markdown parsing ────────────────────────────────

FRONTMATTER_RE = re.compile(r"\A---\n(.*?)\n---\n", re.DOTALL)


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def parse_frontmatter(text: str) -> tuple[dict[str, object], str]:
    """Return (frontmatter dict, body text).

    Minimal YAML subset: key: value, with support for quoted strings,
    block scalars (>- / |-), and simple lists [a, b, c] or
    multi-line lists. Good enough for Kiln agent frontmatter shape.
    """
    m = FRONTMATTER_RE.match(text)
    if not m:
        return ({}, text)
    raw = m.group(1)
    body = text[m.end():]
    return (_parse_minimal_yaml(raw), body)


def _parse_minimal_yaml(raw: str) -> dict[str, object]:
    """Handle the limited YAML shapes used in Kiln frontmatter."""
    result: dict[str, object] = {}
    lines = raw.split("\n")
    i = 0
    while i < len(lines):
        line = lines[i]
        if not line.strip() or line.lstrip().startswith("#"):
            i += 1
            continue
        m = re.match(r"^([\w-]+):\s*(.*)$", line)
        if not m:
            i += 1
            continue
        key = m.group(1)
        val = m.group(2).strip()

        if val in (">-", ">", "|-", "|"):
            # Block scalar — consume indented continuation
            i += 1
            chunks: list[str] = []
            while i < len(lines) and (lines[i].startswith("  ") or not lines[i].strip()):
                chunks.append(lines[i].strip())
                i += 1
            result[key] = " ".join(c for c in chunks if c)
            continue

        if val.startswith("[") and val.endswith("]"):
            items = val[1:-1].split(",")
            result[key] = [_unquote(x.strip()) for x in items if x.strip()]
        else:
            result[key] = _unquote(val)
        i += 1
    return result


def _unquote(s: str) -> str:
    if len(s) >= 2 and s[0] == s[-1] and s[0] in ('"', "'"):
        return s[1:-1]
    return s


# ── Section extraction ────────────────────────────────────────────

def extract_section(body: str, heading: str) -> str | None:
    """Return body of the named ## or ### section. None if absent.

    Stops at next heading of same-or-higher level.
    """
    pattern = rf"^(#{{2,3}})\s+{re.escape(heading)}\s*$"
    lines = body.split("\n")
    start = None
    level = None
    for idx, line in enumerate(lines):
        m = re.match(pattern, line)
        if m:
            start = idx + 1
            level = len(m.group(1))
            break
    if start is None:
        return None
    end = len(lines)
    for idx in range(start, len(lines)):
        m = re.match(r"^(#{1,6})\s+\S", lines[idx])
        if m and len(m.group(1)) <= level:
            end = idx
            break
    return "\n".join(lines[start:end]).strip()


# ── Signal extraction ─────────────────────────────────────────────

# Signals: ALL_CAPS tokens with underscores, at least 4 chars.
# Must start with a letter. Allows digits after first char.
SIGNAL_RE = re.compile(r"\b([A-Z][A-Z0-9_]{3,})\b")

# Words that look like signals but aren't — English emphasis, tool names.
STOPLIST = {
    "NEVER", "ALWAYS", "MUST", "MAY", "SHOULD", "CRITICAL", "IMPORTANT",
    "TODO", "FIXME", "NOTE", "WARN", "WARNING", "STOP", "START", "BEGIN",
    "READ", "WRITE", "EDIT", "BASH", "GLOB", "GREP", "AGENT",
    "TRUE", "FALSE", "NULL", "NONE", "SOME", "ANY",
    "MANDATORY", "OPTIONAL", "REQUIRED", "DEFAULT",
    "ONLY", "EXACTLY", "STRICTLY", "BLOCKING",
    "TL_DR", "TLDR", "YAML", "JSON", "HTML", "HTTP", "HTTPS", "URL", "API",
    "ASCII", "UTF", "UUID", "UUID4",
    "AND", "OR", "NOT", "XOR", "IF", "ELSE", "FOR", "WHILE",
    "HEAD", "TAIL", "END", "EOF",
    "PHASE_A", "PHASE_B", "PHASE_C", "PHASE_D",
    "RUN_DIR", "PROOF_DIR", "CHECKER_ID", "RUN_NUMBER", "MY_NAME", "BOSS_NAME",
    "REVIEWER_NAME", "CODER_NAME", "ARCHIVIST_NAME", "REPORT_A", "REPORT_B",
    "CLAUDE_PLUGIN_ROOT", "HOME", "TMPDIR", "PATH", "LANG",
    "GPT", "LLM", "CLI", "MCP", "RSC", "TDD", "SOP", "UTC", "ISO",
    "CSS", "XML", "SQL",
    "QA_PASS", "QA_FAIL",  # handled explicitly below (signals, not stoplist)
}
# Remove QA_PASS/QA_FAIL from stoplist since they ARE signals
STOPLIST.discard("QA_PASS")
STOPLIST.discard("QA_FAIL")


def extract_signals(text: str) -> set[str]:
    """Return the set of signal-looking tokens in `text`, minus stoplist."""
    return {
        m.group(1) for m in SIGNAL_RE.finditer(text)
        if m.group(1) not in STOPLIST
    }


# Signal-emission patterns. Captures (signal, context_before).
# Matches: SendMessage... content: "SIGNAL: ..."
#          Message X: "SIGNAL ..."
#          SendMessage(... content:"SIGNAL...")
#          send SIGNAL to Y
SEND_PATTERNS = [
    # SendMessage tool call
    re.compile(
        r'SendMessage[^)]*content[:=]\s*["\']([A-Z][A-Z0-9_]+)',
        re.IGNORECASE,
    ),
    # "SendMessage to X: SIGNAL..."
    re.compile(
        r'SendMessage\s+to\s+["`]?(\w[\w-]*)["`]?[:\s]+["\']?([A-Z][A-Z0-9_]{3,})',
    ),
    # "Message X: SIGNAL..."
    re.compile(
        r'\bMessage\s+["`]?(\w[\w-]*)["`]?[:\s]+["\']?([A-Z][A-Z0-9_]{3,})',
    ),
    # "Signal to team-lead: SIGNAL..." or "Signal {name}: SIGNAL..."
    re.compile(
        r'Signal\s+(?:to\s+)?["`]?(\w[\w-]*)["`]?[:\s]+["\']?([A-Z][A-Z0-9_]{3,})',
    ),
]


def extract_sends(text: str) -> list[tuple[str | None, str]]:
    """Return list of (recipient, signal) pairs found in send-like lines.

    recipient is None for patterns where the recipient isn't captured
    (e.g., inline SendMessage(...) without recipient context).
    """
    out: list[tuple[str | None, str]] = []
    # Pattern 0: recipient captured separately via nearby "recipient:" field
    for m in re.finditer(
        r'SendMessage\s*\([^)]*recipient[:=]\s*["\']([^"\']+)["\'][^)]*content[:=]\s*["\']([A-Z][A-Z0-9_]+)',
        text,
        re.DOTALL | re.IGNORECASE,
    ):
        out.append((m.group(1), m.group(2)))
    # Pattern 1: "SendMessage to X: SIGNAL"
    for m in re.finditer(
        r'SendMessage\s+to\s+["`]?(\w[\w-]*)["`]?:\s*["\']?([A-Z][A-Z0-9_]{3,})',
        text,
    ):
        out.append((m.group(1), m.group(2)))
    # Pattern 2: "Message X: SIGNAL"
    for m in re.finditer(
        r'\bMessage\s+["`]?(\w[\w-]*)["`]?:\s*["\']?([A-Z][A-Z0-9_]{3,})',
        text,
    ):
        out.append((m.group(1), m.group(2)))
    # Pattern 3: template `SIGNAL: {field}` near a "to X" clause on the same line
    for m in re.finditer(
        r'(?i)\bsignal\s+(?:to\s+)?(?:team-lead\|)?(\w[\w-]*)?\b.*?\b([A-Z][A-Z0-9_]{3,})\b',
        text,
    ):
        recipient = m.group(1) if m.group(1) else None
        sig = m.group(2)
        if sig in STOPLIST:
            continue
        out.append((recipient, sig))
    # Filter out stoplist leakage
    return [(r, s) for r, s in out if s not in STOPLIST]


# ── Path extraction ───────────────────────────────────────────────

# .kiln/tmp/X.md or .kiln/docs/X.md — files referenced in agent bodies
KILN_PATH_RE = re.compile(r'\.kiln/(?:tmp|docs|validation|archive|plans|design)/[\w/.-]+\.(?:md|xml|json|log|css|txt|html|yaml|yml)')

# Plugin path references: ${CLAUDE_PLUGIN_ROOT}/...
PLUGIN_PATH_RE = re.compile(r'\$\{CLAUDE_PLUGIN_ROOT\}/[\w/.-]+\.(?:md|sh|json)')


def extract_kiln_paths(text: str) -> set[str]:
    return set(KILN_PATH_RE.findall(text))


def extract_plugin_paths(text: str) -> set[str]:
    return set(PLUGIN_PATH_RE.findall(text))


# "writes to X" / "reads X" / "write to X" / "Read X" patterns
WRITE_ACTION_RE = re.compile(
    r'(?:writ(?:e|es|ing)|cat\s+<<[\'"]?[A-Z]+[\'"]?\s*>+|tee)\s+[^\n]*?(\.kiln/[\w/.-]+\.\w+)',
    re.IGNORECASE,
)
READ_ACTION_RE = re.compile(
    r'(?:read(?:s|ing)?\s+|from\s+|Read\s+)(\.kiln/[\w/.-]+\.\w+)',
    re.IGNORECASE,
)


def classify_path_actions(text: str) -> tuple[set[str], set[str]]:
    """Return (paths_written, paths_read). Best-effort heuristic."""
    written = set(WRITE_ACTION_RE.findall(text))
    read = set(READ_ACTION_RE.findall(text))
    return (written, read)


# ── Agent file helpers ────────────────────────────────────────────

@dataclass
class Agent:
    name: str
    path: Path
    frontmatter: dict[str, object]
    body: str


def load_agents() -> list[Agent]:
    out: list[Agent] = []
    for p in sorted(agents_dir().glob("*.md")):
        text = read_text(p)
        fm, body = parse_frontmatter(text)
        out.append(Agent(
            name=p.stem,
            path=p,
            frontmatter=fm,
            body=body,
        ))
    return out


# ── Teammate Names parsing ────────────────────────────────────────

TEAMMATE_LINE_RE = re.compile(r'^-\s+[`*]?([\w-]+|\{[\w_]+\})[`*]?\s*[—–-]\s*(.+)$')


def extract_teammates(agent: Agent) -> list[tuple[str, str]]:
    """Return list of (name, description) from the Teammate Names section."""
    section = extract_section(agent.body, "Teammate Names")
    if not section:
        return []
    out: list[tuple[str, str]] = []
    for line in section.split("\n"):
        m = TEAMMATE_LINE_RE.match(line.strip())
        if m:
            out.append((m.group(1), m.group(2).strip()))
    return out


# ── Violation reporting ───────────────────────────────────────────

@dataclass
class Violation:
    code: str          # short identifier like "PATH_MISMATCH"
    message: str       # human-readable detail
    location: str = "" # file:line or file

    def __str__(self) -> str:
        loc = f" [{self.location}]" if self.location else ""
        return f"{self.code}: {self.message}{loc}"


def print_violations(violations: list[Violation], label: str = "violations") -> int:
    if not violations:
        print(f"  ✓ no {label}")
        return 0
    print(f"  ✗ {len(violations)} {label}:")
    for v in violations:
        print(f"    {v}")
    return 1


# ── Known fixed spawn names ───────────────────────────────────────

# Names that are always valid recipients regardless of which blueprint
# we're in. Hardcoded by protocol convention.
FIXED_NAMES = {
    "team-lead",   # engine
    "thoth",       # archivist (always available)
    "rakim",       # codebase mind (build)
    "sentinel",    # quality mind (build)
    "numerobis",   # technical authority (architecture)
    "krs-one",     # build boss
    "aristotle",   # architecture boss
    "alpha",       # onboarding boss
    "mi6",         # research boss
    "argus",       # validation boss
    "da-vinci",    # brainstorm boss
    "omega",       # report agent
    "mnemosyne",   # cartographer
    "asimov",      # foundation curator
    "ken", "ryu", "denzel", "judge-dredd",  # QA tribunal
    "zoxea", "hephaestus",                   # validate helpers
    "confucius", "sun-tzu", "miyamoto", "diogenes", "plato", "athena",  # planners
    "maiev", "curie", "medivh",              # scouts
}


# ── Duo pool ──────────────────────────────────────────────────────

def load_duo_pool() -> dict[str, list[str]]:
    """Return {pool_name: [spawn_names...]} from duo-pool.md."""
    path = references_dir() / "duo-pool.md"
    if not path.exists():
        return {}
    text = read_text(path)
    out: dict[str, list[str]] = {"default": [], "fallback": [], "ui": []}
    for line in text.split("\n"):
        # rows: | `default` | `codex-sphinx` | `codex` | `sphinx` | `dial-a-coder` | `critical-drinker` |
        m = re.match(r'\|\s*`(default|fallback|ui)`\s*\|\s*`[\w-]+`\s*\|\s*`([\w-]+)`\s*\|\s*`([\w-]+)`\s*\|', line)
        if m:
            pool = m.group(1)
            out[pool].append(m.group(2))  # coder
            out[pool].append(m.group(3))  # reviewer
    return out


def all_duo_pool_names() -> set[str]:
    pool = load_duo_pool()
    out: set[str] = set()
    for names in pool.values():
        out.update(names)
    return out


# ── Blueprint rosters ─────────────────────────────────────────────

ROSTER_ROW_RE = re.compile(
    r'\|\s*[`*]?(\*cycled\*|\*duo pool\*|[\w-]+)[`*]?\s*\|\s*[`*]?([\w-]+)[`*]?\s*\|',
)


def load_blueprint_rosters() -> dict[str, list[tuple[str, str]]]:
    """Return {step_name: [(spawn_name, subagent_type)...]}."""
    out: dict[str, list[tuple[str, str]]] = {}
    for p in sorted(blueprints_dir().glob("step-*.md")):
        text = read_text(p)
        section = extract_section(text, "Agent Roster")
        if not section:
            continue
        rows = []
        for line in section.split("\n"):
            m = ROSTER_ROW_RE.match(line.strip())
            if m:
                rows.append((m.group(1), m.group(2)))
        out[p.stem] = rows
    return out


def all_roster_spawn_names() -> set[str]:
    """Union of all known spawn names from blueprints."""
    out: set[str] = set()
    for rows in load_blueprint_rosters().values():
        for name, _ in rows:
            # Skip placeholders
            if name in ("*cycled*", "*duo pool*", "(dynamic)"):
                continue
            out.add(name)
    return out


# ── Model tier policy ─────────────────────────────────────────────

def model_policy_path() -> Path:
    return repo_root() / "tests" / "model-policy.yaml"


def load_model_policy() -> dict[str, dict[str, str]]:
    """Return {agent_name: {tier, model, effort?}} from tests/model-policy.yaml.

    Nested YAML subset — top-level agent keys with 2-space indented
    `tier: X`, `model: Y`, optional `effort: Z`. Comments with `#` ignored.
    """
    path = model_policy_path()
    if not path.exists():
        return {}
    result: dict[str, dict[str, str]] = {}
    current: str | None = None
    for raw in read_text(path).splitlines():
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if not raw.startswith(" "):
            m = re.match(r"^([\w-]+):\s*$", raw)
            if m:
                current = m.group(1)
                result[current] = {}
            else:
                current = None
            continue
        if current is None:
            continue
        m = re.match(r"^\s+([\w-]+):\s*(.+?)\s*$", raw)
        if m:
            result[current][m.group(1)] = _unquote(m.group(2))
    return result


# ── Iterators ─────────────────────────────────────────────────────

def walk_plugin_mds() -> Iterator[Path]:
    """Yield every .md file under plugins/kiln/ (except README)."""
    for p in plugin_root().rglob("*.md"):
        if p.name.startswith("README"):
            continue
        yield p
