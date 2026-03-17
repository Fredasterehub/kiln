#!/bin/bash
# enforce-pipeline.sh — PreToolUse hook for Kiln pipeline
#
# 17 hooks across 5 categories (hook 2 removed v1.0.4, hooks 14-15+17 added v1.1):
#   Delegation (1-3,14):  delegation agents cannot Write/Edit files directly
#   Sequencing (4-6):     gate dispatches until bootstrap docs are ready
#   Flags (7-10):         block incorrect codex exec flags
#   Safety (11-13):       protect system config, prevent rm -rf, block memory reads
#   Lifecycle (15,17):    boss shutdown block, agent spawn whitelist
#
# Stateless. Exit 2 + stderr = block. Exit 0 = allow.
# Note: strips kiln: prefix from AGENT, RECIPIENT, SUBTYPE — plugin namespace
# should not leak into hook matching or UI labels.

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name // ""')

# Fast exit for tools we don't check
case "$TOOL" in
  Write|Edit|Bash|SendMessage|Read|Agent) ;;
  *) exit 0 ;;
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
  [[ -f "$1" ]] && head -1 "$1" | grep -qE '<!-- status: (complete|active) -->'
}

# ── Pipeline context gate ────────────────────────────────────
# All enforcement is pipeline-specific. No .kiln/ directory in the
# current path hierarchy means no active pipeline — allow everything.
KILN_ROOT=$(_find_root)
if [[ -z "$KILN_ROOT" ]] && [[ -z "$AGENT" ]]; then
  exit 0
fi

# ═══════════════════════════════════════════════════════════════
# DELEGATION — hooks 1, 2, 3
# Agents that wrap codex exec must not write files directly.
# ═══════════════════════════════════════════════════════════════

# Hook 1 — codex wrappers: no Write/Edit
if [[ "$AGENT" =~ ^(codex|morty|luke)$ ]] && [[ "$TOOL" =~ ^(Write|Edit)$ ]]; then
  cat >&2 <<'MSG'
STOP. You are a codex exec wrapper — you do not write files.

Your workflow:
  1. READ context: .kiln/master-plan.md, .kiln/docs/architecture.md,
     .kiln/docs/tech-stack.md, .kiln/docs/codebase-state.md,
     .kiln/docs/patterns.md, .kiln/docs/pitfalls.md
  2. Construct prompt: cat <<'EOF' > /tmp/kiln_prompt.md
  3. Invoke: codex exec --sandbox danger-full-access -C "{working_dir}" < /tmp/kiln_prompt.md
  4. Verify output, run tests, commit, REVIEW_REQUEST to your paired reviewer.
MSG
  exit 2
fi

# Hook 2 — (removed v1.0.4: plato now writes directly as opus synthesizer)

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
# KILN_ROOT guaranteed non-empty by pipeline context gate above.
# ═══════════════════════════════════════════════════════════════

# Hook 4 — krs-one: no dispatch to build workers until rakim+sentinel ready
if [[ "$AGENT" == "krs-one" ]] && [[ "$TOOL" == "SendMessage" ]] && [[ "$RECIPIENT" =~ ^(codex|morty|luke|kaneda|tetsuo|johnny|clair|yin|recto|sphinx|rick|obiwan|obscur|yang|verso)$ ]]; then
  if ! _status_ok "$KILN_ROOT/.kiln/docs/codebase-state.md" || ! _status_ok "$KILN_ROOT/.kiln/docs/patterns.md"; then
    cat >&2 <<'MSG'
BLOCKED: rakim and sentinel haven't finished bootstrapping.

Wait for BOTH READY summaries (in your runtime prompt) before dispatching:
  1. rakim — codebase state (codebase-state.md must be complete)
  2. sentinel — patterns/pitfalls guidance (patterns.md must be complete)
MSG
    exit 2
  fi
fi

# Hook 5 — aristotle: no dispatch to planners until numerobis ready
if [[ "$AGENT" == "aristotle" ]] && [[ "$TOOL" == "SendMessage" ]] && [[ "$RECIPIENT" =~ ^(confucius|sun-tzu|miyamoto|plato|athena)$ ]]; then
  if ! _status_ok "$KILN_ROOT/.kiln/docs/architecture.md"; then
    cat >&2 <<'MSG'
BLOCKED: numerobis hasn't finished writing architecture docs.

Wait for numerobis's READY message. architecture.md must have
<!-- status: complete --> on its first line before planners can be dispatched.
MSG
    exit 2
  fi
fi

