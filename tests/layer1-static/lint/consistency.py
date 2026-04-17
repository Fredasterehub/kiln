#!/usr/bin/env python3
"""consistency.py — cross-doc invariants for the Kiln plugin.

Checks that signals, paths, teammate names, and subagent types stay
consistent across agent bodies, blueprints, and the engine SKILL.md.

Exit code: 0 if no violations, 1 otherwise.

Invariants implemented (each maps to one or more audit findings):
  1. Path symmetry              — C1 (qa-reconciliation vs qa-synthesis vs qa-reconciled-report)
  2. Signal handler presence    — C5 (MILESTONE_DONE handler with no sender)
  3. Signal definition          — H1 (retired and promoted signals that were not in the central protocol pre-Wave-4)
  4. Teammate name validity     — routing safety
  5. Subagent type existence    — spawn safety
  6. `kiln:` prefix consistency — C7
  7. Runtime variable promise   — C3 (ken/ryu expect CHECKER_ID that engine doesn't pass)
  8. REQUEST_WORKERS protocol   — C6 (engine doesn't document REQUEST_WORKERS handler)
  9. Boss STATE.md scope        — H6 (argus/aristotle touch STATE.md)
 10. Terminal signal contract   — C4 (MILESTONE_COMPLETE vs BUILD_COMPLETE order)
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

# Add this dir to path so `_common` resolves
sys.path.insert(0, str(Path(__file__).parent))

import _common as c  # noqa: E402


# ── Invariant 1 — Path symmetry ───────────────────────────────────

def check_path_symmetry() -> list[c.Violation]:
    """Detect paths written by one agent + read/referenced by another
    with *different* specific filenames."""
    out: list[c.Violation] = []

    # Build (agent_name → set of kiln paths mentioned)
    agent_paths: dict[str, set[str]] = {}
    for agent in c.load_agents():
        paths = c.extract_kiln_paths(agent.body)
        if paths:
            agent_paths[agent.name] = paths

    # Known high-risk path clusters — QA tribunal's reconciliation file
    qa_reconciliation_variants = {
        ".kiln/tmp/qa-reconciliation.md",
        ".kiln/tmp/qa-synthesis.md",
        ".kiln/tmp/qa-reconciled-report.md",
    }

    mentioning = {
        variant: [a for a, paths in agent_paths.items() if variant in paths]
        for variant in qa_reconciliation_variants
    }

    used_variants = [v for v, agents in mentioning.items() if agents]
    if len(used_variants) > 1:
        lines = []
        for v in used_variants:
            lines.append(f"    {v} referenced by: {', '.join(mentioning[v])}")
        out.append(c.Violation(
            code="PATH_SYMMETRY",
            message=(
                "QA reconciliation file has multiple names across agents. "
                "All three variants appear — pick one:\n" + "\n".join(lines)
            ),
        ))

    # Also check engine SKILL.md and blueprints
    engine_text = c.read_text(c.engine_skill())
    blueprint_texts = {
        p.stem: c.read_text(p) for p in c.blueprints_dir().glob("step-*.md")
    }
    doc_hits: dict[str, list[str]] = {}
    for variant in qa_reconciliation_variants:
        hits = []
        if variant in engine_text:
            hits.append("kiln-pipeline/SKILL.md")
        for name, text in blueprint_texts.items():
            if variant in text:
                hits.append(f"blueprints/{name}.md")
        if hits:
            doc_hits[variant] = hits

    if len(doc_hits) > 1:
        lines = [f"    {v}: {', '.join(hits)}" for v, hits in doc_hits.items()]
        out.append(c.Violation(
            code="PATH_SYMMETRY",
            message=(
                "QA reconciliation file has multiple names across docs:\n"
                + "\n".join(lines)
            ),
        ))

    return out


# ── Invariant 2 — Signal handler presence ─────────────────────────

HANDLER_SECTION_RE = re.compile(r'##+\s*(?:Handling\s+|Processing\s+|On\s+|Receiving\s+)?([A-Z][A-Z0-9_]{3,})', re.MULTILINE)


def check_signal_handlers() -> list[c.Violation]:
    """For every signal handler in an agent body, check that at least
    one other agent (or the engine) is documented as sending it."""
    out: list[c.Violation] = []

    # Build: (handler agent → set of signals they handle)
    handlers: dict[str, set[str]] = {}
    # And: (agent → set of signals they send)
    senders: dict[str, set[str]] = {}

    agents = c.load_agents()
    for agent in agents:
        handled = set()
        # Find "## Handling X" or "## Processing X Messages" or "## On X" patterns
        for m in re.finditer(
            r'##+\s*(?:Handling|Processing|On receiving|Receiving)\s+([A-Z][A-Z0-9_]{3,})',
            agent.body,
        ):
            sig = m.group(1)
            if sig in c.STOPLIST:
                continue
            handled.add(sig)
        if handled:
            handlers[agent.name] = handled

        # Find sends — heuristic: lines with send-verbs, collect ALL-CAPS tokens.
        sent = set()
        send_line_re = re.compile(
            r'(SendMessage|\bSignal(?:s|ing)?\b|\bSend\s+|\bMessage\s+\S|\bmay\s+send\b|\bMAY\s+send\b)',
            re.IGNORECASE,
        )
        signal_token_re = re.compile(r'\b([A-Z][A-Z0-9_]{3,})\b')
        for line in agent.body.split("\n"):
            if not send_line_re.search(line):
                continue
            for m in signal_token_re.finditer(line):
                tok = m.group(1)
                if tok in c.STOPLIST:
                    continue
                sent.add(tok)
        if sent:
            senders[agent.name] = sent

    # Mine the engine (and team-protocol ref) for signals it sends
    engine_sends = set()
    for src in [c.engine_skill(), c.team_protocol_ref()]:
        text = c.read_text(src)
        for line in text.split("\n"):
            if not send_line_re.search(line):
                continue
            for m in signal_token_re.finditer(line):
                sig = m.group(1)
                if sig not in c.STOPLIST:
                    engine_sends.add(sig)
    # Always credit engine with engine-specific relays. QA_VERDICT was
    # retired in Wave 2 (judge-dredd sends QA_PASS / QA_FAIL direct to
    # krs-one) — do not add it here, or stale handler references would
    # be masked by phantom senders.
    engine_sends.update({"WORKERS_SPAWNED", "WORKERS_REJECTED"})
    if engine_sends:
        senders["engine"] = engine_sends

    # Check: each handled signal has at least one sender
    all_senders = set()
    for s in senders.values():
        all_senders.update(s)

    for handler_agent, handled_signals in handlers.items():
        for sig in handled_signals:
            if sig not in all_senders:
                out.append(c.Violation(
                    code="ORPHAN_HANDLER",
                    message=f"'{handler_agent}' handles {sig} but no agent sends it",
                    location=f"plugins/kiln/agents/{handler_agent}.md",
                ))

    return out


# ── Invariant 3 — Signal definition ───────────────────────────────

def _collect_known_signals() -> set[str]:
    """Signals documented in protocol + team-protocol + all blueprints."""
    sources = [c.protocol_skill(), c.team_protocol_ref(), c.engine_skill()]
    for p in c.blueprints_dir().glob("step-*.md"):
        sources.append(p)
    known = set()
    for src in sources:
        if not src.exists():
            continue
        text = c.read_text(src)
        # Parse vocabulary tables: rows with `SIGNAL` or `SIGNAL:` in a code span
        for m in re.finditer(
            r'[|]\s*`([A-Z][A-Z0-9_]{3,})[:` ]',
            text,
        ):
            known.add(m.group(1))
        # Also parse bullet lists like "- `SIGNAL: ...`"
        for m in re.finditer(
            r'^\s*-\s*`([A-Z][A-Z0-9_]{3,})[:` ]',
            text,
            re.MULTILINE,
        ):
            known.add(m.group(1))
    # Peer/shutdown signals
    known.update({
        "shutdown_request", "shutdown_response",  # lowercase but intentional
    })
    return known


def check_signal_definitions() -> list[c.Violation]:
    """Every signal sent by an agent must be documented in protocol,
    team-protocol, engine SKILL.md, or a blueprint."""
    out: list[c.Violation] = []
    known = _collect_known_signals()

    for agent in c.load_agents():
        sent_signals = set()
        for m in re.finditer(
            r'content[:=]\s*["\']([A-Z][A-Z0-9_]{3,})',
            agent.body,
        ):
            sent_signals.add(m.group(1))
        # Also match inline backtick mentions of "X_SIGNAL: payload" instructions
        for m in re.finditer(
            r'`([A-Z][A-Z0-9_]{3,}):',
            agent.body,
        ):
            sent_signals.add(m.group(1))

        for sig in sent_signals:
            if sig in c.STOPLIST:
                continue
            if sig in known:
                continue
            out.append(c.Violation(
                code="UNDEFINED_SIGNAL",
                message=f"'{agent.name}' references signal {sig} not defined in protocol / blueprints",
                location=f"plugins/kiln/agents/{agent.name}.md",
            ))

    return out


# ── Invariant 4 — Teammate name validity ──────────────────────────

def check_teammate_names() -> list[c.Violation]:
    """Every name in an agent's 'Teammate Names' section must be a
    known fixed name, a blueprint roster name, or a duo pool name.
    Placeholders like {BUILDER_NAME} are always accepted."""
    out: list[c.Violation] = []
    fixed = c.FIXED_NAMES
    roster = c.all_roster_spawn_names()
    duo = c.all_duo_pool_names()
    known = fixed | roster | duo

    for agent in c.load_agents():
        for name, desc in c.extract_teammates(agent):
            if name.startswith("{") and name.endswith("}"):
                continue  # runtime placeholder
            if name in known:
                continue
            # Skip common tokens
            if name in {"*cycled*", "*duo pool*"}:
                continue
            out.append(c.Violation(
                code="UNKNOWN_TEAMMATE",
                message=f"'{agent.name}' references teammate '{name}' (not in rosters, duo pool, or fixed names)",
                location=f"plugins/kiln/agents/{agent.name}.md",
            ))

    return out


# ── Invariant 5 — Subagent type existence ─────────────────────────

SUBAGENT_TYPE_RE = re.compile(r'subagent_type[:=]\s*["\']?(?:kiln:)?([\w-]+)["\']?')


def check_subagent_types() -> list[c.Violation]:
    """Every subagent_type mentioned in an agent body or engine SKILL.md
    must correspond to a real agent .md file."""
    out: list[c.Violation] = []
    known_types = {p.stem for p in c.agents_dir().glob("*.md")}

    files_to_check: list[Path] = []
    files_to_check.extend(c.agents_dir().glob("*.md"))
    files_to_check.append(c.engine_skill())
    files_to_check.extend(c.blueprints_dir().glob("step-*.md"))

    for f in files_to_check:
        text = c.read_text(f)
        for m in SUBAGENT_TYPE_RE.finditer(text):
            t = m.group(1)
            # Skip pure placeholders (regex never captures these because
            # `{` isn't in `[\w-]`, but list them for documentation).
            if t in {"{agent_type}", "{type}", "{builder_type}",
                     "{reviewer_type}", "{coder_template}", "{reviewer_template}"}:
                continue
            # Narrow skip for the `kiln` false-positive: `SUBAGENT_TYPE_RE`
            # captures bare `kiln` when it backtracks past a
            # `subagent_type: "kiln:{placeholder}"` example — the optional
            # `(?:kiln:)?` group releases because `[\w-]+` can't match the
            # `{` in the placeholder, so it falls back to matching `kiln`
            # as the type and leaves the `:` behind in the source. A
            # legitimate `subagent_type: "kiln"` (no colon follows in the
            # source) would have the closing quote / whitespace / end-of-
            # line right after the match and MUST still be flagged.
            if t == "kiln":
                after = text[m.end():m.end() + 1]
                if after == ":":
                    continue
                # else fall through — real `subagent_type: "kiln"` bug
            if t not in known_types:
                out.append(c.Violation(
                    code="UNKNOWN_SUBAGENT_TYPE",
                    message=f"subagent_type '{t}' referenced but no matching agent .md",
                    location=str(f.relative_to(c.repo_root())),
                ))
    return out


# ── Invariant 6 — kiln: prefix consistency ────────────────────────

def check_prefix_consistency() -> list[c.Violation]:
    """REQUEST_WORKERS payloads should use a consistent prefix rule.
    Current mix: mnemosyne + mi6 send bare, engine uses 'kiln:' prefix."""
    out: list[c.Violation] = []

    pattern = re.compile(
        r'REQUEST_WORKERS:\s+[^\n]*?\(subagent_type:\s*([\w:-]+)\)',
    )

    bare_senders: list[tuple[str, str]] = []
    prefixed_senders: list[tuple[str, str]] = []

    for agent in c.load_agents():
        for m in pattern.finditer(agent.body):
            t = m.group(1).strip()
            if t.startswith("kiln:"):
                prefixed_senders.append((agent.name, t))
            elif t.startswith("{"):
                continue  # placeholder
            else:
                bare_senders.append((agent.name, t))

    if bare_senders and prefixed_senders:
        msg = (
            "Mixed `kiln:` prefix usage in REQUEST_WORKERS payloads:\n"
            f"    bare (no prefix): {sorted(set(a for a, _ in bare_senders))}\n"
            f"    prefixed (kiln:): {sorted(set(a for a, _ in prefixed_senders))}\n"
            "    Pick one rule and document it in team-protocol.md."
        )
        out.append(c.Violation(code="PREFIX_INCONSISTENT", message=msg))
    return out


# ── Invariant 7 — Runtime variable promise ────────────────────────

def check_runtime_vars() -> list[c.Violation]:
    """If an agent lists runtime vars in its body, the engine should pass them.

    This is a heuristic: we look for an agent body that documents
    'spawn prompt provides: CHECKER_ID, RUN_NUMBER' and then scan the
    engine SKILL.md for whether those names appear in the spawn prompt
    template for the same agent.
    """
    out: list[c.Violation] = []
    engine_text = c.read_text(c.engine_skill())

    # Pattern in agent body: bullet list of runtime vars
    # e.g. "   - `CHECKER_ID` — your checker identifier"
    var_re = re.compile(
        r'^\s*-\s*`([A-Z][A-Z0-9_]+)`\s*—',
        re.MULTILINE,
    )

    for agent in c.load_agents():
        section = c.extract_section(agent.body, "Protocol") or agent.body
        # Only check runtime vars declared near "provides" text
        near_provides = re.search(
            r'(?:spawn prompt (?:provides|providing)|runtime prompt (?:provides|providing))\s*:?\s*\n((?:\s*-\s*`[A-Z_]+`\s*—.+\n?){1,10})',
            agent.body,
            re.IGNORECASE,
        )
        if not near_provides:
            continue
        declared = set(var_re.findall(near_provides.group(1)))
        # Skip universal names that the engine doesn't need to provide
        declared -= {"MY_NAME"}
        if not declared:
            continue

        # Does the engine mention the agent's spawn in a spawn block?
        # Heuristic: find agent's subagent_type in engine text + check for vars
        agent_subtype = agent.name
        spawn_blocks = re.findall(
            rf'(?:Agent\(.*?subagent_type:\s*["\']?(?:kiln:)?{re.escape(agent_subtype)}["\']?.*?\))',
            engine_text,
            re.DOTALL,
        )
        if not spawn_blocks:
            continue
        combined_spawn = "\n".join(spawn_blocks)
        missing = declared - set(re.findall(r'\{([A-Z][A-Z0-9_]+)\}', combined_spawn)) - set(re.findall(r'([A-Z][A-Z0-9_]+)\s*[:=]', combined_spawn))
        if missing:
            out.append(c.Violation(
                code="MISSING_RUNTIME_VAR",
                message=(
                    f"agent '{agent.name}' declares runtime vars {sorted(missing)} "
                    f"but engine's spawn template does not pass them"
                ),
                location=f"plugins/kiln/agents/{agent.name}.md",
            ))
    return out


# ── Invariant 8 — REQUEST_WORKERS engine handler ──────────────────

def check_request_workers_handler() -> list[c.Violation]:
    """Any agent sending REQUEST_WORKERS expects the engine to handle it
    and respond with WORKERS_SPAWNED. Check the engine documents this."""
    out: list[c.Violation] = []
    engine_text = c.read_text(c.engine_skill())

    # Does the engine describe handling REQUEST_WORKERS at all?
    has_rw_section = bool(re.search(
        r'REQUEST_WORKERS\b[^\n]*?(?:protocol|handling|handler|process)',
        engine_text,
        re.IGNORECASE,
    ))
    # Or does it have a "REQUEST_WORKERS" subheading
    has_rw_heading = bool(re.search(
        r'^##+\s+.*REQUEST_WORKERS',
        engine_text,
        re.MULTILINE,
    ))

    # Agents that send REQUEST_WORKERS
    senders = []
    for agent in c.load_agents():
        if re.search(r'REQUEST_WORKERS:', agent.body):
            senders.append(agent.name)

    if senders and not (has_rw_section or has_rw_heading):
        out.append(c.Violation(
            code="MISSING_RW_PROTOCOL",
            message=(
                f"Agents {senders} send REQUEST_WORKERS but the engine "
                "SKILL.md has no formal REQUEST_WORKERS handling section. "
                "Engine relies on LLM extrapolation."
            ),
            location="plugins/kiln/skills/kiln-pipeline/SKILL.md",
        ))
    return out


# ── Invariant 9 — Boss STATE.md scope ─────────────────────────────

def check_boss_state_md_writes() -> list[c.Violation]:
    """Only the engine (and alpha during onboarding) should write STATE.md.
    Detect argus/aristotle/bossman touching STATE.md stage fields."""
    out: list[c.Violation] = []
    # Legitimate: alpha writes STATE.md during onboarding.
    # Legitimate: bossman may update chunk_count per CYCLE_WORKERS and
    # team_iteration/chunk_count at MILESTONE_TRANSITION (Wave 3, documented
    # exceptions in kiln-pipeline SKILL.md). The legacy single field
    # build_iteration was split into team_iteration + chunk_count by Wave 3.
    # Flag: argus, aristotle writing stage transition fields.
    risky_agents = {"release-the-giant", "the-plan-maker"}
    for agent in c.load_agents():
        if agent.name not in risky_agents:
            continue
        # Pattern 1: sed-style edit of STATE.md
        if re.search(r'sed\s+-i.*STATE\.md', agent.body):
            for m in re.finditer(
                r'sed\s+-i\s+["\']([^"\']+)["\'].*STATE\.md',
                agent.body,
            ):
                pattern = m.group(1)
                if "stage" in pattern:
                    out.append(c.Violation(
                        code="BOSS_WRITES_STATE",
                        message=(
                            f"'{agent.name}' writes STATE.md stage field via sed. "
                            "Engine should own state transitions (kilndev 'dumb relay' principle)."
                        ),
                        location=f"plugins/kiln/agents/{agent.name}.md",
                    ))
                    break
        # Pattern 2: prose instruction to update STATE.md with a stage/milestone field
        prose_re = re.compile(
            r'^\s*\d+\.\s*Update\s+[`\'"]?\.kiln/STATE\.md.*?(stage|milestone_count|correction_cycle|team_iteration|chunk_count|milestones_complete)',
            re.IGNORECASE | re.MULTILINE,
        )
        if prose_re.search(agent.body):
            out.append(c.Violation(
                code="BOSS_WRITES_STATE",
                message=(
                    f"'{agent.name}' has a prose instruction to update STATE.md "
                    "state fields. Engine should own state transitions."
                ),
                location=f"plugins/kiln/agents/{agent.name}.md",
            ))
    return out


# ── Invariant 10 — Terminal signal contract ───────────────────────

def check_terminal_signal_contract() -> list[c.Violation]:
    """bossman says 'MILESTONE_COMPLETE (or BUILD_COMPLETE)'.
    Engine says 'BUILD_COMPLETE is sent BEFORE MILESTONE_COMPLETE
    in the final milestone'. These contradict."""
    out: list[c.Violation] = []
    bossman_path = c.agents_dir() / "bossman.md"
    engine_path = c.engine_skill()
    if not bossman_path.exists() or not engine_path.exists():
        return out
    bossman_text = c.read_text(bossman_path)
    engine_text = c.read_text(engine_path)

    bossman_says_or = bool(re.search(
        r'MILESTONE_COMPLETE[^\n]*(?:or|\bOR\b)\s*[`]?BUILD_COMPLETE',
        bossman_text,
    ))
    engine_says_before = bool(re.search(
        r'BUILD_COMPLETE[^\n]*(?:before)[^\n]*MILESTONE_COMPLETE',
        engine_text,
    ))

    if bossman_says_or and engine_says_before:
        out.append(c.Violation(
            code="TERMINAL_SIGNAL_CONTRADICTION",
            message=(
                "bossman.md says 'MILESTONE_COMPLETE (or BUILD_COMPLETE)' but "
                "engine SKILL.md says BUILD_COMPLETE is sent BEFORE MILESTONE_COMPLETE "
                "in the final milestone. Pick one contract and align both."
            ),
        ))
    return out


