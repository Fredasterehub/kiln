#!/usr/bin/env bash
set -euo pipefail

# Kiln cross-reference validation
# Checks: agent->skill refs, skill->template refs, model assignments, hook->script refs

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PASS=0
FAIL=0
WARN=0

pass() {
  printf '  PASS: %s\n' "$1"
  PASS=$((PASS + 1))
}

fail() {
  printf '  FAIL: %s\n' "$1"
  FAIL=$((FAIL + 1))
}

warn() {
  printf '  WARN: %s\n' "$1"
  WARN=$((WARN + 1))
}

contains() {
  local needle="$1"
  shift
  local value
  for value in "$@"; do
    if [ "$value" = "$needle" ]; then
      return 0
    fi
  done
  return 1
}

trim_ref() {
  printf '%s' "$1" | sed 's/^[`"'"'"']\+//; s/[`"'"'"'.,;:)]\+$//'
}

AGENT_NAMES=()
while IFS= read -r file; do
  AGENT_NAMES+=("$(basename "${file%.md}")")
done < <(find "$REPO_ROOT/agents" -maxdepth 1 -type f -name '*.md' | sort)

SKILL_NAMES=()
while IFS= read -r file; do
  SKILL_NAMES+=("$(basename "${file%.md}")")
done < <(find "$REPO_ROOT/skills" -mindepth 2 -maxdepth 2 -type f -name '*.md' | sort)

echo "Validation 1: Agent-to-skill references"
while IFS= read -r agent_path; do
  rel_agent="${agent_path#$REPO_ROOT/}"
  token_tmp="$(mktemp)"

  # Direct references to known skills anywhere in the agent file.
  for skill_name in "${SKILL_NAMES[@]}"; do
    if grep -Eq "(^|[^a-zA-Z0-9-])${skill_name}([^a-zA-Z0-9-]|$)" "$agent_path"; then
      printf '%s\n' "$skill_name" >>"$token_tmp"
    fi
  done

  # Unknown kiln-* tokens in "skill" context are likely typos and should fail.
  awk 'tolower($0) ~ /skill/ {print}' "$agent_path" \
    | grep -Eo 'kiln-[a-z0-9-]+' \
    | while IFS= read -r token; do
      if ! contains "$token" "${SKILL_NAMES[@]}" && ! contains "$token" "${AGENT_NAMES[@]}"; then
        printf '%s\n' "$token"
      fi
    done >>"$token_tmp" || true

  # Explicit skills/<name>/<name>.md paths.
  grep -Eo 'skills/kiln-[a-z0-9-]+/kiln-[a-z0-9-]+\.md' "$agent_path" \
    | sed -E 's#skills/(kiln-[a-z0-9-]+)/.*#\1#' \
    | sort -u >>"$token_tmp" || true

  if [ ! -s "$token_tmp" ]; then
    warn "$rel_agent has no explicit skill references"
    rm -f "$token_tmp"
    continue
  fi

  while IFS= read -r token; do
    if contains "$token" "${SKILL_NAMES[@]}"; then
      pass "$rel_agent references existing skill '$token'"
    else
      fail "$rel_agent references unknown skill token '$token'"
    fi
  done < <(sort -u "$token_tmp")
  rm -f "$token_tmp"
done < <(find "$REPO_ROOT/agents" -maxdepth 1 -type f -name '*.md' | sort)

echo ""
echo "Validation 2: Skill-to-template references"
while IFS= read -r skill_path; do
  rel_skill="${skill_path#$REPO_ROOT/}"
  ref_tmp="$(mktemp)"
  normalized_tmp="$(mktemp)"

  grep -Eo 'templates/[A-Za-z0-9._/-]+' "$skill_path" >"$ref_tmp" || true
  grep -Eo '[A-Za-z0-9._-]+\.tmpl(\.md)?' "$skill_path" >>"$ref_tmp" || true

  if [ ! -s "$ref_tmp" ]; then
    warn "$rel_skill has no template references"
    rm -f "$ref_tmp"
    rm -f "$normalized_tmp"
    continue
  fi

  while IFS= read -r raw_ref; do
    ref="$(trim_ref "$raw_ref")"
    [ -n "$ref" ] && printf '%s\n' "$ref" >>"$normalized_tmp"
  done <"$ref_tmp"

  while IFS= read -r raw_ref; do
    ref="$raw_ref"

    if [[ "$ref" == templates/* ]]; then
      target="$REPO_ROOT/$ref"
      if [ -f "$target" ]; then
        pass "$rel_skill template exists: $ref"
      elif [ -d "$target" ]; then
        warn "$rel_skill references template directory: $ref"
      else
        fail "$rel_skill missing template path: $ref"
      fi
      continue
    fi

    if [[ "$ref" == *.tmpl || "$ref" == *.tmpl.md ]]; then
      match="$(find "$REPO_ROOT/templates" -type f -name "$ref" | head -n 1)"
      if [ -n "$match" ]; then
        pass "$rel_skill template exists: templates/${match##*/}"
      else
        fail "$rel_skill missing template file: $ref"
      fi
    fi
  done < <(sort -u "$normalized_tmp")
  rm -f "$ref_tmp"
  rm -f "$normalized_tmp"
done < <(find "$REPO_ROOT/skills" -mindepth 2 -maxdepth 2 -type f -name '*.md' | sort)

echo ""
echo "Validation 3: Model assignments"
declare -A EXPECTED_MODELS=(
  ["kiln-orchestrator"]="opus"
  ["kiln-brainstormer"]="opus"
  ["kiln-planner"]="opus"
  ["kiln-codex-planner"]="sonnet"
  ["kiln-synthesizer"]="opus"
  ["kiln-validator"]="sonnet"
  ["kiln-sharpener"]="sonnet"
  ["kiln-executor"]="sonnet"
  ["kiln-e2e-verifier"]="sonnet"
  ["kiln-reviewer"]="opus"
  ["kiln-codex-reviewer"]="sonnet"
  ["kiln-researcher"]="haiku"
)

for agent_name in "${!EXPECTED_MODELS[@]}"; do
  agent_file="$REPO_ROOT/agents/${agent_name}.md"
  if [ ! -f "$agent_file" ]; then
    fail "Missing agent file for model validation: agents/${agent_name}.md"
    continue
  fi

  declared_model="$(
    awk '
      BEGIN { in_frontmatter=0; delimiters=0 }
      /^---$/ { delimiters++; if (delimiters == 1) { in_frontmatter=1; next } if (delimiters == 2) { exit } }
      in_frontmatter && /^model:[[:space:]]*/ { sub(/^model:[[:space:]]*/, "", $0); print $0; exit }
    ' "$agent_file"
  )"

  if [ -z "$declared_model" ]; then
    fail "agents/${agent_name}.md is missing model in frontmatter"
  elif [ "$declared_model" = "${EXPECTED_MODELS[$agent_name]}" ]; then
    pass "agents/${agent_name}.md model '$declared_model' matches expected"
  else
    fail "agents/${agent_name}.md model '$declared_model' != expected '${EXPECTED_MODELS[$agent_name]}'"
  fi
