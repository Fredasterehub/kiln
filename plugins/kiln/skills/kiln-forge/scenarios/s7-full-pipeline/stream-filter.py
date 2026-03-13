#!/usr/bin/env python3
"""Filter stream-json output into human-readable terminal output."""

import json
import re
import sys
import time

start = time.time()
agents = 0
tools = 0
tokens = 0
next_status_at = 50
session_initialized = False
current_stage = None
agent_names_by_tool_use_id = {}
tool_agent_names = {}
pending_lore_contexts = set()

STAGE_ORDER = {
    "onboarding": 1,
    "brainstorm": 2,
    "research": 3,
    "architecture": 4,
    "build": 5,
    "validate": 6,
    "report": 7,
    "complete": 8,
}


def elapsed():
    minutes, seconds = divmod(int(time.time() - start), 60)
    return f"{minutes:02d}:{seconds:02d}"


def truncate(value, limit=120):
    if not isinstance(value, str):
        try:
            value = json.dumps(value, ensure_ascii=False, sort_keys=True)
        except Exception:
            value = str(value)
    return value[:limit] + "..." if len(value) > limit else value


def token_label():
    return f"{tokens // 1000}k" if tokens >= 1000 else str(tokens)


def emit(text, limit=140):
    print(f"  [{elapsed()}]  {truncate(text, limit)}")


def emit_raw(raw):
    emit(raw, 180)


def context_key(context):
    if isinstance(context, dict):
        return context.get("agent_tool_use_id") or context.get("agent_name") or "__root__"
    return "__root__"


def format_text(text, context=None):
    if isinstance(context, dict):
        agent_name = context.get("agent_name")
        if agent_name:
            if text.startswith("   "):
                return f"   [{agent_name}] {text.strip()}"
            return f"[{agent_name}] {text}"
    return text


def emit_context(text, context=None, limit=140):
    emit(format_text(text, context), limit)


def basename(path):
    if not isinstance(path, str) or not path:
        return "?"
    trimmed = path.rstrip("/")
    return trimmed.rsplit("/", 1)[-1] if trimmed else "?"


def add_usage(usage):
    global tokens
    if not isinstance(usage, dict):
        return
    for key in (
        "input_tokens",
        "output_tokens",
        "cache_creation_input_tokens",
        "cache_read_input_tokens",
    ):
        value = usage.get(key, 0)
        if isinstance(value, int):
            tokens += value


def iter_text_fragments(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, list):
        for item in value:
            yield from iter_text_fragments(item)
    elif isinstance(value, dict):
        text = value.get("text")
        if isinstance(text, str):
            yield text
        content = value.get("content")
        if isinstance(content, (str, list, dict)):
            yield from iter_text_fragments(content)


def id_candidates(*values):
    for value in values:
        if not isinstance(value, dict):
            continue
        for key in (
            "parentToolUseID",
            "toolUseID",
            "tool_use_id",
            "parent_tool_use_id",
            "parentToolUseId",
            "toolUseId",
        ):
            candidate = value.get(key)
            if isinstance(candidate, str) and candidate:
                yield candidate


def resolve_agent_context(ev, message, item=None):
    context = {}
    for candidate in id_candidates(item, ev, message):
        agent_name = tool_agent_names.get(candidate) or agent_names_by_tool_use_id.get(candidate)
        if agent_name:
            context["agent_name"] = agent_name
            if candidate in agent_names_by_tool_use_id:
                context["agent_tool_use_id"] = candidate
            break

    agent_tool_use_id = context.get("agent_tool_use_id")
    if agent_tool_use_id is None:
        for candidate in id_candidates(item, ev, message):
            if candidate in agent_names_by_tool_use_id:
                context["agent_tool_use_id"] = candidate
                break

    if context.get("agent_name") and context.get("agent_tool_use_id") is None:
        for tool_use_id, agent_name in agent_names_by_tool_use_id.items():
            if agent_name == context["agent_name"]:
                context["agent_tool_use_id"] = tool_use_id
                break

    return context or None


