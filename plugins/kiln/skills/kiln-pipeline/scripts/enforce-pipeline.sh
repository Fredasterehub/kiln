#!/bin/bash
# enforce-pipeline.sh — PreToolUse hook for Kiln pipeline
#
# 10 hooks across 5 categories:
#   Delegation (1,2,7):   codex/sun-tzu/krs-one cannot Write/Edit
#   Sequencing (3,4):     gate dispatches until bootstrap docs ready
#   Safety (5,6,6b):      system config, rm -rf, git init
#   Lifecycle (8,9):      boss shutdown block, agent spawn whitelist
#   Tool redirect (10):   WebFetch → MCP Fetch (hangs on many URLs)
#
# Removed v1.0: old Hook 2 (v1.0.4), old Hooks 6-10 (redundant/zero fires), old Hook 13 (confusion)
# Codex flag guidance moved to gpt54-prompt-guide.md reference file.
#
# Stateless. allow() = exit 0. deny() = hookSpecificOutput JSON + exit 0.
# Strips kiln: prefix from AGENT, RECIPIENT, SUBTYPE.
#
# NOTE: Some matchers include snake_case tool names (send_message, run_terminal_command).
# Claude Code v2.1.89 uses PascalCase only (Bash, SendMessage, etc.) — these don't
# match any current tools. They are harmless future-proofing in case aliases are added.

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name // ""')

allow() {
  exit 0
}

deny() {
  jq -cn --arg reason "$1" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $reason
    }
  }'
  exit 0
}

# Fast exit for tools we don't check
case "$TOOL" in
  Read|Write|Edit|Bash|SendMessage|Agent|WebFetch|web_fetch) ;;
  *) allow ;;
esac

AGENT=$(echo "$INPUT" | jq -r '.agent_type // ""')
AGENT="${AGENT#kiln:}"
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""')
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')
RECIPIENT=$(echo "$INPUT" | jq -r '.tool_input.recipient // ""')
RECIPIENT="${RECIPIENT#kiln:}"
TYPE=$(echo "$INPUT" | jq -r '.tool_input.type // ""')

# ── Helpers ──────────────────────────────────────────────────

_find_root() {
  local d="$PWD"
  while [[ "$d" != "/" ]]; do
    [[ -d "$d/.kiln" ]] && echo "$d" && return 0
    d=$(dirname "$d")
  done
  return 1
}

_status_ok() {
  [[ -f "$1" ]] && head -1 "$1" | grep -qF '<!-- status: complete -->'
}

# ── Pipeline context gate ────────────────────────────────────
# Enforcement only applies during ACTIVE Kiln pipeline runs.
# Three checks: .kiln/ exists, STATE.md has active stage, agent is Kiln-known.
KILN_ROOT=$(_find_root)

# No .kiln/ directory — no pipeline, allow everything
[[ -n "$KILN_ROOT" ]] || allow

# .kiln/ exists — check if pipeline is actually active via STATE.md
_STATE="$KILN_ROOT/.kiln/STATE.md"
if [[ ! -f "$_STATE" ]]; then
  allow  # No STATE.md = no active pipeline (historical/stale .kiln/)
fi

_STAGE=$(grep -oP '(?<=\*\*stage\*\*: )\S+' "$_STATE" 2>/dev/null || true)
if [[ -z "$_STAGE" ]] || [[ "$_STAGE" == "complete" ]]; then
  allow  # Pipeline finished or STATE.md malformed — no enforcement
fi

# Pipeline is active. Main session (empty AGENT) is the engine — enforce.
# For named agents, only enforce if the agent is a known Kiln pipeline agent.
if [[ -n "$AGENT" ]]; then
  case "$AGENT" in
    alpha|mnemosyne|maiev|curie|medivh|\
    da-vinci|clio|\
    mi6|field-agent|\
    aristotle|numerobis|confucius|sun-tzu|plato|athena|\
    krs-one|rakim|sentinel|thoth|codex|daft|kaneda|clair|miyamoto|sphinx|punk|tetsuo|obscur|\
    zoxea|argus|hephaestus|omega)
      ;; # known Kiln agent — fall through to enforcement
    *)
      allow ;; # unknown agent (Explore, statusline-setup, etc.) — not Kiln, allow
  esac
