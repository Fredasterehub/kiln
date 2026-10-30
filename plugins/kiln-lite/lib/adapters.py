"""Exact headless CLI argument and receipt contracts. No shell interpolation."""
import json

CLAUDE_UNSET = (
    "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY", "ANTHROPIC_BASE_URL",
    "ANTHROPIC_PROFILE", "ANTHROPIC_MODEL", "CLAUDE_CODE_EFFORT_LEVEL",
    "ANTHROPIC_SMALL_FAST_MODEL", "CLAUDE_CODE_SUBAGENT_MODEL",
    "CLAUDE_CODE_SUBAGENT_MODEL_FORCE",
)


def argv_for(route, cwd, call, card, packet, resume=None, run_home=None):
    cli, model, effort = (route[k] for k in ("cli", "model", "effort"))
    if cli == "codex":
        argv = ["codex", "exec"] + (["resume"] if resume else [])
        argv += ["-m", model, "-c", f'model_reasoning_effort="{effort}"']
        argv += (["-c", 'sandbox_mode="danger-full-access"', "-c", 'approval_policy="never"']
                 if resume else ["-s", "danger-full-access", "-C", str(cwd)])
        argv += ["--skip-git-repo-check", "--json", "-o", str(call / "final.md")]
        return argv + ([resume] if resume else []) + ["-"]
    if cli == "claude":
        argv = ["env"]
        for name in CLAUDE_UNSET:
            argv += ["-u", name]
        argv += ["ANTHROPIC_DEFAULT_HAIKU_MODEL=claude-sonnet-5-5",
                 "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1", "claude", "-p",
                 "--model", model, "--effort", effort, "--permission-mode", "bypassPermissions",
                 "--append-system-prompt-file", str(card), "--strict-mcp-config",
                 "--settings", '{"fallbackModel":[],"switchModelsOnFlag":false}',
                 "--output-format", "json", "--add-dir", str(run_home or call)]
        return argv + (["--resume", resume] if resume else [])
    if cli == "agy":
        argv = ["agy", "-p", packet, "--model", model, "--sandbox", "--disable-slash-commands",
                "--dangerously-skip-permissions", "--output-format", "json", "--print-timeout",
                f'{max(0, route["timeout_s"] - 60):g}s']
        return argv + (["--conversation", resume] if resume else [])
    raise ValueError(f"unsupported CLI: {cli}")


def parse_output(cli, raw):
    """Return final message, CLI completion, and observed metadata (never guessed)."""
    meta = dict(ids={}, cost=None, observed_model=None, usage=None)
    if cli == "codex":
        events = [json.loads(line) for line in raw.splitlines() if line.strip()]
        for event in events:
            if event.get("type") == "thread.started" and not meta["ids"]:
                meta["ids"]["thread_id"] = event["thread_id"]
            if event.get("type") == "turn.completed":
                meta["usage"] = event.get("usage")
        return None, bool(events and events[-1].get("type") == "turn.completed"), meta
    data = json.loads(raw)
    if cli == "claude":
        meta.update(ids={"session_id": data.get("session_id")}, cost=data.get("total_cost_usd"),
                    observed_model=next(iter(data.get("modelUsage", {})), None))
        for key in ("num_turns", "duration_ms", "usage", "modelUsage"):
            meta[key] = data.get(key)
        return data.get("result", ""), not data.get("is_error", False), meta
    meta.update(ids={"conversation_id": data.get("conversation_id")}, usage=data.get("usage"))
    return data.get("response", ""), data.get("status") == "SUCCESS", meta


def status_line(text):
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    last = lines[-1] if lines else ""
    kind, separator, value = last.partition(": ")
    if kind in ("done", "question", "blocked") and separator and value.strip():
        return kind, last
    return "unparsed", "unparsed"