def check_centralized_recipients() -> list[c.Violation]:
    """Wave 2 (C11/C9) centralisation contract.

    Some signals have a forced recipient — if an agent body routes them
    anywhere else, it's a regression toward the old two-hop engine relay
    or the C9 rakim deadlock.

    Rules enforced:
      - QA_PASS / QA_FAIL targeted at team-lead (or engine) are flagged;
        the verdict goes DIRECT to krs-one (no QA_VERDICT relay anymore).
      - READY_BOOTSTRAP targeted at anything other than team-lead is
        flagged; it exists specifically to signal the engine at PM start.
      - For PMs (rakim / sentinel / thoth / numerobis), a plain
        `READY: ...` sent to team-lead is flagged — plain READY is the
        post-iteration reply, which targets krs-one. If bootstrap needs
        an engine signal, use READY_BOOTSTRAP.
    """
    out: list[c.Violation] = []

    # Pattern catches "SendMessage to {recipient}: \"SIGNAL"
    #            and  "SendMessage to {recipient}: SIGNAL"
    send_re = re.compile(
        r'SendMessage\s+to\s+["`]?([\w-]+)["`]?[:\s]+["`]?([A-Z][A-Z0-9_]+)'
    )

    # agent.name is the filename stem (e.g. "dropping-science"), not the
    # spawn name ("rakim"). Key on filenames here so the rule actually
    # fires — GPT review finding MEDIUM.
    pm_agent_files = {
        "dropping-science",       # rakim
        "algalon-the-observer",   # sentinel
        "lore-keepah",            # thoth
        "pitie-pas-les-crocos",   # numerobis
        "the-foundation",         # asimov
        "the-discovery-begins",   # mnemosyne
    }

    for agent in c.load_agents():
        for m in send_re.finditer(agent.body):
            recipient = m.group(1)
            signal = m.group(2)

            if signal in {"QA_PASS", "QA_FAIL"} and recipient != "krs-one":
                out.append(c.Violation(
                    code="CENTRALIZATION_VIOLATION",
                    message=(
                        f"'{agent.name}' sends {signal} to '{recipient}' — "
                        "Wave 2 requires direct route to krs-one (no engine relay)"
                    ),
                    location=f"plugins/kiln/agents/{agent.name}.md",
                ))

            if signal == "READY_BOOTSTRAP" and recipient != "team-lead":
                out.append(c.Violation(
                    code="BOOTSTRAP_RECIPIENT",
                    message=(
                        f"'{agent.name}' sends READY_BOOTSTRAP to '{recipient}' — "
                        "this signal is engine-facing; recipient must be 'team-lead'"
                    ),
                    location=f"plugins/kiln/agents/{agent.name}.md",
                ))

            if signal == "READY" and agent.name in pm_agent_files and recipient == "team-lead":
                out.append(c.Violation(
                    code="READY_RECIPIENT",
                    message=(
                        f"'{agent.name}' sends plain READY to team-lead — "
                        "plain READY is the post-iteration reply and targets krs-one. "
                        "If bootstrap needs to signal the engine, use READY_BOOTSTRAP."
                    ),
                    location=f"plugins/kiln/agents/{agent.name}.md",
                ))

    return out


