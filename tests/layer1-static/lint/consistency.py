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

import json
import os
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

# Warn-only until p2-11 retires the manual watchdog prose from
# kiln-pipeline SKILL.md § 5 and any agent-body idle-ping directives.
# Until then the check prints findings but does not fail the harness —
# same "adopt first, retire later" discipline as WORKER_READY_WARN_ONLY.
WATCHDOG_RETIRED_WARN_ONLY = False


def check_worker_ready_retired() -> list[c.Violation]:
    """P1 (SubagentStart) retirement: `WORKER_READY` may only appear in
    explicitly retired/deprecated prose or archival transcripts.

    The old check only detected the exact SendMessage emission shape. That
    let active fallback prose drift back in while still passing. The current
    contract is stricter: any live-file mention must make the retirement
    obvious on the same line or the surrounding comment/prose window.
    """
    out: list[c.Violation] = []

    allowed_context_re = re.compile(
        r"deprecat|retir|obsolete|archiv|histor|replaces|no self-announce|"
        r"no longer|fallback was|fallback.*retir",
        re.IGNORECASE,
    )
    active_dependency_re = re.compile(
        r"wait|emit|send|fallback|unblock|ready\s+for\s+assignment",
        re.IGNORECASE,
    )
    excluded_parts = {
        "tests/layer1-static/lint/consistency.py",
    }

    sources: list[Path] = []
    sources.extend(c.plugin_root().rglob("*"))
    sources.extend((c.repo_root() / "tests").rglob("*"))

    for path in sorted(p for p in sources if p.is_file()):
        rel = str(path.relative_to(c.repo_root()))
        if rel in excluded_parts or "/transcripts/" in rel:
            continue
        try:
            lines = c.read_text(path).splitlines()
        except UnicodeDecodeError:
            continue
        for idx, line in enumerate(lines, start=1):
            if "WORKER_READY" not in line:
                continue
            window = "\n".join(lines[max(0, idx - 3): min(len(lines), idx + 2)])
            if allowed_context_re.search(window):
                continue
            code = "WORKER_READY_LIVE" if active_dependency_re.search(line) else "WORKER_READY_UNSCOPED"
            out.append(c.Violation(
                code=code,
                message=(
                    "`WORKER_READY` is retired from active protocol. "
                    "Live references must be removed, or archival/deprecation "
                    "mentions must say `retired`, `deprecated`, `historical`, "
                    "or equivalent in the surrounding prose."
                ),
                location=f"{rel}:{idx}",
            ))

    if WORKER_READY_WARN_ONLY:
        if out:
            print(f"  ! {len(out)} WORKER_READY_LIVE findings (warn-only until p1-07):")
            for v in out:
                print(f"    {v}")
        return []
    return out


