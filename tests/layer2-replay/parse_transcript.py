#!/usr/bin/env python3
"""parse_transcript.py — parse kilndev-style transcripts into event lists.

Input: a directory containing either
  - `thoth-timeline.md`, aggregated chronological log, OR
  - `breadcrumbs/*.md`, per-agent logs

Output: list of Event dicts, chronologically ordered:
  [
    {
      "timestamp": "06:10:11",
      "sender": "rakim",
      "signal": "READY",
      "payload": "codebase-state updated",
      "recipient": "krs-one",       # best-effort from breadcrumbs
      "source": "thoth-timeline.md:12",
    },
    ...
  ]

Run standalone:
  python3 parse_transcript.py /path/to/transcript-dir   # prints JSON
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass, asdict
from pathlib import Path


# thoth-timeline format: [HH:MM:SS] sender | SIGNAL | payload
TIMELINE_RE = re.compile(
    r'^\[(\d{2}:\d{2}:\d{2})\]\s+(\w[\w-]*)\s+\|\s+(\w+)\s+\|\s+(.+?)\s*$'
)

# Per-agent breadcrumb patterns:
#   [SENT] → recipient: SIGNAL: payload
#   [SENT] → recipient — SIGNAL: payload
#   SendMessage to recipient: SIGNAL
BREADCRUMB_SEND_RE = re.compile(
    r'\[SENT\][^→]*→\s+([\w-]+)[:\s—-]+([A-Z][A-Z0-9_]{2,})[:\s]+(.*)$'
)

# Frontmatter in breadcrumb files sometimes carries "agent:" key
BC_FRONTMATTER_AGENT_RE = re.compile(
    r'^agent:\s*([\w-]+)', re.MULTILINE
)


@dataclass
class Event:
    timestamp: str
    sender: str
    signal: str
    payload: str
    recipient: str = ""
    source: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


def parse_timeline(path: Path) -> list[Event]:
    """Parse thoth-timeline.md line-by-line."""
    out: list[Event] = []
    text = path.read_text(encoding="utf-8")
    for lineno, line in enumerate(text.split("\n"), 1):
        m = TIMELINE_RE.match(line)
        if not m:
            continue
        out.append(Event(
            timestamp=m.group(1),
            sender=m.group(2),
            signal=m.group(3),
            payload=m.group(4),
            source=f"{path.name}:{lineno}",
        ))
    return out


def parse_breadcrumb(path: Path) -> list[tuple[str, str, str]]:
    """Parse a single breadcrumb file for sends.

    Returns list of (sender, recipient, signal) — best-effort.
    Payload is not recovered here (we get it from timeline).
    """
    out: list[tuple[str, str, str]] = []
    text = path.read_text(encoding="utf-8")
    # Sender = agent field in frontmatter, or filename stem
    m = BC_FRONTMATTER_AGENT_RE.search(text)
    sender = m.group(1) if m else path.stem
    for line in text.split("\n"):
        m = BREADCRUMB_SEND_RE.search(line)
        if m:
            recipient = m.group(1)
            signal = m.group(2)
            out.append((sender, recipient, signal))
    return out


def parse_transcript(transcript_dir: Path) -> list[Event]:
    """Main entry — merge timeline + breadcrumbs into an event list."""
    events: list[Event] = []

    # 1. Parse thoth-timeline if present
    timeline = transcript_dir / "thoth-timeline.md"
    if not timeline.exists():
        # Try breadcrumbs/thoth-timeline.md
        timeline = transcript_dir / "breadcrumbs" / "thoth-timeline.md"
    if timeline.exists():
        events = parse_timeline(timeline)

    # 2. Parse breadcrumbs for recipient info
    breadcrumbs_dir = transcript_dir / "breadcrumbs"
    sends_by_sender_signal: dict[tuple[str, str], list[str]] = {}
    if breadcrumbs_dir.exists():
        for bc_path in breadcrumbs_dir.glob("*.md"):
            if bc_path.name == "thoth-timeline.md":
                continue
            for sender, recipient, signal in parse_breadcrumb(bc_path):
                sends_by_sender_signal.setdefault(
                    (sender, signal), []
                ).append(recipient)

    # 3. Fill in recipient on each timeline event, best-effort
    for e in events:
        key = (e.sender, e.signal)
        if key in sends_by_sender_signal and sends_by_sender_signal[key]:
            # Pop the first occurrence (chronological approximation)
            e.recipient = sends_by_sender_signal[key].pop(0)

    return events


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: parse_transcript.py <transcript-dir>", file=sys.stderr)
        return 1
    transcript = Path(sys.argv[1])
    if not transcript.is_dir():
        print(f"Not a directory: {transcript}", file=sys.stderr)
        return 1
    events = parse_transcript(transcript)
    print(json.dumps([e.to_dict() for e in events], indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