def check_model_policy() -> list[c.Violation]:
    """Assert every agent's frontmatter matches tests/model-policy.yaml.

    Until Wave 4 of PLUMBING-AUDIT-v1.3.0 ships, current Kiln agents all
    use bare `opus`/`sonnet` whereas the policy pins `opus-4.6`/`opus-4.7`/
    `sonnet-4.6`. That mismatch is the intended signal from this check.
    """
    out: list[c.Violation] = []
    policy = c.load_model_policy()
    if not policy:
        out.append(c.Violation(
            code="MODEL_POLICY_MISSING",
            message="tests/model-policy.yaml not found or empty",
            location="tests/model-policy.yaml",
        ))
        return out

    agents = c.load_agents()
    agent_names = {a.name for a in agents}
    policy_names = set(policy.keys())

    for extra in sorted(policy_names - agent_names):
        out.append(c.Violation(
            code="MODEL_POLICY_UNKNOWN_AGENT",
            message=(
                f"policy entry '{extra}' has no matching agent file. "
                "Either remove from policy or rename the agent."
            ),
            location="tests/model-policy.yaml",
        ))

    for missing in sorted(agent_names - policy_names):
        out.append(c.Violation(
            code="MODEL_POLICY_MISSING_ENTRY",
            message=f"agent '{missing}' has no entry in tests/model-policy.yaml",
            location=f"plugins/kiln/agents/{missing}.md",
        ))

    for agent in agents:
        spec = policy.get(agent.name)
        if not spec:
            continue
        expected_model = spec.get("model")
        actual_model = agent.frontmatter.get("model")
        if expected_model and actual_model != expected_model:
            out.append(c.Violation(
                code="MODEL_POLICY_MISMATCH",
                message=(
                    f"'{agent.name}' has model='{actual_model}' but policy "
                    f"(tier {spec.get('tier', '?')}) requires '{expected_model}'"
                ),
                location=f"plugins/kiln/agents/{agent.name}.md",
            ))
        expected_effort = spec.get("effort")
        actual_effort = agent.frontmatter.get("effort")
        if expected_effort and actual_effort != expected_effort:
            out.append(c.Violation(
                code="MODEL_POLICY_EFFORT_MISMATCH",
                message=(
                    f"'{agent.name}' (tier {spec.get('tier', '?')}) requires "
                    f"effort='{expected_effort}', got '{actual_effort or '<missing>'}'"
                ),
                location=f"plugins/kiln/agents/{agent.name}.md",
            ))
        if not expected_effort and actual_effort:
            out.append(c.Violation(
                code="MODEL_POLICY_EFFORT_FORBIDDEN",
                message=(
                    f"'{agent.name}' (tier {spec.get('tier', '?')}) sets "
                    f"effort='{actual_effort}' but policy forbids an effort field here"
                ),
                location=f"plugins/kiln/agents/{agent.name}.md",
            ))
    return out


