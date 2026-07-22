#!/usr/bin/env bash
# detect-brownfield.sh — the onboarding preflight's bounded, deterministic
# brownfield classifier (W3-ARCH-06). Classification is never model judgment: this
# helper walks the target dir once, prunes Kiln's own workspace, VCS metadata, and
# vendored/generated trees, ignores prose-only scaffolding (README/LICENSE/docs),
# and prints `brownfield` on the first surviving package/runtime manifest,
# substantive source file, test, or entry point — else `greenfield`. It always
# exits 0; the single stdout token is the closed fact the compiler branches on. A
# preflight helper, not a perceptual/evidence CLI.
set -euo pipefail

dir="${1:?usage: detect-brownfield.sh <dir>}"

# Whole subtrees that never count as project substance — pruned so nothing inside
# them ever reaches classification. Simple tokens only (no globs), so leaving the
# expression unquoted below splits it into find's argv exactly as written.
prune='-name .kiln -o -name .git -o -name node_modules -o -name vendor -o -name dist -o -name build -o -name target -o -name .venv -o -name venv -o -name __pycache__ -o -name .next -o -name out -o -name coverage -o -name .terraform -o -name generated'

# The walk is captured, not read through process substitution: a substitution would
# swallow find's exit status, so a walk that never completed (an unreadable subtree, a
# find error) would fall through to greenfield — the false claim "nothing to build on."
# A failed walk cannot prove absence, so it classifies brownfield, the cautious fact (the
# LAW then demands a codebase map). Exit stays 0 either way: the verdict is the token.
verdict=greenfield
if ! files=$(find "$dir" \( -type d \( $prune \) -prune \) -o -type f -print); then
  printf '%s\n' brownfield
  exit 0
fi
while IFS= read -r f; do
  base=${f##*/}
  # Path relative to the target, bracketed by separators so a test-tree segment
  # (*/tests/*) matches whether the walk root was absolute, ".", or trailing-slashed.
  rel="/${f#"$dir"}/"
  case "$base" in
    # Package / runtime manifests — a declared project.
    package.json|pyproject.toml|setup.py|setup.cfg|requirements.txt|Pipfile|go.mod|Cargo.toml|pom.xml|build.gradle|build.gradle.kts|settings.gradle|Gemfile|composer.json|Makefile|makefile|GNUmakefile|CMakeLists.txt|tsconfig.json|deno.json|deno.jsonc|mix.exs|pubspec.yaml|build.sbt|*.csproj|*.gemspec)
      verdict=brownfield; break ;;
  esac
  case "$base" in
    # Substantive source by extension — real code on disk.
    *.js|*.mjs|*.cjs|*.jsx|*.ts|*.tsx|*.py|*.go|*.rs|*.rb|*.java|*.kt|*.kts|*.scala|*.c|*.cc|*.cpp|*.cxx|*.h|*.hpp|*.cs|*.php|*.swift|*.m|*.mm|*.lua|*.ex|*.exs|*.erl|*.dart|*.vue|*.svelte|*.sh|*.bash|*.zsh|*.pl|*.sql|*.r|*.jl|*.clj|*.hs)
      verdict=brownfield; break ;;
  esac
  case "$base" in
    # Entry points named by convention — a runnable web root is a project to build on.
    index.html|index.htm)
      verdict=brownfield; break ;;
  esac
  case "$rel" in
    # A conventional test tree — authored tests are substance whatever their file
    # extension (e.g. tests/x.feature), which the source allowlist above cannot see.
    */test/*|*/tests/*|*/spec/*|*/specs/*|*/__tests__/*|*/features/*)
      verdict=brownfield; break ;;
  esac
  # An executable regular file is a runnable program / entry point even with no
  # recognized extension (an extensionless bin/app) — substantive by its bit.
  if [ -x "$f" ]; then verdict=brownfield; break; fi
done <<< "$files"

printf '%s\n' "$verdict"