fi

# ═══════════════════════════════════════════════════════════════
# DELEGATION — hooks 1, 2
# Agents that wrap codex exec must not write files directly.
# ═══════════════════════════════════════════════════════════════

# Hook 1 — codex-type builders: no Write/Edit
if [[ "$AGENT" == "codex" ]] && [[ "$TOOL" =~ ^(Write|Edit)$ ]]; then
  deny "STOP. You are a codex exec wrapper — you do not write files.

Your workflow:
  1. READ context: .kiln/master-plan.md, .kiln/docs/architecture.md,
     .kiln/docs/tech-stack.md, .kiln/docs/codebase-state.md,
     .kiln/docs/patterns.md, .kiln/docs/pitfalls.md
  2. Construct prompt: cat <<'EOF' > /tmp/kiln_prompt.md
  3. Invoke: codex exec --sandbox danger-full-access -C \"{working_dir}\" < /tmp/kiln_prompt.md
  4. Verify output, run tests, commit, REVIEW_REQUEST to your paired reviewer."
fi

# (Hook 2 was plato Write/Edit — removed v1.0.4: plato now writes directly as opus synthesizer)

# Hook 2 — sun-tzu: no Write/Edit
if [[ "$AGENT" == "sun-tzu" ]] && [[ "$TOOL" =~ ^(Write|Edit)$ ]]; then
  deny "STOP. You are a codex exec wrapper — you do not write plan content.

Your workflow:
  1. READ: .kiln/docs/VISION.md, .kiln/docs/vision-priorities.md,
     .kiln/docs/architecture.md, .kiln/docs/tech-stack.md,
     .kiln/docs/arch-constraints.md, .kiln/docs/codebase-snapshot.md
  2. Construct prompt: cat <<'EOF' > /tmp/kiln_prompt.md
  3. Invoke: codex exec --sandbox danger-full-access -C \"{working_dir}\" < /tmp/kiln_prompt.md
  4. Verify .kiln/plans/codex_plan.md exists. Signal aristotle: PLAN_READY."
fi

# ═══════════════════════════════════════════════════════════════
# SEQUENCING — hooks 3, 4
# Gate dispatches until bootstrap docs are marked complete.
# Fail open if .kiln/ not found (no active pipeline).
# ═══════════════════════════════════════════════════════════════

# Hook 3 — krs-one: no dispatch until rakim+sentinel ready
# Two-part gate: (a) block messages to dynamic-named workers,
# (b) block REQUEST_WORKERS or CYCLE_WORKERS to team-lead. Allows other
# team-lead messages (ITERATION_COMPLETE, MILESTONE_COMPLETE) and
# infrastructure agents freely.
CONTENT=$(echo "$INPUT" | jq -r '.tool_input.content // ""')
if [[ "$AGENT" == "krs-one" ]] && [[ "$TOOL" == "SendMessage" ]]; then
  _NEEDS_GATE=false
  # Part 1: message to anyone outside infrastructure = worker dispatch
  if ! [[ "$RECIPIENT" =~ ^(rakim|sentinel|thoth|team-lead)$ ]]; then
    _NEEDS_GATE=true
  fi
  # Part 2: REQUEST_WORKERS or CYCLE_WORKERS to team-lead = worker spawn request
  if [[ "$RECIPIENT" == "team-lead" ]] && [[ "$CONTENT" == *"REQUEST_WORKERS"* || "$CONTENT" == *"CYCLE_WORKERS"* ]]; then
    _NEEDS_GATE=true
  fi
  if [[ "$_NEEDS_GATE" == "true" ]]; then
    ROOT=$(_find_root)
    if [[ -n "$ROOT" ]]; then
      if ! _status_ok "$ROOT/.kiln/docs/codebase-state.md" || ! _status_ok "$ROOT/.kiln/docs/patterns.md"; then
        deny "BLOCKED: rakim and sentinel haven't finished bootstrapping.