def check_hook_config_integrity() -> list[c.Violation]:
    """Every command hook in hooks.json must point at a real executable.

    Also catches matchers on hook events that Claude Code documents as
    matcherless, because those matcher fields are silently ignored and can
    create a false sense of enforcement.
    """
    out: list[c.Violation] = []
    hooks_path = c.hooks_dir() / "hooks.json"
    try:
        data = json.loads(c.read_text(hooks_path))
    except (OSError, json.JSONDecodeError) as exc:
        return [c.Violation(
            code="HOOK_CONFIG_INVALID",
            message=f"hooks.json could not be parsed: {exc}",
            location=str(hooks_path.relative_to(c.repo_root())),
        )]

    matcherless_events = {
        "UserPromptSubmit",
        "Stop",
        "TeammateIdle",
        "TaskCreated",
        "TaskCompleted",
        "WorktreeCreate",
        "WorktreeRemove",
        "CwdChanged",
    }
    hooks = data.get("hooks", {})
    if not isinstance(hooks, dict):
        return [c.Violation(
            code="HOOK_CONFIG_INVALID",
            message="hooks.json top-level `hooks` field is missing or not an object",
            location=str(hooks_path.relative_to(c.repo_root())),
        )]

    for event, entries in hooks.items():
        if not isinstance(entries, list):
            out.append(c.Violation(
                code="HOOK_EVENT_INVALID",
                message=f"hook event `{event}` must be a list",
                location=str(hooks_path.relative_to(c.repo_root())),
            ))
            continue
        for entry_idx, entry in enumerate(entries, start=1):
            if event in matcherless_events and "matcher" in entry:
                out.append(c.Violation(
                    code="IGNORED_HOOK_MATCHER",
                    message=(
                        f"`{event}` entry {entry_idx} sets `matcher`, but "
                        "Claude Code ignores matchers for this event."
                    ),
                    location=str(hooks_path.relative_to(c.repo_root())),
                ))
            for hook_idx, hook in enumerate(entry.get("hooks", []), start=1):
                if hook.get("type") != "command":
                    continue
                command = hook.get("command")
                if not isinstance(command, str):
                    out.append(c.Violation(
                        code="HOOK_COMMAND_INVALID",
                        message=f"`{event}` entry {entry_idx} hook {hook_idx} has no command string",
                        location=str(hooks_path.relative_to(c.repo_root())),
                    ))
                    continue
                if not command.startswith("${CLAUDE_PLUGIN_ROOT}/"):
                    continue
                rel_command = command.removeprefix("${CLAUDE_PLUGIN_ROOT}/")
                path = c.plugin_root() / rel_command
                if not path.exists():
                    out.append(c.Violation(
                        code="HOOK_SCRIPT_MISSING",
                        message=f"hook command `{command}` points at a missing file",
                        location=str(hooks_path.relative_to(c.repo_root())),
                    ))
                    continue
                if not os.access(path, os.X_OK):
                    out.append(c.Violation(
                        code="HOOK_SCRIPT_NOT_EXECUTABLE",
                        message=f"hook command `{command}` is not executable",
                        location=str(path.relative_to(c.repo_root())),
                    ))
    return out


def check_doctor_hard_gates() -> list[c.Violation]:
    """Doctor must not drift back to soft-greening agent-team failures."""
    out: list[c.Violation] = []
    path = c.plugin_root() / "commands" / "kiln-doctor.md"
    text = c.read_text(path)
    required_markers = {
        "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "agent-team experimental flag check",
        "TeamCreate": "TeamCreate declaration check",
        "TeamDelete": "TeamDelete declaration check",
        "SendMessage": "SendMessage declaration check",
        "TaskCreate": "TaskCreate declaration check",
        "TaskGet": "TaskGet declaration check",
        "TaskList": "TaskList declaration check",
        "TaskUpdate": "TaskUpdate declaration check",
        "validate-state.py": "critical state validator check",
        "task-dag-guard.py": "task DAG hook check",
        "dangerously-skip-permissions": "unsafe permission posture check",
        "BLOCKED_BROWSER_VALIDATION_MISSING": "browser validation missing status",
        "PARTIAL_PASS_STATIC_ONLY": "static-only browser status",
        "[FAIL] Agent teams flag": "hard fail for missing team flag",
        "Runtime tool availability": "runtime tool introspection limitation",
    }
    for marker, label in required_markers.items():
        if marker not in text:
            out.append(c.Violation(
                code="DOCTOR_GATE_MISSING",
                message=f"kiln-doctor.md missing {label} marker `{marker}`",
                location=str(path.relative_to(c.repo_root())),
            ))
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


# ── Invariant 16 — Watchdog polling retired (P2 — TeammateIdle) ────

_WATCHDOG_PROSE_PATTERNS = [
    r"Watchdog Protocol",
    r"idle_notification",
    r"health check opportunity",
    r"Stagnation rule",
    r"idle-ping",
    r"ping them",
]