# ── Main ──────────────────────────────────────────────────────────

def check_state_md_sed_patterns() -> list[c.Violation]:
    """Wave 3 (C10 follow-up) — STATE.md counter writes must use the
    markdown-bullet-aware sed shape. STATE.md stores fields as
    `- **field_name**: N` (markdown bullet, bold name, number). A sed
    pattern that targets plain `field_name: N` silently no-ops against
    the real file and chunk/milestone counters never advance — the exact
    regression that the Wave 3 sed fix closed.

    This invariant makes the fix sticky: any `sed -i ...` line targeting
    `chunk_count` / `team_iteration` / `build_iteration` against STATE.md
    MUST include the markdown-bullet markers (`\\*\\*` or `**`) in its
    pattern. Plain patterns are flagged so round-3 regressions get caught
    statically before they reach the state-mutation runtime suite.
    """
    out: list[c.Violation] = []
    counter_fields = ("chunk_count", "team_iteration", "build_iteration")

    # Any source file that rewrites STATE.md counter fields — the current
    # set after Wave 3 is bossman.md and kiln-pipeline/SKILL.md, but we
    # sweep the whole plugin tree so future moves stay covered.
    sources: list[Path] = []
    sources.extend(c.agents_dir().glob("*.md"))
    sources.append(c.engine_skill())
    sources.append(c.protocol_skill())
    for p in c.blueprints_dir().glob("step-*.md"):
        sources.append(p)

    sed_line_re = re.compile(r'^\s*sed\s+-i.*STATE\.md', re.MULTILINE)
    for path in sources:
        text = c.read_text(path)
        for m in sed_line_re.finditer(text):
            line = m.group(0)
            for field in counter_fields:
                # Does this sed line reference the counter field?
                if field not in line:
                    continue
                # Does the pattern include markdown-bullet bolding?
                # Accept either escaped (\*\*field\*\*) or literal (**field**).
                has_bullet = (
                    f'\\*\\*{field}\\*\\*' in line
                    or f'**{field}**' in line
                )
                if not has_bullet:
                    out.append(c.Violation(
                        code="PLAIN_STATE_SED",
                        message=(
                            f"sed line in {path.relative_to(c.repo_root())} "
                            f"targets `{field}` against STATE.md without the "
                            "markdown-bullet markers (`**field**`). The real "
                            "STATE.md stores fields as `- **field**: N`; a "
                            "plain pattern silently no-ops. Wrap the field "
                            "name in `\\*\\*...\\*\\*` in both the match and "
                            "replace halves."
                        ),
                        location=str(path.relative_to(c.repo_root())),
                    ))
    return out