def extract_stage(text):
    if not isinstance(text, str) or "stage" not in text.lower():
        return None

    for line in text.splitlines():
        lowered = line.lower()
        if "stage" not in lowered:
            continue
        match = re.search(r"(?:\*\*stage\*\*|stage)\s*:\s*([a-z0-9_-]+)", lowered)
        if match:
            return match.group(1)
    return None


def payload_strings(payload, preferred_keys=None):
    if not isinstance(payload, dict):
        return

    preferred_keys = preferred_keys or ()
    seen = set()

    for key in preferred_keys:
        value = payload.get(key)
        if isinstance(value, str):
            seen.add(id(value))
            yield value

    stack = [payload]
    while stack:
        current = stack.pop()
        if isinstance(current, dict):
            for value in current.values():
                if isinstance(value, str):
                    marker = id(value)
                    if marker not in seen:
                        seen.add(marker)
                        yield value
                elif isinstance(value, (dict, list)):
                    stack.append(value)
        elif isinstance(current, list):
            for value in current:
                if isinstance(value, str):
                    marker = id(value)
                    if marker not in seen:
                        seen.add(marker)
                        yield value
                elif isinstance(value, (dict, list)):
                    stack.append(value)


def extract_stage_from_payload(payload):
    preferred_keys = (
        "new_string",
        "content",
        "new_content",
        "replacement",
        "value",
        "text",
    )
    for value in payload_strings(payload, preferred_keys):
        stage = extract_stage(value)
        if stage:
            return stage
    return None


def infer_stage_from_team_name(team_name):
    if not isinstance(team_name, str):
        return None
    lowered = team_name.lower()
    for stage in STAGE_ORDER:
        if stage != "complete" and re.search(rf"(?<![a-z0-9]){re.escape(stage)}(?![a-z0-9])", lowered):
            return stage
    return None


def emit_step_marker(stage):
    global current_stage
    if not isinstance(stage, str):
        return

    stage = stage.strip().lower()
    if not stage or stage == current_stage:
        return

    current_stage = stage
    step_number = STAGE_ORDER.get(stage)
    if step_number is None:
        emit(f"══ STEP: {stage} ══")
    else:
        emit(f"══ STEP {step_number}: {stage} ══")


def is_lore_bash(command):
    if not isinstance(command, str):
        return False
    compact = " ".join(command.split())
    return compact.startswith("printf '\\033[") or compact.startswith('printf "\\033[')


def looks_like_lore_text(line):
    if not isinstance(line, str):
        return False
    stripped = line.strip()
    if not stripped or len(stripped) > 120:
        return False
    for marker in (":", "/", "\\", "[", "]", "{", "}", "=", "->", ".md", ".py"):
        if marker in stripped:
            return False
    return True


def emit_text_block(text, context=None):
    if not isinstance(text, str):
        return
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if not lines:
        return

    pending_lore = context_key(context) in pending_lore_contexts
    if pending_lore:
        pending_lore_contexts.discard(context_key(context))

    for line in lines[:3]:
        if pending_lore and looks_like_lore_text(line):
            continue
        emit_context(line, context)