done

echo ""
echo "Validation 4: Hook-to-script references"
hooks_file="$REPO_ROOT/hooks/hooks.json"
if [ ! -f "$hooks_file" ]; then
  fail "hooks/hooks.json is missing"
else
  command_tmp="$(mktemp)"
  grep -Eo '"command"[[:space:]]*:[[:space:]]*"[^"]+"' "$hooks_file" \
    | sed -E 's/^"command"[[:space:]]*:[[:space:]]*"([^"]+)"/\1/' >"$command_tmp" || true

  if [ ! -s "$command_tmp" ]; then
    fail "No hook commands found in hooks/hooks.json"
  fi

  while IFS= read -r command; do
    script_ref="$(printf '%s\n' "$command" | grep -Eo 'hooks/scripts/[A-Za-z0-9._/-]+\.sh' || true)"
    if [ -z "$script_ref" ]; then
      warn "Hook command has no hooks/scripts path: $command"
      continue
    fi

    script_path="$REPO_ROOT/$script_ref"
    if [ ! -f "$script_path" ]; then
      fail "Hook references missing script: $script_ref"
      continue
    fi
    pass "Hook script exists: $script_ref"

    shebang="$(head -n 1 "$script_path")"
    if [ "$shebang" = "#!/bin/sh" ] || [ "$shebang" = "#!/usr/bin/env sh" ]; then
      pass "Hook script shebang is valid POSIX sh: $script_ref"
    else
      fail "Hook script shebang must be sh for $script_ref (got: $shebang)"
    fi
  done < <(sort -u "$command_tmp")
  rm -f "$command_tmp"
fi

echo ""
echo "Validation 5: File completeness"
agent_count="$(find "$REPO_ROOT/agents" -maxdepth 1 -type f -name '*.md' | wc -l | awk '{print $1}')"
skill_count="$(find "$REPO_ROOT/skills" -mindepth 2 -maxdepth 2 -type f -name '*.md' | wc -l | awk '{print $1}')"
hook_script_count="$(find "$REPO_ROOT/hooks/scripts" -maxdepth 1 -type f -name '*.sh' | wc -l | awk '{print $1}')"

[ "$agent_count" -eq 12 ] && pass "agents/*.md count is 12" || fail "agents/*.md count expected 12, got $agent_count"
[ "$skill_count" -eq 15 ] && pass "skills/*/*.md count is 15" || fail "skills/*/*.md count expected 15, got $skill_count"
[ "$hook_script_count" -eq 2 ] && pass "hooks/scripts/*.sh count is 2" || fail "hooks/scripts/*.sh count expected 2, got $hook_script_count"

REQUIRED_TEMPLATES=(
  "templates/FINAL_REPORT.md.tmpl"
  "templates/STATE.md.tmpl"
  "templates/config.json.tmpl"
  "templates/vision-sections.md"
  "templates/teams/brainstorm/brainstorm-session.tmpl.md"
  "templates/teams/track/index.tmpl.md"
  "templates/teams/track/task-packet.tmpl.md"
  "templates/teams/verify/verdict.tmpl.md"
)

for template_rel in "${REQUIRED_TEMPLATES[@]}"; do
  if [ -f "$REPO_ROOT/$template_rel" ]; then
    pass "Required template exists: $template_rel"
  else
    fail "Missing required template: $template_rel"
  fi
done

echo ""
echo "Cross-reference validation: $PASS passed, $FAIL failed, $WARN warnings"
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
echo "All cross-references valid!"