# ── Invariant 15 — WORKER_READY retired (P1 — SubagentStart) ──────

# Flip to False in p1-07 (same commit that removes the live emissions
# from builder + reviewer agent bodies). Until then, the check runs and
# prints findings but does not fail the harness — matching the "adopt
# first, retire later" discipline from SIMPLIFY-v1.4.0 §5.6.
WORKER_READY_WARN_ONLY = False


def check_worker_ready_retired() -> list[c.Violation]:
    """P1 (SubagentStart) retirement: no agent body should carry a live
    `SendMessage(...)` call emitting `WORKER_READY`. Spawn acknowledgement
    is handled by the SubagentStart hook
    (`plugins/kiln/hooks/subagent-start-ack.sh`); the old belt-and-
    suspenders one-time emission is obsolete.

    Detection is limited to the unambiguous machine-readable call shape:
    `SendMessage(...content:"WORKER_READY...")`. Every live emission in
    the codebase uses this shape, so recall is sufficient without parsing
    natural-language imperatives (which produced false positives on
    passive routing prose in earlier iterations).

    Deprecation-evidence prose (a line whose text contains `deprecat` or
    `retir`) is exempted — matching the Wave 3 `build_iteration`
    precedent where the old name remains in CHANGELOG-style commentary
    even after the code no longer emits it. The exemption is applied
    only to lines that already matched the send-call pattern, so passive
    prose is skipped cheaply without consulting the exemption regex.

    Passive mentions — a bullet describing WHAT the recipient receives,
    a table row in a routing inventory, or prose that only names the
    signal — are out of scope. The purpose is to catch regressions on
    the emission contract, not to purge the string.
    """
    out: list[c.Violation] = []

    send_call_re = re.compile(
        r'SendMessage[^)]*content\s*[:=]\s*["\']WORKER_READY',
        re.IGNORECASE,
    )
    deprecation_re = re.compile(
        r'deprecat|retir',
        re.IGNORECASE,
    )

    for agent in c.load_agents():
        for idx, line in enumerate(agent.body.split("\n"), start=1):
            if "WORKER_READY" not in line:
                continue
            if not send_call_re.search(line):
                continue
            if deprecation_re.search(line):
                continue
            out.append(c.Violation(
                    code="WORKER_READY_LIVE",
                    message=(
                        f"'{agent.name}' carries a live "
                        "SendMessage(...content:\"WORKER_READY...\") "
                        "emission — P1 retires this in favour of the "
                        "SubagentStart hook. If this is an intentional "
                        "deprecation note, include `deprecated` or "
                        "`retired` on the same line."
                    ),
                    location=f"plugins/kiln/agents/{agent.name}.md:{idx}",
                ))

    if WORKER_READY_WARN_ONLY:
        if out:
            print(f"  ! {len(out)} WORKER_READY_LIVE findings (warn-only until p1-07):")
            for v in out:
                print(f"    {v}")
        return []
    return out


