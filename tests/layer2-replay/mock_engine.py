#!/usr/bin/env python3
"""mock_engine.py — deterministic Python mirror of the Kiln engine state machine.

Encodes the handling rules from plugins/kiln/skills/kiln-pipeline/SKILL.md
as Python code instead of prompt logic. Feeds on events from
parse_transcript.py and returns a list of EngineDecision objects per event.

Versioned handlers: set `engine_version` to 'pre-centralization' (current v1.3.0)
or 'post-centralization' (Wave 2 target). This lets replay compare the two
before/after a refactor.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any


# ── Decision types ────────────────────────────────────────────────

@dataclass
class EngineDecision:
    """What the engine would do in response to an event."""
    type: str                           # spawn, shutdown, send, write_file, transition, warn, noop
    details: dict[str, Any] = field(default_factory=dict)

    def matches(self, expected: dict[str, Any]) -> bool:
        """True if this decision matches an expected assertion block."""
        if expected.get("type") != self.type:
            return False
        for key, want in expected.items():
            if key == "type":
                continue
            got = self.details.get(key, "")
            if key.endswith("-contains"):
                field_name = key[:-len("-contains")]
                got = self.details.get(field_name, "")
                if want not in str(got):
                    return False
            else:
                if str(got) != str(want):
                    return False
        return True

    def __str__(self) -> str:
        return f"{self.type}({self.details})"


# ── Event shape ───────────────────────────────────────────────────

def canonical_signal(s: str) -> str:
    return s.strip().upper()


# ── Scenario → pair mapping (Build step) ──────────────────────────

BUILD_SCENARIO_PAIRS = {
    "default":  ("dial-a-coder", "critical-drinker"),
    "fallback": ("backup-coder", "critical-drinker"),
    "ui":       ("la-peintresse", "the-curator"),
}


# ── Cycle workers payload parser ──────────────────────────────────

CYCLE_KV_RE = re.compile(r'(\w+)=([^,\s]+)')


def parse_kv_payload(payload: str) -> dict[str, str]:
    """Parse 'key=value, key=value' payload into dict."""
    return {m.group(1): m.group(2) for m in CYCLE_KV_RE.finditer(payload)}


# ── MockEngine ────────────────────────────────────────────────────

class MockEngine:
    """State machine mirror of kiln-pipeline SKILL.md."""

    def __init__(self, engine_version: str = "pre-centralization"):
        self.version = engine_version
        self.stage: str = "build"
        self.build_iteration: int = 0
        self.milestones_complete: int = 0
        self.milestone_count: int = 1
        self.correction_cycle: int = 0
        self.active_agents: set[str] = set()
        self.wait_set: set[str] = set()   # agents engine is awaiting
        self.qa_reports_seen: set[str] = set()  # senders of QA_REPORT_READY
        self.qa_active: bool = False
        self.current_milestone: str = "M1"
        self.warnings: list[str] = []
        self.decisions_log: list[EngineDecision] = []

    # ── dispatch ──

    def handle(self, event: dict[str, Any]) -> list[EngineDecision]:
        """Return the engine decisions produced for this event."""
        sig = canonical_signal(event.get("signal", ""))
        handler = self._dispatch_table().get(sig, self._on_unknown)
        decisions = handler(event) or []
        self.decisions_log.extend(decisions)
        return decisions

    def _dispatch_table(self) -> dict[str, Any]:
        return {
            "READY": self._on_ready,
            "REQUEST_WORKERS": self._on_request_workers,
            "CYCLE_WORKERS": self._on_cycle_workers,
            "WORKER_READY": self._on_worker_ready,
            "ITERATION_COMPLETE": self._on_iteration_complete_legacy,
            "ITERATION_UPDATE": self._on_iteration_update,
            "MILESTONE_TRANSITION": self._on_milestone_transition,
            "MILESTONE_QA_READY": self._on_milestone_qa_ready,
            "QA_REPORT_READY": self._on_qa_report_ready,
            "RECONCILIATION_COMPLETE": self._on_reconciliation_complete,
            "RECONCILIATION_READY": self._on_reconciliation_ready_legacy,  # Wave 1 retired name
            "READY_BOOTSTRAP": self._on_ready_bootstrap,  # Wave 2: distinct from post-iteration READY
            "QA_PASS": self._on_qa_verdict,
            "QA_FAIL": self._on_qa_verdict,
            "MILESTONE_COMPLETE": self._on_milestone_complete,
            "BUILD_COMPLETE": self._on_build_complete,
            "VALIDATE_PASS": self._on_validate_pass,
            "VALIDATE_FAILED": self._on_validate_failed,
            "IMPLEMENTATION_COMPLETE": self._on_implementation_complete,
            "IMPLEMENTATION_BLOCKED": self._on_implementation_blocked,
            "IMPLEMENTATION_APPROVED": self._on_implementation_approved,  # Wave 3 signal
            "REVIEW_REQUEST": self._on_noop,
            "APPROVED": self._on_approved,
            "REJECTED": self._on_noop,
            "BLOCKED": self._on_blocked,
            "PLAN_BLOCKED": self._on_plan_blocked,
            "ONBOARDING_COMPLETE": self._on_terminal_step,
            "BRAINSTORM_COMPLETE": self._on_terminal_step,
            "RESEARCH_COMPLETE": self._on_terminal_step,
            "ARCHITECTURE_COMPLETE": self._on_terminal_step,
            "REPORT_COMPLETE": self._on_terminal_step,
        }

    # ── handlers ──

    def _on_ready(self, event):
        """PM post-iteration reply to ITERATION_UPDATE or MILESTONE_TRANSITION.

        Pre-centralization: legacy code accepted READY for both bootstrap
        and iteration-ack. The ambiguity was C9 — if bootstrap READY went
        to team-lead and ack READY went to krs-one, agents routinely
        misrouted the second one. Wave 2 splits bootstrap off as
        READY_BOOTSTRAP (see _on_ready_bootstrap), so plain READY is now
        exclusively the post-iteration reply bound to krs-one.
        """
        recipient = event.get("recipient", "")
        sender = event.get("sender", "")

        if self.version == "pre-centralization":
            # Pre-centralization C9 regression heuristic: a plain READY
            # should reach krs-one after bootstrap. If a PM still sends
            # READY to team-lead, flag it — that's the rakim deadlock.
            if sender in {"rakim", "sentinel", "numerobis", "thoth"}:
                if recipient == "team-lead":
                    key = f"booted:{sender}"
                    if key in self.active_agents:
                        return [EngineDecision(
                            type="warn",
                            details={
                                "reason": "ITERATION_UPDATE reply misrouted",
                                "sender": sender,
                                "routed_to": "team-lead",
                                "expected": "krs-one",
                                "note": "C9 regression risk — READY to team-lead after bootstrap",
                            },
                        )]
                    # First-time PM READY to team-lead: legacy bootstrap path.
                    self.active_agents.add(key)
                    return [EngineDecision(
                        type="pm_ready",
                        details={"sender": sender, "stage": "bootstrap-legacy"},
                    )]
                elif recipient == "krs-one":
                    return [EngineDecision(
                        type="pm_ready",
                        details={"sender": sender, "stage": "iteration-ack"},
                    )]
            return []

        # post-centralization — READY must go to krs-one
        if sender in {"rakim", "sentinel", "numerobis", "thoth"} and recipient != "krs-one":
            return [EngineDecision(
                type="warn",
                details={
                    "code": "MISROUTED_READY",
                    "sender": sender,
                    "routed_to": recipient,
                    "expected": "krs-one",
                    "note": "Wave 2 centralisation: post-iteration READY must target krs-one",
                },
            )]
        return [EngineDecision(
            type="pm_ready",
            details={"sender": sender, "recipient": recipient, "stage": "iteration-ack"},
        )]

    def _on_ready_bootstrap(self, event):
        """PM one-time bootstrap signal — Wave 2 distinct name fixes C9.

        READY_BOOTSTRAP is the PM's first signal at milestone start and
        MUST target team-lead (the engine needs to know the PM is live
        before KRS-One starts dispatching). Flag any misroute.
        """
        sender = event.get("sender", "")
        recipient = event.get("recipient", "")
        if recipient != "team-lead":
            return [EngineDecision(
                type="warn",
                details={
                    "code": "MISROUTED_BOOTSTRAP",
                    "sender": sender,
                    "routed_to": recipient,
                    "expected": "team-lead",
                    "note": "READY_BOOTSTRAP is the engine-facing bootstrap signal",
                },
            )]
        self.active_agents.add(f"booted:{sender}")
        return [EngineDecision(
            type="pm_ready",
            details={"sender": sender, "stage": "bootstrap"},
        )]

    def _on_worker_ready(self, event):
        return [EngineDecision(
            type="worker_announce",
            details={"sender": event.get("sender", "")},
        )]

    def _on_request_workers(self, event):
        """Parse payload, spawn listed workers, respond WORKERS_SPAWNED."""
        payload = event.get("payload", "")
        # Match: name (subagent_type: foo), name (subagent_type: bar)
        spawn_pattern = re.compile(
            r'(\w[\w-]*)\s*\(subagent_type:\s*(?:kiln:)?([\w-]+)\)'
        )
        pairs = [(m.group(1), m.group(2)) for m in spawn_pattern.finditer(payload)]
        decisions: list[EngineDecision] = []
        for name, subtype in pairs:
            decisions.append(EngineDecision(
                type="spawn",
                details={"name": name, "subagent_type": subtype},
            ))
            self.active_agents.add(name)
        decisions.append(EngineDecision(
            type="send",
            details={
                "recipient": event.get("sender", ""),
                "signal": "WORKERS_SPAWNED",
                "content": "awaiting assignment",
            },
        ))
        return decisions

    def _on_cycle_workers(self, event):
        """KRS-One requests fresh worker pair."""
        payload = event.get("payload", "")
        kv = parse_kv_payload(payload)
        scenario = kv.get("scenario", "")
        coder = kv.get("coder_name", kv.get("coder", ""))
        reviewer = kv.get("reviewer_name", kv.get("reviewer", ""))

        decisions: list[EngineDecision] = []

        if scenario not in BUILD_SCENARIO_PAIRS:
            decisions.append(EngineDecision(
                type="send",
                details={
                    "recipient": event.get("sender", "krs-one"),
                    "signal": "CYCLE_REJECTED",
                    "content": f"Unknown scenario '{scenario}'",
                },
            ))
            return decisions

        builder_type, reviewer_type = BUILD_SCENARIO_PAIRS[scenario]

        # Shutdown existing workers
        existing = {a for a in self.active_agents if self._is_worker(a)}
        for a in existing:
            decisions.append(EngineDecision(
                type="shutdown",
                details={"target": a},
            ))
            self.active_agents.discard(a)

        # Spawn fresh pair
        if coder:
            decisions.append(EngineDecision(
                type="spawn",
                details={"name": coder, "subagent_type": builder_type},
            ))
            self.active_agents.add(coder)
        if reviewer:
            decisions.append(EngineDecision(
                type="spawn",
                details={"name": reviewer, "subagent_type": reviewer_type},
            ))
            self.active_agents.add(reviewer)

        # Confirm to boss
        decisions.append(EngineDecision(
            type="send",
            details={
                "recipient": event.get("sender", "krs-one"),
                "signal": "WORKERS_SPAWNED",
                "content": "duo_id",
            },
        ))
        self.build_iteration += 1
        return decisions

    def _is_worker(self, name: str) -> bool:
        """Best-effort: duo-pool spawn names = workers."""
        worker_names = {
            "tintin", "milou", "mario", "luigi", "lucky", "luke",
            "codex", "sphinx", "kaneda", "tetsuo", "daft", "punk",
            "clair", "obscur", "yin", "yang", "athos", "porthos",
        }
        return name in worker_names

    def _on_iteration_complete_legacy(self, event):
        """Legacy/internal — engine warns, increments iteration."""
        return [EngineDecision(
            type="warn",
            details={
                "reason": "ITERATION_COMPLETE is legacy — krs-one should use CYCLE_WORKERS",
            },
        )]

    def _on_iteration_update(self, event):
        """Boss → PM. Engine doesn't route; boss blocks waiting for READY."""
        return []

    def _on_milestone_transition(self, event):
        return []

    def _on_milestone_qa_ready(self, event):
        """Engine orchestrates QA tribunal: spawn ken + ryu in parallel."""
        self.qa_active = True
        self.qa_reports_seen.clear()
        decisions = [
            EngineDecision(type="spawn", details={
                "name": "ken", "subagent_type": "team-red",
            }),
            EngineDecision(type="spawn", details={
                "name": "ryu", "subagent_type": "team-blue",
            }),
        ]
        self.active_agents.update({"ken", "ryu"})
        return decisions

    def _on_qa_report_ready(self, event):
        """When both ken and ryu have emitted, spawn denzel.

        Wave 2 self-anonymization: ken and ryu already wrote directly to
        qa-report-a.md / qa-report-b.md using the slot assignment they
        received in their spawn prompt. The engine no longer performs a
        post-hoc anonymization step (no write_file decision) — emitting
        one now would be a regression back toward the legacy contract.
        """
        sender = event.get("sender", "")
        self.qa_reports_seen.add(sender)
        if {"ken", "ryu"} <= self.qa_reports_seen:
            decisions = [
                EngineDecision(type="spawn", details={
                    "name": "denzel", "subagent_type": "the-negotiator",
                }),
            ]
            self.active_agents.add("denzel")
            return decisions
        return []

    def _on_reconciliation_complete(self, event):
        """Spawn judge-dredd to deliver final verdict."""
        decisions = [
            EngineDecision(type="spawn", details={
                "name": "judge-dredd", "subagent_type": "i-am-the-law",
            }),
        ]
        self.active_agents.add("judge-dredd")
        return decisions

    def _on_reconciliation_ready_legacy(self, event):
        """Wave 1 retired the RECONCILIATION_READY name in favour of
        RECONCILIATION_COMPLETE (C1/H2). Accept the old name via
        malformed-signal recovery but emit a WARN decision so regression
        tests catch the drift — and so real runs leave a breadcrumb.
        """
        sender = event.get("sender", "?")
        warn = EngineDecision(type="warn", details={
            "code": "LEGACY_SIGNAL",
            "signal": "RECONCILIATION_READY",
            "canonical": "RECONCILIATION_COMPLETE",
            "sender": sender,
            "reason": (
                "RECONCILIATION_READY was retired in Wave 1 of "
                "PLUMBING-AUDIT-v1.3.0. Use RECONCILIATION_COMPLETE. "
                "This run recovered via alias; flag the sender."
            ),
        })
        self.warnings.append(f"legacy RECONCILIATION_READY from {sender}")
        decisions = [warn] + self._on_reconciliation_complete(event)
        return decisions

    def _on_qa_verdict(self, event):
        """judge-dredd emitted QA_PASS or QA_FAIL. Relay to krs-one.

        Pre-centralization: engine relays as QA_VERDICT.
        Post-centralization: judge-dredd signals krs-one directly, no relay.
        """
        verdict = "PASS" if event.get("signal", "").upper() == "QA_PASS" else "FAIL"
        decisions: list[EngineDecision] = []

        # Shutdown QA agents
        for qa in ["ken", "ryu", "denzel", "judge-dredd"]:
            if qa in self.active_agents:
                decisions.append(EngineDecision(type="shutdown", details={"target": qa}))
                self.active_agents.discard(qa)

        if self.version == "pre-centralization":
            decisions.append(EngineDecision(
                type="send",
                details={
                    "recipient": "krs-one",
                    "signal": "QA_VERDICT",
                    "content": verdict,
                },
            ))
        else:
            # post-centralization: boss already received QA_PASS/QA_FAIL
            # directly from judge-dredd; engine just shuts down agents.
            pass

        self.qa_active = False
        return decisions

    def _on_milestone_complete(self, event):
        self.milestones_complete += 1
        decisions = [EngineDecision(type="transition", details={
            "milestones_complete": self.milestones_complete,
        })]
        return decisions

    def _on_build_complete(self, event):
        self.stage = "validate"
        return [EngineDecision(type="transition", details={"to_stage": "validate"})]

    def _on_validate_pass(self, event):
        self.stage = "report"
        return [EngineDecision(type="transition", details={"to_stage": "report"})]

    def _on_validate_failed(self, event):
        self.correction_cycle += 1
        if self.correction_cycle < 3:
            return [EngineDecision(type="transition", details={
                "to_stage": "build",
                "correction_cycle": self.correction_cycle,
            })]
        return [EngineDecision(type="warn", details={
            "reason": "correction_cycle >= 3 — halt",
        })]

    def _on_implementation_complete(self, event):
        """Builder → krs-one. Engine doesn't route but can detect drops."""
        return []

    def _on_implementation_blocked(self, event):
        return []

    def _on_implementation_approved(self, event):
        """Wave 3 signal — reviewer → krs-one directly on APPROVED."""
        if self.version == "post-centralization":
            return []
        return [EngineDecision(type="warn", details={
            "reason": "IMPLEMENTATION_APPROVED is a post-centralization signal",
        })]

    def _on_approved(self, event):
        """Reviewer → Builder. Neutral for engine."""
        return []

    def _on_blocked(self, event):
        return [EngineDecision(type="warn", details={
            "reason": "agent reports BLOCKED",
            "sender": event.get("sender", ""),
            "detail": event.get("payload", ""),
        })]

    def _on_plan_blocked(self, event):
        return [EngineDecision(type="transition", details={
            "to_stage": "halt",
            "reason": "architecture plan failed validation",
        })]

    def _on_terminal_step(self, event):
        return [EngineDecision(type="transition", details={
            "terminal": event.get("signal", ""),
        })]

    def _on_noop(self, event):
        return []

    def _on_unknown(self, event):
        sig = event.get("signal", "")
        return [EngineDecision(type="warn", details={
            "reason": f"unknown signal {sig}",
            "sender": event.get("sender", ""),
        })]
