#!/bin/bash
# enforce-pipeline.sh — PreToolUse hook for Kiln pipeline
#
# 13 hooks across 4 categories:
#   Delegation (1-3):  delegation agents cannot Write/Edit files directly
#   Sequencing (4-6):  gate dispatches until bootstrap docs are ready
#   Flags (7-10):      block incorrect codex exec flags
#   Safety (11-13):    protect system config, prevent rm -rf, block memory reads
#
# Stateless. Exit 2 + stderr = block. Exit 0 = allow.

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name // ""')

# Fast exit for tools we don't check
case "$TOOL" in
  Write|Edit|Bash|SendMessage|Read) ;;
  *) exit 0 ;;
esac

AGENT=$(echo "$INPUT" | jq -r '.agent_type // ""')
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""')
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')
RECIPIENT=$(echo "$INPUT" | jq -r '.tool_input.recipient // ""')

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
  [[ -f "$1" ]] && head -1 "$1" | grep -q '<!-- status: complete -->'
}

# ═══════════════════════════════════════════════════════════════
# DELEGATION — hooks 1, 2, 3
# Agents that wrap codex exec must not write files directly.
# ═══════════════════════════════════════════════════════════════

# Hook 1 — codex: no Write/Edit
if [[ "$AGENT" == "codex" ]] && [[ "$TOOL" =~ ^(Write|Edit)$ ]]; then
  cat >&2 <<'MSG'
STOP. You are a codex exec wrapper — you do not write files.

Your workflow:
  1. READ context: .kiln/master-plan.md, .kiln/docs/architecture.md,
     .kiln/docs/tech-stack.md, .kiln/docs/codebase-state.md,
     .kiln/docs/patterns.md, .kiln/docs/pitfalls.md
  2. Construct prompt: cat <<'EOF' > /tmp/kiln_prompt.md
  3. Invoke: codex exec --sandbox danger-full-access -C "{working_dir}" < /tmp/kiln_prompt.md
  4. Verify output, run tests, commit, REVIEW_REQUEST to sphinx.
MSG
  exit 2
fi

# Hook 2 — plato: no Write/Edit
if [[ "$AGENT" == "plato" ]] && [[ "$TOOL" =~ ^(Write|Edit)$ ]]; then
  cat >&2 <<'MSG'
STOP. You are a codex exec wrapper — you do not write plan content.

Your workflow:
  1. READ: .kiln/plans/claude_plan.md, .kiln/plans/codex_plan.md,
     .kiln/plans/debate_resolution.md, .kiln/docs/VISION.md,
     .kiln/docs/architecture.md, .kiln/docs/arch-constraints.md
  2. Construct prompt: cat <<'EOF' > /tmp/kiln_prompt.md
  3. Invoke: codex exec --sandbox danger-full-access -C "{working_dir}" < /tmp/kiln_prompt.md
  4. Verify .kiln/master-plan.md exists. Signal aristotle: SYNTHESIS_COMPLETE.
MSG
  exit 2
fi

# Hook 3 — sun-tzu: no Write/Edit
if [[ "$AGENT" == "sun-tzu" ]] && [[ "$TOOL" =~ ^(Write|Edit)$ ]]; then
  cat >&2 <<'MSG'
STOP. You are a codex exec wrapper — you do not write plan content.

Your workflow:
  1. READ: .kiln/docs/VISION.md, .kiln/docs/vision-priorities.md,
     .kiln/docs/architecture.md, .kiln/docs/tech-stack.md,
     .kiln/docs/arch-constraints.md, .kiln/docs/codebase-snapshot.md
  2. Construct prompt: cat <<'EOF' > /tmp/kiln_prompt.md
  3. Invoke: codex exec --sandbox danger-full-access -C "{working_dir}" < /tmp/kiln_prompt.md
  4. Verify .kiln/plans/codex_plan.md exists. Signal aristotle: PLAN_READY.
MSG
  exit 2
fi

# ═══════════════════════════════════════════════════════════════
# SEQUENCING — hooks 4, 5, 6
# Gate dispatches until bootstrap docs are marked complete.
# Fail open if .kiln/ not found (no active pipeline).
# ═══════════════════════════════════════════════════════════════

# Hook 4 — krs-one: no dispatch to codex/sphinx until architect+sentinel ready
if [[ "$AGENT" == "krs-one" ]] && [[ "$TOOL" == "SendMessage" ]] && [[ "$RECIPIENT" =~ ^(codex|sphinx)$ ]]; then
  ROOT=$(_find_root)
  if [[ -n "$ROOT" ]]; then
    if ! _status_ok "$ROOT/.kiln/docs/architecture.md" || ! _status_ok "$ROOT/.kiln/docs/patterns.md"; then
      cat >&2 <<'MSG'
BLOCKED: architect and sentinel haven't finished bootstrapping.

Wait for BOTH bootstrap replies before dispatching:
  1. architect — codebase state report (architecture.md must be complete)
  2. sentinel — patterns/pitfalls guidance (patterns.md must be complete)
MSG
      exit 2
    fi
  fi
fi