def check_watchdog_retired() -> list[c.Violation]:
    """P2 (TeammateIdle + detached watchdog) retirement target: the
    kiln-pipeline SKILL.md § 5 "Non-interactive steps — Watchdog
    Protocol" block (lines ~279-291 pre-retirement) and any agent-body
    idle-ping directives. Self-recovery is native — the `TeammateIdle`
    hook feeds `activity.json`, `watchdog-loop.sh` detects stalls, and
    `nudge-inject.sh` wakes the engine without operator intervention.
    Manual polling prose is obsolete.

    Pattern anchors chosen to match the actual § 5 vocabulary:
    "Watchdog Protocol" (§5 heading), "idle_notification" (the event
    name repeated through the section), "health check opportunity"
    (§5 opening phrase), "Stagnation rule" (§5 subheading). The
    `idle-ping` / `ping them` patterns catch any agent-body directives
    that followed the same manual-polling pattern.

    One violation per file (break after the first matching pattern) so
    a file with multiple retired phrases surfaces as a single finding
    rather than drowning the report. While `WATCHDOG_RETIRED_WARN_ONLY`
    is True (the `adopt-first, retire-later` discipline — p2-11 flips
    it) findings print but do not fail the harness.
    """
    out: list[c.Violation] = []

    compiled = [re.compile(p, re.IGNORECASE) for p in _WATCHDOG_PROSE_PATTERNS]

    sources: list[tuple[str, Path]] = []
    for p in sorted(c.agents_dir().glob("*.md")):
        sources.append((f"plugins/kiln/agents/{p.name}", p))
    sources.append(
        ("plugins/kiln/skills/kiln-pipeline/SKILL.md", c.engine_skill())
    )
    sources.append(
        ("plugins/kiln/skills/kiln-protocol/SKILL.md", c.protocol_skill())
    )

    for label, path in sources:
        if not path.exists():
            continue
        text = c.read_text(path)
        for pattern in compiled:
            if pattern.search(text):
                out.append(c.Violation(
                    code="WATCHDOG_PROSE_LIVE",
                    message=(
                        f"{label} carries manual-watchdog / idle-ping prose "
                        f"matching pattern `{pattern.pattern}`. P2 retires "
                        "manual polling in favour of the detached watchdog "
                        "+ TeammateIdle hook; remove the prose in p2-11."
                    ),
                    location=label,
                ))
                break

    if WATCHDOG_RETIRED_WARN_ONLY:
        if out:
            print(f"  ! {len(out)} WATCHDOG_PROSE_LIVE findings (warn-only until p2-11):")
            for v in out:
                print(f"    {v}")
        return []
    return out


# ── Invariant 17 — activity.json schema completeness (P2) ─────────

_ACTIVITY_JSON_FIELDS = [
    "last_activity_ts",
    "last_activity_source",
    "active_teammates",
    "last_nudge_ts",
    "nudge_count",
    "epoch",
    "pipeline_phase",
]


def check_activity_json_schema() -> list[c.Violation]:
    """P2 aggregation layer: the hook that seeds `.kiln/tmp/activity.json`
    must touch all 7 authoritative fields so the watchdog never reads a
    half-built record. The state file's schema is documented in the
    activity-update.sh header; the check here is the static mirror.

    Detection scope: the canonical schema seeder — the .sh that
    mentions `activity.json` AND contains the two anchor assignments
    `.last_activity_ts = ` + `.last_activity_source = ` from the full-
    write jq pipeline. That pair uniquely identifies activity-update.sh
    today and would match any future hook that takes over the full-
    seed role.

    Partial updaters like deadlock-check.sh — which mutate a subset
    (nudge_count / last_nudge_ts / epoch) and preserve the rest via
    `jq <<< $EXISTING` — are intentionally out of scope: their
    contract is "don't lose fields the seeder wrote", not "restate the
    whole schema on every write". A broader `jq`-based discriminator
    would flag them with false positives for fields they correctly
    preserve-by-merge.
    """
    out: list[c.Violation] = []

    for path in sorted(c.hooks_dir().glob("*.sh")):
        text = c.read_text(path)
        if "activity.json" not in text:
            continue
        has_seed_write = (
            ".last_activity_ts = " in text
            and ".last_activity_source = " in text
        )
        if not has_seed_write:
            continue

        rel = f"plugins/kiln/hooks/{path.name}"
        for field in _ACTIVITY_JSON_FIELDS:
            if field not in text:
                out.append(c.Violation(
                    code="ACTIVITY_JSON_FIELD_MISSING",
                    message=(
                        f"{rel} seeds activity.json but does not reference "
                        f"required field `{field}`. The P2 schema requires "
                        "all 7 fields on the full-write path so the watchdog "
                        "never reads a half-built record."
                    ),
                    location=rel,
                ))
    return out