Wait for BOTH READY summaries (in your runtime prompt) before dispatching:
  1. rakim — codebase state (codebase-state.md must be complete)
  2. sentinel — patterns/pitfalls guidance (patterns.md must be complete)"
      fi
    fi
  fi
fi

# Hook 4 — aristotle: no dispatch to planners until numerobis ready
if [[ "$AGENT" == "aristotle" ]] && [[ "$TOOL" =~ ^(SendMessage|send_message)$ ]] && [[ "$RECIPIENT" =~ ^(confucius|sun-tzu|plato|athena)$ ]]; then
  ROOT=$(_find_root)
  if [[ -n "$ROOT" ]]; then
    if ! _status_ok "$ROOT/.kiln/docs/architecture.md"; then
      deny "BLOCKED: numerobis hasn't finished writing architecture docs.

Wait for numerobis's READY message. architecture.md must have
<!-- status: complete --> on its first line before planners can be dispatched."
    fi
  fi
fi

# v1.0 removed hooks 6-10 (zero fires across 22 STs). Codex flags now prompt-enforced.
# Bash bypass monitored by audit-bash.sh (advisory). Zero incidents across 22 STs.

# ═══════════════════════════════════════════════════════════════
# SAFETY — hooks 5, 6, 6b
# System config, destructive recovery, memory isolation.
# ═══════════════════════════════════════════════════════════════

# Hook 5 — pipeline agents: no Read/Write/Edit on sensitive files, no Write/Edit on system config
if [[ -n "$AGENT" ]]; then
  # Sensitive files — block all access (Read/Write/Edit)
  if [[ "$TOOL" =~ ^(Read|Write|Edit)$ ]]; then
    if [[ "$FILE_PATH" =~ (\.env|\.pem|_rsa|\.key|credentials\.json|secrets\.|^.*\.npmrc$) ]]; then
      deny "STOP. $FILE_PATH contains sensitive credentials. Pipeline agents are blocked from accessing it."
    fi
  fi
  # System configuration — block Write/Edit only (Read allowed for diagnostics)
  if [[ "$TOOL" =~ ^(Write|Edit)$ ]]; then
    if [[ "$FILE_PATH" =~ (\.codex/|\.claude/settings|\.claude/projects/[^/]+/settings) ]]; then
      deny "STOP. $FILE_PATH is system configuration. Pipeline agents cannot modify it.
Escalate tooling issues to your boss — do not fix config yourself."
    fi
  fi
fi

# Hook 6 — no rm -rf on project directories
if [[ "$TOOL" =~ ^(Bash|run_terminal_command)$ ]]; then
  if echo "$COMMAND" | grep -qE 'rm\s+(-rf|-fr|-r\s+-f|-f\s+-r)\s+(/|~|\$HOME|\$\{HOME|\.\.)'; then
    deny "STOP. Never delete a project directory.

Use git to recover:
  git checkout -- . && git clean -fd    # undo uncommitted changes
  git reset --soft HEAD~1               # undo last commit, keep changes
  git reset --hard HEAD                 # hard-reset to last commit"
  fi
  # Hook 6b — no git init during active pipeline (prevents nested repo / history destruction)
  if echo "$COMMAND" | grep -qE '\bgit\s+(init|-C\s+\S+\s+init)\b'; then
    if [[ -f "$KILN_ROOT/.kiln/STATE.md" ]]; then
      deny "STOP. git init is blocked during an active Kiln pipeline.
The project repository was initialized before the build step.
Running git init would destroy commit history. If you need a fresh repo, escalate to the operator."
    fi
  fi
fi

# (Hook 13 was memory isolation — removed v1.0: silent allow caused confusion, no real protection.)

# ═══════════════════════════════════════════════════════════════
# DELEGATION (continued) — hook 7
# ═══════════════════════════════════════════════════════════════

