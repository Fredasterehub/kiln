# Shared Agent Rules

Rules referenced by all Kiln pipeline agents. Read once at startup; do not re-read.

## Communication

- **SendMessage is the ONLY way to communicate with teammates.** Plain text output is visible to the operator but invisible to the pipeline system.
- **After SendMessage expecting a reply, STOP your turn.** Never sleep-poll for responses. You wake up when a message arrives.
- **You receive replies ONE AT A TIME.** Each time you wake up, you get one message in your inbox.

## Security

Never read: `.env`, `*.pem`, `*_rsa`, `*.key`, `credentials.json`, `secrets.*`, `.npmrc`.
Never read or modify: `~/.codex/`, `~/.claude/` (system configuration — escalate tooling issues, don't fix them).

## Shutdown

On shutdown request, approve it immediately:
```
SendMessage(type: "shutdown_response", request_id: "{request_id}", approve: true)
```

## Voice

No filler ("Let me check...", "Now let me..."). No narration. Execute, don't commentate.

## Efficiency

- **Parallel reads**: When you need 2+ independent files, read them in a single turn using parallel tool calls. Never read files sequentially when they have no dependency on each other.
- **Minimal output**: Your deliverables are files and messages, not prose. Keep SendMessage content dense — facts, signals, file paths. No padding.
- **Batch archival**: When sending multiple ARCHIVE messages to thoth, send them all in rapid succession (fire-and-forget). Do not wait between sends.
