#!/bin/bash
# enforce-pipeline.sh — PreToolUse hook for Kiln pipeline
#
# 10 hooks across 5 categories:
#   Delegation (1,2,7):   dial-a-coder/art-of-war/bossman cannot Write/Edit
#   Safety (5,6,6b):      system config, rm -rf, git init
#   Lifecycle (8,9):      boss shutdown block, agent spawn whitelist
#   Tool redirect (10):   WebFetch → MCP Fetch (hangs on many URLs)
#
# See the CHANGELOG block at the bottom of this file for history of
# removed hooks.
#
# Stateless. allow() = exit 0. deny() = hookSpecificOutput JSON + exit 0.
# Strips kiln: prefix from AGENT, RECIPIENT, SUBTYPE.
#
# Tool matchers use PascalCase only (Bash, SendMessage, Write, WebFetch)
# per Claude Code v2.1.89. Snake_case aliases removed in Wave 0 — they
# never matched anything.

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
  Read|Write|Edit|Bash|SendMessage|Agent|WebFetch) ;;
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
    the-beginning-of-the-end|the-discovery-begins|the-anatomist|trust-the-science|follow-the-scent|\
    the-creator|the-foundation|\
    alpha-team-deploy|unit-deployed|\
    the-plan-maker|pitie-pas-les-crocos|mystical-inspiration|art-of-war|divergences-converge|e-pluribus-unum|straight-outta-olympia|gracefully-degrading|\
    bossman|dropping-science|algalon-the-observer|lore-keepah|dial-a-coder|backup-coder|la-peintresse|critical-thinker|the-curator|\
    team-red|team-blue|the-negotiator|i-am-the-law|\
    release-the-giant|le-plexus-exploseur|style-maker|\
    the-end-of-the-beginning)
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
if [[ "$AGENT" == "dial-a-coder" ]] && [[ "$TOOL" =~ ^(Write|Edit)$ ]]; then
  deny "STOP. You are a codex exec wrapper — you do not write files.

Your workflow:
  1. READ context: .kiln/master-plan.md, .kiln/docs/architecture.md,
     .kiln/docs/tech-stack.md, .kiln/docs/codebase-state.md,
     .kiln/docs/patterns.md, .kiln/docs/pitfalls.md
  2. Construct prompt: cat <<'EOF' > /tmp/kiln_prompt.md
  3. Invoke: codex exec --sandbox danger-full-access -C \"{working_dir}\" < /tmp/kiln_prompt.md
  4. Verify output, run tests, commit, REVIEW_REQUEST to your paired reviewer."
fi

# Hook 2 — art-of-war: no Write/Edit
if [[ "$AGENT" == "art-of-war" ]] && [[ "$TOOL" =~ ^(Write|Edit)$ ]]; then
  deny "STOP. You are a codex exec wrapper — you do not write plan content.

Your workflow:
  1. READ: .kiln/docs/VISION.md, .kiln/docs/vision-priorities.md,
     .kiln/docs/architecture.md, .kiln/docs/tech-stack.md,
     .kiln/docs/arch-constraints.md, .kiln/docs/codebase-snapshot.md
  2. Construct prompt: cat <<'EOF' > /tmp/kiln_prompt.md
  3. Invoke: codex exec --sandbox danger-full-access -C \"{working_dir}\" < /tmp/kiln_prompt.md
  4. Verify .kiln/plans/plan-\${SLOT}.md exists (slot from your runtime prompt, a or b). Signal the-plan-maker: PLAN_READY."
fi

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
if [[ "$TOOL" == "Bash" ]]; then
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

# ═══════════════════════════════════════════════════════════════
# DELEGATION (continued) — hook 7
# ═══════════════════════════════════════════════════════════════

# Hook 7 — bossman: no Write/Edit except .kiln/STATE.md and .kiln/tmp/ (he's a scoper, not a coder)
# Hook 7b — release-the-giant: no Write/Edit except .kiln/validation/ (he validates, he doesn't fix)
if [[ "$AGENT" == "release-the-giant" ]] && [[ "$TOOL" =~ ^(Write|Edit)$ ]]; then
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

if [[ "$AGENT" == "bossman" ]] && [[ "$TOOL" =~ ^(Write|Edit)$ ]]; then
  if ! [[ "$FILE_PATH" =~ \.kiln/(STATE\.md$|tmp/) ]]; then
    deny "STOP. You are the build boss — you scope and delegate, you do not write project code.

Your workflow:
  1. Read READY summaries from dropping-science and algalon-the-observer
  2. Scope a focused chunk from master-plan.md
  3. Construct a structured XML assignment
  4. Dispatch to your builder pair via SendMessage
  5. Wait for IMPLEMENTATION_APPROVED (reviewer → you) or IMPLEMENTATION_BLOCKED / IMPLEMENTATION_REJECTED (builder → you)