def check_iteration_field_rename() -> list[c.Violation]:
    """Wave 3 (C10) rename: agent bodies must reference `team_iteration`
    (milestone-indexed kill-streak counter) or `chunk_count` (within-
    milestone CYCLE_WORKERS counter), never the legacy `build_iteration`.

    The mock engine under tests/ still uses `self.build_iteration` as a
    private state variable — we only flag agent .md bodies + the pipeline
    skill + blueprints + references. The historical audit doc
    PLUMBING-AUDIT-v1.3.0.md is also exempt (it describes the pre-Wave-3
    state that motivated the rename).
    """
    out: list[c.Violation] = []

    # Agent bodies
    for agent in c.load_agents():
        if re.search(r'\bbuild_iteration\b', agent.body):
            out.append(c.Violation(
                code="LEGACY_ITERATION_FIELD",
                message=(
                    f"'{agent.name}' references legacy `build_iteration` — "
                    "Wave 3 (C10) split it into `team_iteration` (milestone-"
                    "indexed, kill-streak naming) and `chunk_count` (within-"
                    "milestone CYCLE_WORKERS counter). Pick the appropriate "
                    "field for the context."
                ),
                location=f"plugins/kiln/agents/{agent.name}.md",
            ))

    # Engine skill + blueprints + references + kiln-protocol
    extra_sources: list[tuple[str, Path]] = [
        ("plugins/kiln/skills/kiln-pipeline/SKILL.md", c.engine_skill()),
        ("plugins/kiln/skills/kiln-protocol/SKILL.md", c.protocol_skill()),
        ("plugins/kiln/skills/kiln-pipeline/references/team-protocol.md", c.team_protocol_ref()),
    ]
    for p in c.blueprints_dir().glob("step-*.md"):
        extra_sources.append((str(p.relative_to(c.repo_root())), p))
    # kill-streaks + resume-template + any other reference that references
    # the rename — sweep the whole references directory.
    for p in (c.blueprints_dir().parent).glob("*.md"):
        extra_sources.append((str(p.relative_to(c.repo_root())), p))

    # Dedupe by path
    seen: set[str] = set()
    for label, path in extra_sources:
        if label in seen or not path.exists():
            continue
        seen.add(label)
        text = c.read_text(path)
        if re.search(r'\bbuild_iteration\b', text):
            out.append(c.Violation(
                code="LEGACY_ITERATION_FIELD",
                message=(
                    f"{label} references legacy `build_iteration` — "
                    "Wave 3 (C10) requires `team_iteration` or `chunk_count`."
                ),
                location=label,
            ))

    # Commands
    commands_dir = c.repo_root() / "plugins/kiln/commands"
    if commands_dir.exists():
        for p in commands_dir.glob("*.md"):
            text = c.read_text(p)
            if re.search(r'\bbuild_iteration\b', text):
                out.append(c.Violation(
                    code="LEGACY_ITERATION_FIELD",
                    message=(
                        f"{p.relative_to(c.repo_root())} references legacy "
                        "`build_iteration` — Wave 3 (C10) requires "
                        "`team_iteration` or `chunk_count`."
                    ),
                    location=str(p.relative_to(c.repo_root())),
                ))

    return out