# Hook 5 — aristotle: no dispatch to planners until architect ready
if [[ "$AGENT" == "aristotle" ]] && [[ "$TOOL" == "SendMessage" ]] && [[ "$RECIPIENT" =~ ^(confucius|sun-tzu|plato|socrates)$ ]]; then
  ROOT=$(_find_root)
  if [[ -n "$ROOT" ]]; then
    if ! _status_ok "$ROOT/.kiln/docs/architecture.md"; then
      cat >&2 <<'MSG'
BLOCKED: architect hasn't finished writing architecture docs.

Wait for architect's BOOTSTRAP_COMPLETE message. architecture.md must have
<!-- status: complete --> on its first line before planners can be dispatched.
MSG
      exit 2
    fi
  fi
fi

# ═══════════════════════════════════════════════════════════════
# FLAGS — hooks 7, 8, 9, 10 (+ sequencing hook 6 as backup gate)
# Correct codex exec invocation: --sandbox danger-full-access only.
# Model configured in ~/.codex/config.toml. No extra flags.
# ═══════════════════════════════════════════════════════════════

if [[ "$AGENT" =~ ^(codex|plato|sun-tzu)$ ]] && [[ "$TOOL" == "Bash" ]]; then
  if echo "$COMMAND" | grep -q 'codex exec'; then

    # Hook 6 — codex: backup sequencing gate (codex exec before bootstrap ready)
    if [[ "$AGENT" == "codex" ]]; then
      ROOT=$(_find_root)
      if [[ -n "$ROOT" ]]; then
        if ! _status_ok "$ROOT/.kiln/docs/architecture.md" || ! _status_ok "$ROOT/.kiln/docs/patterns.md"; then
          echo "BLOCKED: bootstrap docs not ready. Wait for krs-one's assignment." >&2
          exit 2
        fi
      fi
    fi

    # Hook 7 — no -m flag (model set in config.toml)
    if echo "$COMMAND" | grep -qE '\s-m\s'; then
      echo "STOP. Do not pass -m to codex exec. Model is in ~/.codex/config.toml." >&2
      echo "Use: codex exec --sandbox danger-full-access -C \"{working_dir}\" < /tmp/kiln_prompt.md" >&2
      exit 2
    fi

    # Hook 8 — no --config override
    if echo "$COMMAND" | grep -qE '\-\-config\s'; then
      echo "STOP. Do not pass --config. Configuration is in ~/.codex/config.toml." >&2
      echo "Use: codex exec --sandbox danger-full-access -C \"{working_dir}\" < /tmp/kiln_prompt.md" >&2
      exit 2
    fi

    # Hook 9 — no --full-auto (Landlock kernel restriction)
    if echo "$COMMAND" | grep -qE '\-\-full-auto'; then
      echo "STOP. --full-auto fails in this environment (Landlock). Use --sandbox danger-full-access." >&2
      echo "Use: codex exec --sandbox danger-full-access -C \"{working_dir}\" < /tmp/kiln_prompt.md" >&2
      exit 2
    fi

    # Hook 10 — no --skip-git-repo-check (already in a git repo)
    if echo "$COMMAND" | grep -qE '\-\-skip-git-repo-check'; then
      echo "STOP. Working directory is already a git repo. No --skip-git-repo-check needed." >&2
      echo "Use: codex exec --sandbox danger-full-access -C \"{working_dir}\" < /tmp/kiln_prompt.md" >&2
      exit 2
    fi
  fi
fi

# ═══════════════════════════════════════════════════════════════
# SAFETY — hooks 11, 12, 13
# System config, destructive recovery, memory isolation.
# ═══════════════════════════════════════════════════════════════

# Hook 11 — no Write/Edit on system config (~/.codex/, ~/.claude/)
if [[ "$TOOL" =~ ^(Write|Edit)$ ]]; then
  if [[ "$FILE_PATH" =~ (\.codex/|\.claude/settings|\.claude/projects) ]]; then
    echo "STOP. $FILE_PATH is system configuration. Pipeline agents cannot modify it." >&2
    echo "Escalate tooling issues to your boss — do not fix config yourself." >&2
    exit 2
  fi
fi

# Hook 12 — no rm -rf on project directories
if [[ "$TOOL" == "Bash" ]]; then
  if echo "$COMMAND" | grep -qE 'rm\s+(-rf|-r\s+-f|-f\s+-r)\s+(/DEV/|\./?[^.]|\$)'; then
    cat >&2 <<'MSG'
STOP. Never delete a project directory.

Use git to recover:
  git checkout -- . && git clean -fd    # undo uncommitted changes
  git reset --soft HEAD~1               # undo last commit, keep changes
  git reset --hard HEAD                 # hard-reset to last commit
MSG
    exit 2
  fi
fi

# Hook 13 — no Read on auto-memory directories
if [[ "$TOOL" == "Read" ]]; then
  if [[ "$FILE_PATH" =~ /\.claude/.*/memory/ ]]; then
    echo "STOP. Memory files are off-limits. Your agent .md and spawn prompt are your only sources of truth." >&2
    exit 2
  fi
fi

# ═══════════════════════════════════════════════════════════════
# Everything else — allow
# ═══════════════════════════════════════════════════════════════

exit 0