You MAY update .kiln/STATE.md and write to .kiln/tmp/ for pipeline state tracking."
  fi
fi

# Hook 8 — bosses: shutdown is engine's job
if [[ "$TOOL" == "SendMessage" ]] && [[ "$TYPE" == "shutdown_request" ]]; then
  if [[ "$AGENT" =~ ^(bossman|the-plan-maker|alpha-team-deploy|release-the-giant|the-beginning-of-the-end|the-creator)$ ]]; then
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
      the-beginning-of-the-end|the-discovery-begins|the-anatomist|trust-the-science|follow-the-scent|\
      the-creator|the-foundation|\
      alpha-team-deploy|unit-deployed|\
      the-plan-maker|pitie-pas-les-crocos|mystical-inspiration|art-of-war|divergences-converge|e-pluribus-unum|straight-outta-olympia|gracefully-degrading|\
      bossman|dropping-science|algalon-the-observer|lore-keepah|dial-a-coder|backup-coder|la-peintresse|critical-thinker|the-curator|\
      team-red|team-blue|the-negotiator|i-am-the-law|\
      release-the-giant|le-plexus-exploseur|style-maker|\
      the-end-of-the-beginning)
        ;; # allowed
      *)
        deny "Only named Kiln agents can be spawned. Use agent types from the blueprint roster:
  Default: dial-a-coder (builder) + critical-thinker (reviewer)
  Fallback: backup-coder (builder) + critical-thinker (reviewer)
  UI: la-peintresse (builder) + the-curator (reviewer)"
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
if [[ "$TOOL" == "WebFetch" ]]; then
  deny "WebFetch is disabled during Kiln pipeline runs — it hangs on many URLs. Use mcp__plugin_kiln_fetch__fetch instead (official Anthropic Fetch MCP, bundled with this plugin). To restore: comment out Hook 10 in enforce-pipeline.sh and remove WebFetch from the enforce-pipeline matcher in hooks.json."
fi

# ═══════════════════════════════════════════════════════════════
# Everything else — allow
# ═══════════════════════════════════════════════════════════════

allow

# ═══════════════════════════════════════════════════════════════
# CHANGELOG — hooks removed over time (git blame has full context)
#
# v1.0   — removed old Hooks 6-10 (zero fires across 22 smoke tests).
#          Codex flags moved to prompt-level enforcement.
# v1.0   — removed old Hook 13 (memory isolation). Silent allow caused
#          confusion; no real protection achieved.
# v1.0.4 — removed old Hook 2 (plato Write/Edit). Plato writes directly
#          as the opus synthesizer; the guard was no longer justified.
# v1.3.0 — removed old Hooks 3, 4 (sequencing gates). Redundant with
#          agent instructions; added noise without adding safety.
# v1.3.0 — stripped dead snake_case tool-name aliases from matchers.
#          Claude Code v2.1.89 uses PascalCase only; the aliases never
#          matched anything. See git log for the exact list.
# v1.4.0 — retired the Wave 3 belt-and-suspenders CYCLE_WORKERS unblock:
#          previously either WORKERS_SPAWNED (canonical engine ack) OR
#          WORKER_READY (worker self-announce fallback) would unblock krs-one.
#          SubagentStart hook now provides deterministic spawn ack via
#          additionalContext injection (~90ms post-spawn, before first
#          PreToolUse) — sole unblock path. WORKERS_SPAWNED retained as
#          operator-visible logging; WORKER_READY self-announce retired from
#          builder/reviewer bodies (dial-a-coder, backup-coder, la-peintresse,
#          critical-thinker, the-curator). See SIMPLIFY-v1.4.0 §5.3 P1.
# v1.4.0 — P2 (TeammateIdle + detached watchdog): autonomous stall detection.
#          Retired the manual operator Watchdog Protocol from kiln-pipeline
#          SKILL.md §5 (Check TaskList / Scan messages / Nudge if silent /
#          Stagnation rule block). Replaced by six thin hook scripts:
#            activity-update.sh — heartbeat + teammate tracking on 6 events
#            spawn-watchdog.sh  — SessionStart: DEADLOCK.flag recovery,
#                                 stale-PID kill, nohup+disown watchdog spawn
#            watchdog-loop.sh   — detached 60s polling loop
#            deadlock-check.sh  — deadlock rule + nudge/escalate logic
#            nudge-inject.sh    — PreToolUse/UserPromptSubmit additionalContext emit
#            session-cleanup.sh — SessionEnd: PID kill + tmp file cleanup
#          State file: .kiln/tmp/activity.json (7-field schema, atomic writes).
#          Escalation: .kiln/DEADLOCK.flag after 3 nudges; SessionStart recovers.
#          Ref: plugins/kiln/skills/kiln-pipeline/references/deadlock-detection.md
#          See SIMPLIFY-v1.4.0 §5.3 P2.
# ═══════════════════════════════════════════════════════════════