# Hook 7 — krs-one: no Write/Edit except .kiln/STATE.md and .kiln/tmp/ (he's a scoper, not a coder)
# Hook 7b — argus: no Write/Edit except .kiln/validation/ (he validates, he doesn't fix)
if [[ "$AGENT" == "argus" ]] && [[ "$TOOL" =~ ^(Write|Edit)$ ]]; then
  if ! [[ "$FILE_PATH" =~ \.kiln/validation/ ]]; then
    deny "STOP. You are the validator — you find issues and report them, you do not fix source code.

Your workflow:
  1. Build and test the product
  2. Run acceptance criteria checks
  3. Write findings to .kiln/validation/report.md
  4. Signal VALIDATE_PASS or VALIDATE_FAILED

You MAY write to .kiln/validation/ only. If you find bugs, document them and signal VALIDATE_FAILED. The correction cycle sends builders to fix — not you."
  fi
fi

if [[ "$AGENT" == "krs-one" ]] && [[ "$TOOL" =~ ^(Write|Edit)$ ]]; then
  if ! [[ "$FILE_PATH" =~ \.kiln/(STATE\.md$|tmp/) ]]; then
    deny "STOP. You are the build boss — you scope and delegate, you do not write project code.

Your workflow:
  1. Read READY summaries from rakim and sentinel
  2. Scope a focused chunk from master-plan.md
  3. Construct a structured XML assignment
  4. Dispatch to your builder pair via SendMessage
  5. Wait for IMPLEMENTATION_COMPLETE

You MAY update .kiln/STATE.md and write to .kiln/tmp/ for pipeline state tracking."
  fi
fi

# Hook 8 — bosses: shutdown is engine's job
if [[ "$TOOL" == "SendMessage" ]] && [[ "$TYPE" == "shutdown_request" ]]; then
  if [[ "$AGENT" =~ ^(krs-one|aristotle|mi6|argus|alpha|da-vinci)$ ]]; then
    deny "Worker shutdown is managed by the engine at step transitions.
After verifying deliverables, signal MILESTONE_COMPLETE to team-lead.
This is your last action for the milestone."
  fi
fi

# Hook 9 — Only named Kiln agents can be spawned
if [[ "$TOOL" == "Agent" ]]; then
  SUBTYPE=$(echo "$INPUT" | jq -r '.tool_input.subagent_type // ""')
  SUBTYPE="${SUBTYPE#kiln:}"
  if [[ -n "$SUBTYPE" ]]; then
    case "$SUBTYPE" in
      alpha|mnemosyne|maiev|curie|medivh|\
      da-vinci|clio|\
      mi6|field-agent|\
      aristotle|numerobis|confucius|sun-tzu|plato|athena|\
      krs-one|rakim|sentinel|thoth|codex|daft|kaneda|clair|miyamoto|sphinx|punk|tetsuo|obscur|\
      zoxea|argus|hephaestus|omega)
        # daft, punk, tetsuo are dormant but kept in whitelist for defensive safety
        ;; # allowed
      *)
        deny "Only named Kiln agents can be spawned. Use agent types from the blueprint roster:
  Default: codex (builder) + sphinx (reviewer)
  Fallback: kaneda (builder) + sphinx (reviewer)
  UI: clair (builder) + obscur (reviewer)"
        ;;
    esac
  fi
fi

# ═══════════════════════════════════════════════════════════════
# TOOL REDIRECT — hook 10
# WebFetch hangs on many URLs. Redirect to bundled MCP fetch.
# ═══════════════════════════════════════════════════════════════

# Hook 10 — WebFetch → MCP Fetch redirect (pipeline-only)
# WebFetch hangs on many URLs. Redirect to the bundled Anthropic Fetch MCP server.
if [[ "$TOOL" =~ ^(WebFetch|web_fetch)$ ]]; then
  deny "WebFetch is disabled during Kiln pipeline runs — it hangs on many URLs. Use mcp__plugin_kiln_fetch__fetch instead (official Anthropic Fetch MCP, bundled with this plugin). To restore: comment out Hook 10 in enforce-pipeline.sh and remove WebFetch from the enforce-pipeline matcher in hooks.json."
fi

# ═══════════════════════════════════════════════════════════════
# Everything else — allow
# ═══════════════════════════════════════════════════════════════

allow