# ═══════════════════════════════════════════════════════════════
# FLAGS — hooks 7, 8, 9, 10 (+ sequencing hook 6 as backup gate)
# Correct codex exec invocation: --sandbox danger-full-access only.
# Model configured in ~/.codex/config.toml. No extra flags.
# ═══════════════════════════════════════════════════════════════

if [[ "$AGENT" =~ ^(codex|morty|luke|sun-tzu)$ ]] && [[ "$TOOL" == "Bash" ]]; then
  if echo "$COMMAND" | grep -q 'codex exec'; then

    # Hook 6 — codex wrappers: backup sequencing gate (codex exec before bootstrap ready)
    if [[ "$AGENT" =~ ^(codex|morty|luke)$ ]]; then
      if ! _status_ok "$KILN_ROOT/.kiln/docs/architecture.md" || ! _status_ok "$KILN_ROOT/.kiln/docs/patterns.md"; then
        echo "BLOCKED: bootstrap docs not ready. Wait for krs-one's assignment." >&2
        exit 2
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

# Hook 11 — pipeline agents: no Write/Edit on system config (~/.codex/, ~/.claude/)
# Main session (empty AGENT) always passes — it owns these files.
if [[ -n "$AGENT" ]] && [[ "$TOOL" =~ ^(Write|Edit)$ ]]; then
  if [[ "$FILE_PATH" =~ (\.codex/|\.claude/settings|\.claude/projects/[^/]+/settings) ]]; then
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
  # Silent exit for any .claude/ Read — agents don't need these files,
  # but blocking loudly wastes a turn per agent (230 events in ST17).
  if [[ "$FILE_PATH" =~ /\.claude/ ]]; then
    exit 0
  fi
fi

# ═══════════════════════════════════════════════════════════════
# DELEGATION (continued) — hook 14
# ═══════════════════════════════════════════════════════════════

# Hook 14 — krs-one: no Write/Edit on source code (he's a scoper, not a coder)
# Exception: krs-one owns STATE.md updates and writes assignment files to .kiln/tmp/
if [[ "$AGENT" == "krs-one" ]] && [[ "$TOOL" =~ ^(Write|Edit)$ ]]; then
  if [[ "$FILE_PATH" =~ \.kiln/(STATE\.md|tmp/) ]]; then
    : # allowed — krs-one owns these files
  else
    cat >&2 <<'MSG'
STOP. You are the build boss — you scope and delegate, you do not write code.

Your workflow:
  1. Read READY summaries from rakim and sentinel
  2. Scope a focused chunk from master-plan.md
  3. Construct a structured XML assignment
  4. Dispatch to codex via SendMessage
  5. Wait for IMPLEMENTATION_COMPLETE
MSG
    exit 2
  fi
fi

# Hook 15 -- bosses: shutdown is engine's job
if [[ "$TOOL" == "SendMessage" ]] && [[ "$TYPE" == "shutdown_request" ]]; then
  if [[ "$AGENT" =~ ^(krs-one|aristotle|mi6|argus|alpha|da-vinci)$ ]]; then
    cat >&2 <<'MSG'
Worker shutdown is managed by the engine at step transitions.
After verifying deliverables, signal MILESTONE_COMPLETE to team-lead.
This is your last action for the milestone.
MSG
    exit 2
  fi
fi

# Hook 17 -- Only named Kiln agents can be spawned
if [[ "$TOOL" == "Agent" ]]; then
  SUBTYPE=$(echo "$INPUT" | jq -r '.tool_input.subagent_type // ""')
  SUBTYPE="${SUBTYPE#kiln:}"
  if [[ -n "$SUBTYPE" ]]; then
    case "$SUBTYPE" in
      alpha|mnemosyne|maiev|curie|medivh|\
      da-vinci|clio|\
      mi6|field-agent|\
      aristotle|numerobis|confucius|sun-tzu|plato|athena|\
      krs-one|rakim|sentinel|thoth|codex|morty|luke|kaneda|tetsuo|johnny|miyamoto|sphinx|rick|obiwan|\
      picasso|clair|yin|recto|renoir|obscur|yang|verso|\
      zoxea|argus|hephaestus|omega)
        ;; # allowed
      *)
        cat >&2 <<'MSG'
Only named Kiln agents can be spawned. Use agent types from the blueprint roster:
  Structural builders: codex, morty, luke, kaneda, tetsuo, johnny
  Structural reviewers: sphinx, rick, obiwan
  UI builders: clair, yin, recto (picasso protocol)
  UI reviewers: obscur, yang, verso (renoir protocol)
MSG
        exit 2
        ;;
    esac
  fi
fi

# ═══════════════════════════════════════════════════════════════
# Everything else — allow
# ═══════════════════════════════════════════════════════════════

exit 0
