#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PASS=0
FAIL=0
WARN=0

pass() { echo "PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "FAIL: $1"; FAIL=$((FAIL + 1)); }
warn() { echo "WARN: $1"; WARN=$((WARN + 1)); }

echo "Running package validation in $REPO_ROOT"
echo

PACK_OUTPUT=""
if PACK_OUTPUT="$(npm pack --dry-run --json 2>&1)"; then
  pass "npm pack --dry-run --json succeeded"
else
  fail "npm pack --dry-run --json failed"
  echo "$PACK_OUTPUT"
fi

PACK_FILES=""
if [ "$FAIL" -eq 0 ]; then
  if PACK_FILES="$(printf '%s' "$PACK_OUTPUT" | node -e '
    const fs = require("fs");
    const input = fs.readFileSync(0, "utf8").trim();
    let parsed;
    try {
      parsed = JSON.parse(input);
    } catch (error) {
      console.error("failed to parse npm pack JSON:", error.message);
      process.exit(1);
    }
    if (!Array.isArray(parsed) || parsed.length === 0 || !Array.isArray(parsed[0].files)) {
      console.error("unexpected npm pack JSON shape");
      process.exit(1);
    }
    for (const file of parsed[0].files) {
      if (file && typeof file.path === "string") {
        console.log(file.path);
      }
    }
  ')"; then
    pass "parsed npm pack file list"
  else
    fail "unable to parse npm pack file list"
  fi
fi

contains_path() {
  local needle="$1"
  printf '%s\n' "$PACK_FILES" | grep -Fqx "$needle"
}

has_prefix() {
  local prefix="$1"
  while IFS= read -r packaged_path; do
    case "$packaged_path" in
      "$prefix"*) return 0 ;;
    esac
  done <<<"$PACK_FILES"
  return 1
}

if [ "$FAIL" -eq 0 ]; then
  required_paths=(
    "bin/install.js"
    "package.json"
    "README.md"
    "hooks/hooks.json"
    "hooks/scripts/on-session-start.sh"
    "hooks/scripts/on-task-completed.sh"
    "skills/kiln-core/kiln-core.md"
    "skills/kiln-init/kiln-init.md"
    "skills/kiln-status/kiln-status.md"
    "skills/kiln-quick/kiln-quick.md"
    "skills/kiln-brainstorm/kiln-brainstorm.md"
    "skills/kiln-plan/kiln-plan.md"
    "skills/kiln-execute/kiln-execute.md"
    "skills/kiln-e2e/kiln-e2e.md"
    "skills/kiln-verify/kiln-verify.md"
    "skills/kiln-track/kiln-track.md"
    "skills/kiln-reconcile/kiln-reconcile.md"
    "skills/kiln-roadmap/kiln-roadmap.md"
    "skills/kiln-fire/kiln-fire.md"
    "skills/kiln-cool/kiln-cool.md"
    "skills/kiln-debate/kiln-debate.md"
    "templates/config.json.tmpl"
    "templates/STATE.md.tmpl"
    "templates/vision-sections.md"
    "templates/FINAL_REPORT.md.tmpl"
    "templates/teams/verify/verdict.tmpl.md"
    "templates/teams/track/index.tmpl.md"
    "templates/teams/track/task-packet.tmpl.md"
    "templates/teams/brainstorm/brainstorm-session.tmpl.md"
  )

  missing_required=0
  for path in "${required_paths[@]}"; do
    if contains_path "$path"; then
      pass "package includes $path"
    else
      fail "package is missing $path"
      missing_required=1
    fi
  done
  if [ "$missing_required" -eq 0 ]; then
    pass "all required files are present"
  fi

  agent_count="$(printf '%s\n' "$PACK_FILES" | grep -E '^agents/[^/]+\.md$' | wc -l | tr -d '[:space:]')"
  if [ "${agent_count:-0}" -ge 12 ]; then
    pass "package includes at least 12 agent markdown files (${agent_count})"
  else
    fail "expected at least 12 agent markdown files, found ${agent_count:-0}"
  fi

  template_count="$(printf '%s\n' "$PACK_FILES" | grep -E '^templates/.+\.(tmpl|md)(\.md)?$' | wc -l | tr -d '[:space:]')"
  if [ "${template_count:-0}" -ge 1 ]; then
    pass "package includes template files (${template_count})"
  else
    fail "no template files found in package"
  fi

  forbidden_prefixes=(
    ".claude/"
    "tracks/"
    ".teams/"
    "docs/plans/"
    "node_modules/"
    ".git/"
    "tests/"
  )

  leaked=0
  for prefix in "${forbidden_prefixes[@]}"; do
    if has_prefix "$prefix"; then
      fail "package leaks dev/build files under ${prefix}"
      leaked=1
    fi
  done
  if [ "$leaked" -eq 0 ]; then
    pass "no forbidden dev/build files are included"
  fi
fi

pkg_name="$(node -p "require('./package.json').name || ''")"
if [ "$pkg_name" = "kiln-one" ]; then
  pass "package.json name is kiln-one"
else
  fail "package.json name must be kiln-one (found: $pkg_name)"
fi

pkg_bin="$(node -e "
  const p = require('./package.json');
  const value = typeof p.bin === 'string' ? p.bin : (p.bin && p.bin['kiln-one']);
  process.stdout.write(String(value || ''));
")"
if [ "$pkg_bin" = "bin/install.js" ]; then
  pass "package.json bin points to bin/install.js"
else
  fail "package.json bin must point to bin/install.js (found: $pkg_bin)"
fi

if node -e "
  const p = require('./package.json');
  const files = Array.isArray(p.files) ? p.files.map((f) => String(f).replace(/\/$/, '')) : [];
  const required = ['agents', 'skills', 'hooks', 'bin', 'templates'];
  const missing = required.filter((entry) => !files.includes(entry));
  if (missing.length > 0) {
    console.error(missing.join(','));
    process.exit(1);
  }
"; then
  pass "package.json files whitelist includes agents/ skills/ hooks/ bin/ templates/"
else
  fail "package.json files whitelist is missing required entries"
fi

dep_count="$(node -p "Object.keys(require('./package.json').dependencies || {}).length")"
if [ "$dep_count" -eq 0 ]; then
  pass "package.json has zero runtime dependencies"
else
  fail "package.json has runtime dependencies ($dep_count found)"
fi

PUBLISH_OUTPUT=""
if PUBLISH_OUTPUT="$(npm publish --dry-run 2>&1)"; then
  pass "npm publish --dry-run succeeded"
else
  if printf '%s' "$PUBLISH_OUTPUT" | grep -Eiq 'ENEEDAUTH|E401|E403|EOTP|auth|login|not authorized|not logged in|previously published'; then
    warn "npm publish --dry-run did not complete due to auth/registry constraints; pack validation still passed"
  else
    fail "npm publish --dry-run failed unexpectedly"
    echo "$PUBLISH_OUTPUT"
  fi
fi

echo
echo "Summary: PASS=$PASS WARN=$WARN FAIL=$FAIL"
if [ "$FAIL" -ne 0 ]; then
  exit 1
fi
