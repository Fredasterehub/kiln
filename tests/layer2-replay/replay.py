#!/usr/bin/env python3
"""replay.py — driver: feed a scenario's events into MockEngine, assert decisions.

Scenario YAML shape:

  name: qa-tribunal-pass
  description: ...
  transcript: transcripts/kilndev-20260414-060726/  # optional — use transcript events
  engine-version: pre-centralization                 # pre-centralization | post-centralization
  events-inline:                                     # optional — for synthetic scenarios
    - {sender: rakim, signal: READY, recipient: team-lead, payload: "...", timestamp: "00:00:01"}
  assertions:
    - after-event: "krs-one | MILESTONE_QA_READY"
      expected-decisions:
        - type: spawn
          subagent_type: team-red
          name: ken

Scenario assertions match event text roughly (substring); decisions match
all fields, with `-contains` suffix meaning substring match.

Usage: python3 replay.py --scenario scenarios/qa-tribunal-pass.yaml
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import parse_transcript
import mock_engine


# ── Minimal YAML parser ───────────────────────────────────────────
# We intentionally avoid the pyyaml dependency. Our scenario YAML is
# simple: key:value pairs, nested mappings via indentation, lists via `- `.

def parse_scenario_yaml(text: str) -> dict:
    """Parse scenario YAML into nested dicts/lists. Minimal but sufficient."""
    lines = [l.rstrip() for l in text.split("\n") if l.strip() and not l.lstrip().startswith("#")]
    idx = [0]  # mutable

    def cur_indent() -> int:
        if idx[0] >= len(lines):
            return -1
        l = lines[idx[0]]
        return len(l) - len(l.lstrip())

    def parse_block(indent: int):
        """Parse a mapping or a list at the given indent level."""
        result = None
        while idx[0] < len(lines):
            ind = cur_indent()
            if ind < indent:
                break
            line = lines[idx[0]][indent:]

            if line.startswith("- "):
                if result is None:
                    result = []
                item_text = line[2:]
                idx[0] += 1
                # Check if next lines are deeper (nested block)
                if idx[0] < len(lines) and cur_indent() > indent:
                    # Item is a nested mapping; re-parse the key:value from
                    # this line and merge with the nested parse
                    if ":" in item_text:
                        key, val = item_text.split(":", 1)
                        val = val.strip()
                        nested = parse_block(cur_indent())
                        merged = {key.strip(): _atom(val) if val else nested}
                        if val and nested:
                            # shouldn't normally happen
                            merged.update(nested)
                        if not val:
                            merged = nested
                            merged[key.strip()] = merged.pop(key.strip(), None) or nested.pop(key.strip(), None)
                        # Actually simpler: start a fresh dict with the inline
                        # key:val, then merge nested
                        item_dict = {}
                        if val:
                            item_dict[key.strip()] = _atom(val)
                        item_dict.update(nested)
                        result.append(item_dict)
                    else:
                        # plain nested block (mapping without inline key)
                        nested = parse_block(cur_indent())
                        result.append(nested)
                else:
                    # scalar list item or inline mapping {k:v, k:v}
                    result.append(_parse_inline(item_text))
            elif ":" in line:
                if result is None:
                    result = {}
                key, val = line.split(":", 1)
                val = val.strip()
                key = key.strip()
                idx[0] += 1
                if not val and idx[0] < len(lines) and cur_indent() > indent:
                    # nested block
                    result[key] = parse_block(cur_indent())
                else:
                    result[key] = _atom(val)
            else:
                # unexpected line
                idx[0] += 1
        return result if result is not None else {}

    out = parse_block(0)
    return out if isinstance(out, dict) else {"_root": out}


def _atom(val: str):
    """Convert a scalar string to int/bool/list/dict or strip quotes."""
    if val == "":
        return ""
    val_s = val.strip()
    # Inline empty or non-empty list: [] or [a, b, c]
    if val_s.startswith("[") and val_s.endswith("]"):
        inner = val_s[1:-1].strip()
        if not inner:
            return []
        return [_atom(x.strip()) for x in _split_commas(inner)]
    # Inline dict: {k: v, k: v}
    if val_s.startswith("{") and val_s.endswith("}"):
        return _parse_inline(val_s)
    if val_s.lower() in ("true", "yes"):
        return True
    if val_s.lower() in ("false", "no"):
        return False
    if len(val_s) >= 2 and val_s[0] == val_s[-1] and val_s[0] in ('"', "'"):
        return val_s[1:-1]
    try:
        return int(val_s)
    except ValueError:
        pass
    return val_s


def _parse_inline(text: str):
    """Parse inline {k: v, k: v} or a plain scalar."""
    text = text.strip()
    if text.startswith("{") and text.endswith("}"):
        inner = text[1:-1]
        out = {}
        # Split on commas not inside brackets/quotes
        parts = _split_commas(inner)
        for p in parts:
            if ":" in p:
                k, v = p.split(":", 1)
                out[k.strip()] = _atom(v.strip())
        return out
    return _atom(text)


def _split_commas(s: str) -> list[str]:
    parts = []
    depth = 0
    buf = []
    quote = None
    for ch in s:
        if quote:
            buf.append(ch)
            if ch == quote:
                quote = None
            continue
        if ch in ('"', "'"):
            quote = ch
            buf.append(ch)
            continue
        if ch in "{[(":
            depth += 1
        elif ch in "}])":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append("".join(buf).strip())
            buf = []
        else:
            buf.append(ch)
    if buf:
        parts.append("".join(buf).strip())
    return parts


# ── Scenario runner ───────────────────────────────────────────────

def normalize_event(ev: dict) -> dict:
    """Ensure event has all expected keys."""
    return {
        "timestamp": ev.get("timestamp", ""),
        "sender": ev.get("sender", ""),
        "signal": ev.get("signal", ""),
        "payload": ev.get("payload", ""),
        "recipient": ev.get("recipient", ""),
        "source": ev.get("source", "inline"),
    }


def event_matches_marker(event: dict, marker: str) -> bool:
    """Marker format:
      - 'sender | SIGNAL'                 — 2 parts (most common).
      - 'sender | SIGNAL | disambiguator' — 3 parts; third token is a
         substring match against the event's payload. Needed when the
         same sender+signal pair fires multiple times in a stream
         (e.g. two `platform | SubagentStart` events keyed on agent_type).
      - bare signal substring otherwise.
    """
    parts = [p.strip() for p in marker.split("|")]
    if len(parts) >= 2:
        sender, sig = parts[0], parts[1]
        if event["sender"] != sender:
            return False
        if event["signal"].upper() != sig.upper():
            return False
        if len(parts) == 3:
            return parts[2] in str(event.get("payload", ""))
        return True
    return marker.lower() in event["signal"].lower()


def run_scenario(scenario_path: Path) -> int:
    """Run a scenario. Return 0 on pass, 1 on fail."""
    raw = scenario_path.read_text(encoding="utf-8")
    scenario = parse_scenario_yaml(raw)

    name = scenario.get("name", scenario_path.stem)
    version = scenario.get("engine-version", "pre-centralization")
    print(f"  → {name} (engine: {version})")

    # Resolve events
    events: list[dict] = []
    if scenario.get("events-inline"):
        for raw_ev in scenario["events-inline"]:
            events.append(normalize_event(raw_ev))
    elif scenario.get("transcript"):
        here = scenario_path.parent
        transcript_dir = here / scenario["transcript"]
        if not transcript_dir.is_dir():
            # try absolute
            transcript_dir = Path(scenario["transcript"])
        if not transcript_dir.is_dir():
            print(f"    ✗ transcript directory not found: {scenario['transcript']}")
            return 1
        parsed = parse_transcript.parse_transcript(transcript_dir)
        events = [normalize_event(e.to_dict()) for e in parsed]
    else:
        print(f"    ? no events (inline or transcript) — skipping")
        return 0

    engine = mock_engine.MockEngine(engine_version=version)

    # Run events, collecting decisions per event
    per_event_decisions: list[list[mock_engine.EngineDecision]] = []
    for ev in events:
        decs = engine.handle(ev)
        per_event_decisions.append(decs)

    # Run assertions
    assertions = scenario.get("assertions", []) or []
    fails = 0
    for assertion in assertions:
        marker = assertion.get("after-event", "")
        expected_decs = assertion.get("expected-decisions", []) or []
        # Find the first event that matches marker (after any previous match)
        matched_event_idx = None
        for i, ev in enumerate(events):
            if event_matches_marker(ev, marker):
                matched_event_idx = i
                break
        if matched_event_idx is None:
            print(f"    ✗ [{marker}] event not found in stream")
            fails += 1
            continue
        observed = per_event_decisions[matched_event_idx]
        # `strict: true` locks the assertion to decisions observed on the
        # matched event only — needed when the same sender+signal pair
        # fires multiple times in one stream (e.g. two SubagentStart
        # events, one per spawned worker) and cross-event fallback would
        # let one event's decision satisfy another's assertion.
        strict = bool(assertion.get("strict", False))
        for expected in expected_decs:
            if any(d.matches(expected) for d in observed):
                continue
            if not strict:
                cross = [d for decs in per_event_decisions for d in decs]
                if any(d.matches(expected) for d in cross):
                    continue
            print(f"    ✗ [{marker}] expected decision not observed: {expected}")
            if observed:
                print(f"       observed: {[str(d) for d in observed]}")
            fails += 1

        # Strict regression guard — any decision listed under
        # `forbidden-decisions` for this marker MUST NOT appear in any
        # event's observed decisions for the entire scenario. Used to
        # lock in "engine should have stopped doing X" contracts.
        for forbidden in assertion.get("forbidden-decisions", []) or []:
            cross = [d for decs in per_event_decisions for d in decs]
            offenders = [d for d in cross if d.matches(forbidden)]
            if offenders:
                print(
                    f"    ✗ [{marker}] forbidden decision observed: {forbidden}"
                )
                for off in offenders:
                    print(f"       offender: {off}")
                fails += 1

    if fails == 0:
        print(f"    ✓ {name} ({len(assertions)} assertions)")
        return 0
    else:
        print(f"    ✗ {name} ({fails}/{len(assertions)} failed)")
        return 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenario", required=True, type=Path)
    args = ap.parse_args()
    if not args.scenario.exists():
        print(f"Scenario not found: {args.scenario}", file=sys.stderr)
        return 2
    return run_scenario(args.scenario)


if __name__ == "__main__":
    sys.exit(main())
