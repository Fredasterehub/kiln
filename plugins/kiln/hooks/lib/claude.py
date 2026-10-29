"""Claude Code 2.1.312 hook wire format; no CLI calls."""
def stop(reason):
    return {"decision": "block", "reason": reason}


def start(context):
    return {"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": context}}


def deny(reason, tool):
    return {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
                                   "permissionDecisionReason": f"{tool}: {reason}"}}


def paths(tool, data):
    return [data["file_path"]] if tool in ("Edit", "Write") else []


def with_listener(config, role):
    """Called by launch: only Claude persistent seats register native asyncRewake."""
    if role in ("worker", "advisor"):
        return config
    import copy
    config = copy.deepcopy(config)
    for event, script in (("Stop", "stop"), ("SessionStart", "start")):
        handler = dict(config[event][0]["hooks"][0])
        handler.update(command=handler["command"].replace(f"/{script}.sh", "/listen.sh"),
                       asyncRewake=True, timeout=300)
        config[event][0]["hooks"].append(handler)
    return config