ALL_CHECKS = [
    ("Path symmetry (C1)", check_path_symmetry),
    ("Signal handlers have senders (C5)", check_signal_handlers),
    ("Signal definitions (H1)", check_signal_definitions),
    ("Teammate names valid", check_teammate_names),
    ("Subagent types exist", check_subagent_types),
    ("Prefix consistency (C7)", check_prefix_consistency),
    ("Runtime variable promise (C3)", check_runtime_vars),
    ("REQUEST_WORKERS engine handler (C6)", check_request_workers_handler),
    ("Boss STATE.md scope (H6)", check_boss_state_md_writes),
    ("Terminal signal contract (C4)", check_terminal_signal_contract),
    ("Centralized recipients (Wave 2 — C11/C9)", check_centralized_recipients),
    ("Iteration field rename (Wave 3 — C10)", check_iteration_field_rename),
    ("STATE.md sed patterns (Wave 3 — C10 follow-up)", check_state_md_sed_patterns),
    ("Model tier policy (Sprint 3)", check_model_policy),
    ("WORKER_READY retired (P1 — SubagentStart)", check_worker_ready_retired),
]


def main() -> int:
    print("Running consistency invariants…")
    exit_code = 0
    for label, fn in ALL_CHECKS:
        print(f"[{label}]")
        violations = fn()
        exit_code |= c.print_violations(violations, label="issues")
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