# ── Invariant 18 — P2 hooks gate on active Kiln pipeline ──────────

# Two P2 hooks are intentionally gate-free; file-existence still
# applies. The exemption set keeps the rationale discoverable so a
# future reader doesn't re-add gates and break the design:
#   - session-cleanup.sh: SessionEnd must run regardless of stage —
#     pipeline-complete and mid-pipeline exits BOTH need cleanup, and
#     gating would leak state on abort (header in the script explains).
#   - watchdog-loop.sh: pure orchestration (sleep → deadlock-check →
#     check exit). The gate lives in deadlock-check.sh which this loop
#     invokes every 60s; duplicating it here would be code-for-lint.
_P2_HOOK_NAMES = [
    "activity-update.sh",
    "spawn-watchdog.sh",
    "session-cleanup.sh",
    "watchdog-loop.sh",
    "deadlock-check.sh",
    "nudge-inject.sh",
]
_P2_HOOK_GATE_EXEMPT = {"session-cleanup.sh", "watchdog-loop.sh"}


def check_hooks_gate_on_kiln() -> list[c.Violation]:
    """P2 discipline: every P2 hook except those in `_P2_HOOK_GATE_EXEMPT`
    must gate on `.kiln/STATE.md` existing AND stage != `complete`.
    This is the fail-open pattern shared with enforce-pipeline.sh /
    stop-guard.sh — zero overhead outside active Kiln pipelines,
    nothing blocks a non-Kiln session.

    Exemptions (file-existence still checked):
      - session-cleanup.sh: SessionEnd must always run regardless of
        stage. Gating would leak state on mid-pipeline abort (the exact
        scenario where a stale watchdog + stale activity.json cause the
        zombie-and-false-alarm pattern the spike flagged).
      - watchdog-loop.sh: delegates the gate to deadlock-check.sh,
        which it invokes every 60s. Duplicating the gate in the loop
        body would be code-for-lint — the gate already exists one
        frame down the call graph.

    Three distinct violation codes so a regression surfaces with the
    right fix direction:
      MISSING              — script not present (partial deployment)
      MISSING_STATE_GATE   — script runs but doesn't check for STATE.md
      MISSING_COMPLETE_GATE — script runs on completed pipelines
    """
    out: list[c.Violation] = []

    for name in _P2_HOOK_NAMES:
        path = c.hooks_dir() / name
        rel = f"plugins/kiln/hooks/{name}"
        if not path.exists():
            out.append(c.Violation(
                code="P2_HOOK_MISSING",
                message=f"P2 hook `{name}` is not present in plugins/kiln/hooks/.",
                location=rel,
            ))
            continue
        if name in _P2_HOOK_GATE_EXEMPT:
            continue
        text = c.read_text(path)
        if "STATE.md" not in text:
            out.append(c.Violation(
                code="P2_HOOK_MISSING_STATE_GATE",
                message=(
                    f"{rel} does not reference `STATE.md` — P2 hooks must "
                    "gate on `.kiln/STATE.md` existence so they no-op "
                    "outside an active Kiln pipeline."
                ),
                location=rel,
            ))
        if "complete" not in text:
            out.append(c.Violation(
                code="P2_HOOK_MISSING_COMPLETE_GATE",
                message=(
                    f"{rel} has no reference to `complete` — P2 hooks must "
                    "skip when the pipeline stage is `complete` so "
                    "post-pipeline sessions don't trigger deadlock logic."
                ),
                location=rel,
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
    ("Hook config integrity", check_hook_config_integrity),
    ("Doctor hard gates", check_doctor_hard_gates),
    ("Watchdog polling retired (P2 — TeammateIdle)", check_watchdog_retired),
    ("activity.json schema completeness (P2)", check_activity_json_schema),
    ("P2 hooks gate on active Kiln pipeline", check_hooks_gate_on_kiln),
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
