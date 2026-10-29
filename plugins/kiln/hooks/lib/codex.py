"""Codex 0.165.0 hook wire format; Bash/apply_patch use command."""
def stop(reason):
    return {"decision": "block", "reason": reason}


def start(context):
    return {"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": context}}


def deny(reason, tool):
    return {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
                                   "permissionDecisionReason": f"{tool}: {reason}"}}


def paths(tool, data):
    if tool != "apply_patch":
        return []
    prefixes = ("*** Add File: ", "*** Update File: ", "*** Delete File: ", "*** Move to: ")
    return [line[len(prefix):] for line in data["command"].splitlines()
            for prefix in prefixes if line.startswith(prefix)]