def handle_tool_use(item, context=None):
    global agents, tools

    name = item.get("name", "?")
    payload = item.get("input")
    if not isinstance(payload, dict):
        payload = {}
    item_id = item.get("id")

    if name == "Agent":
        agent_name = payload.get("name") or payload.get("description") or "?"
        agents += 1
        if isinstance(item_id, str) and item_id:
            agent_names_by_tool_use_id[item_id] = agent_name
            tool_agent_names[item_id] = agent_name
        emit(f">> Agent #{agents}: {agent_name}")
        return

    tools += 1
    if isinstance(item_id, str) and item_id and isinstance(context, dict):
        agent_name = context.get("agent_name")
        if agent_name:
            tool_agent_names[item_id] = agent_name

    if name in {"Write", "Edit", "Read"}:
        path = payload.get("file_path") or payload.get("path") or "?"
        short_name = basename(path)
        emit_context(f"   {name}: {short_name}", context)
        if short_name == "STATE.md" and name in {"Write", "Edit"}:
            emit_step_marker(extract_stage_from_payload(payload))
    elif name == "Bash":
        command = payload.get("command", "?")
        if is_lore_bash(command):
            pending_lore_contexts.add(context_key(context))
            return
        emit_context(f"   $ {truncate(command, 80)}", context)
    elif name in {"Grep", "Glob"}:
        emit_context(f"   {name}: {truncate(payload.get('pattern', '?'), 60)}", context)
    elif name == "Skill":
        emit_context(f"   Skill: {payload.get('skill', '?')}", context)
    elif name in {"TeamCreate", "TeamDelete"}:
        team_name = payload.get("team_name") or payload.get("name") or "?"
        if name == "TeamCreate":
            emit_step_marker(infer_stage_from_team_name(team_name))
        emit_context(f"   {name}: {team_name}", context)
    elif name == "SendMessage":
        target = (
            payload.get("target_agent_id")
            or payload.get("recipient")
            or payload.get("target")
            or payload.get("agent_id")
            or payload.get("name")
            or "?"
        )
        emit_context(f"   SendMessage -> {target}", context)
    else:
        emit_context(f"   {name}", context)


def maybe_emit_status():
    global next_status_at
    while tools >= next_status_at:
        emit(f"--- {agents} agents | {tools} tools | {token_label()} tokens ---")
        next_status_at += 50


def handle_assistant_event(ev, message):
    context = resolve_agent_context(ev, message)
    content = message.get("content", [])
    if isinstance(content, str):
        emit_text_block(content, context)
        return
    if not isinstance(content, list):
        return

    for item in content:
        try:
            if isinstance(item, dict):
                item_type = item.get("type", "")
                if item_type == "tool_use":
                    item_context = resolve_agent_context(ev, message, item) or context
                    handle_tool_use(item, item_context)
                elif item_type == "text":
                    item_context = resolve_agent_context(ev, message, item) or context
                    emit_text_block(item.get("text", ""), item_context)
            elif isinstance(item, str):
                emit_text_block(item, context)
        except Exception:
            emit_raw(item)


def handle_user_event(ev, message):
    context = resolve_agent_context(ev, message)
    content = ev.get("content")
    if content is None and isinstance(message, dict):
        content = message.get("content")

    for fragment in iter_text_fragments(content):
        if "BLOCKED:" in fragment or "STOP." in fragment:
            emit_context(f"!! HOOK VIOLATION: {truncate(fragment, 100)}", context)
            break


def process_event(ev, raw):
    global session_initialized

    event_type = ev.get("type", "")
    message = ev.get("message")
    if not isinstance(message, dict):
        message = {}

    usage = ev.get("usage")
    if usage is None:
        usage = message.get("usage")
    add_usage(usage)

    if event_type == "system" and ev.get("subtype") == "init":
        if not session_initialized:
            session_initialized = True
            emit("Session initialized")
        return

    if event_type == "result":
        return

    is_assistant = event_type == "assistant" or (
        message.get("role") == "assistant" and message.get("type") == "message"
    )
    if is_assistant:
        handle_assistant_event(ev, message)
        return

    is_user = event_type == "user" or message.get("role") == "user"
    if is_user or event_type == "tool_result":
        handle_user_event(ev, message)
        return

    if event_type in {"queue-operation", "progress"}:
        return

    # Unknown event shapes are surfaced as raw lines instead of crashing.
    if not event_type and not message:
        emit_raw(raw)


for raw in sys.stdin:
    raw = raw.strip()
    if not raw:
        continue

    try:
        event = json.loads(raw)
    except json.JSONDecodeError:
        emit_raw(raw)
        sys.stdout.flush()
        continue

    try:
        process_event(event, raw)
    except Exception:
        emit_raw(raw)

    maybe_emit_status()
    sys.stdout.flush()

elapsed_seconds = int(time.time() - start)
minutes, seconds = divmod(elapsed_seconds, 60)
print(
    f"\n  === COMPLETE: {minutes}m{seconds}s | "
    f"{agents} agents | {tools} tools | {token_label()} tokens ==="
)
