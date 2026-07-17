#!/bin/bash
# BEHAVIOR scenario 5 — missing codex. A shim directory prepended to PATH
# hides only codex (the shim rejects the CLI contract → transport exit 21,
# the receipted codex_unavailable classification); the scripted input answers
# the degradation stop with the literal line `continue`; the run completes
# Claude-only; every seal labeled single-family; the completion line
# discloses it plainly. Exit 0 = pass.
. "$(dirname "$0")/lib.sh"

WD=$(mktemp -d)
SHIM=$(mktemp -d)
# T-07: the shim must land on kiln-review's codex_unavailable path (21), never
# transport failure (20). Receipted detection (kiln-review:138-142): exit
# 126/127, or the usage signature on STDERR. This shim does both.
printf '#!/bin/sh\necho "Usage: codex [OPTIONS] [COMMAND]" >&2\nexit 127\n' > "$SHIM/codex"
chmod +x "$SHIM/codex"
echo "S5 workdir: $WD (shim: $SHIM)"

# Phase 1: the run reaches the degradation hard stop and ends its turn asking.
( cd "$WD" && PATH="$SHIM:$PATH" timeout "$RUN_TIMEOUT" claude -p "$S1_INVOCATION" \
    --plugin-dir "$KILN_PLUGIN_DIR" --permission-mode bypassPermissions \
    --output-format stream-json --verbose </dev/null >"$WD/transcript1.jsonl" 2>"$WD/transcript1.err" )

# T-08: the classification is one machine fact — a COMPLETED gate:review
# workflow event whose parsed resultPreview.exit is 21 (the T-07-receipted
# codex_unavailable classification) — and phase one holds NEITHER a completion
# line NOR a seal before the acknowledgment.
jq -se '[.[] | .workflow_progress[]? | select(.label == "gate:review" and .state == "done"
          and ((((.resultPreview // "{}") | (fromjson? // {})) | .exit) == 21))] | length > 0' \
  "$WD/transcript1.jsonl" >/dev/null \
  || fail "no completed gate:review event classified exit 21 (codex_unavailable)"
beats "$WD/transcript1.jsonl" | grep -iE 'driver' | grep -qE '[0-9]+' \
  && fail "phase one spoke a completion line before the acknowledgment"
[ -s "$WD/.kiln/seals.log" ] && fail "phase one sealed before the acknowledgment"

# Phase 2: the scripted acknowledgment — the literal line `continue` into the
# SAME conversation (claude --continue is cwd-scoped; this workdir holds
# exactly one). The shim stays on PATH: codex remains hidden.
( cd "$WD" && PATH="$SHIM:$PATH" timeout "$RUN_TIMEOUT" claude -p --continue 'continue' \
    --plugin-dir "$KILN_PLUGIN_DIR" --permission-mode bypassPermissions \
    --output-format stream-json --verbose </dev/null >"$WD/transcript2.jsonl" 2>"$WD/transcript2.err" )

# Completion + plain disclosure on the completion line.
beats "$WD/transcript2.jsonl" | grep -iE 'driver' | grep -qE '[0-9]+' \
  || fail "no completion line after the acknowledgment"
beats "$WD/transcript2.jsonl" | grep -iE 'driver' | grep -qi 'single-family' \
  || fail "completion line does not disclose the degradation"

# T-09: every seal's LABEL FIELD equals single-family exactly (seals.log
# format is "<slice> <label>" — kiln-review/kernel seal:append receipt).
[ -s "$WD/.kiln/seals.log" ] || fail "no seals recorded"
awk 'NF < 2 || $2 != "single-family" { bad=1 } END { exit bad }' "$WD/.kiln/seals.log" \
  || fail "a seal label field is not exactly single-family"

# The working code still ships Claude-only.
( cd "$WD" && test -f index.html && grep -qF "Hello, Forge" index.html ) \
  || fail "Claude-only run did not produce the working site"

echo "S5 PASS (degraded honestly, sealed single-family, disclosed plainly)"
