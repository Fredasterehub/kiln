#!/bin/bash
# Shared helpers for the five BEHAVIOR-SCENARIOS runners. Lean by law (INTAKE
# item 5): assertions are the annex's, nothing more.
#
# Platform receipts honored (.kiln-dev/rework/walk-receipts/ + skeleton-plan):
# - Invocation is NAMESPACED: plugin skills register as /kiln:kiln-fire only
#   (run1 receipt: bare /kiln-fire = unknown command). The annex-locked
#   invocation TEXT rides after the namespace prefix; run4/launch.sh is the
#   reference execution.
# - Isolation choice: FULL PROFILE. `--bare` strips the Workflow tool
#   (run3 receipt bare-attempt.jsonl, wf:False); a scratch CLAUDE_CONFIG_DIR
#   loses auth ("Not logged in" probe receipt, 2026-07-17, claude 2.1.212).
#   Full profile is the leanest working option; revisit only with a doc-
#   receipted settings-level alternative.
# - Anchors match per-turn assistant beat events IN ORDER, never a
#   whole-transcript regex (run3/run4 receipt: generic words in early prose).
# - Driver meter (R2): per-turn `result` events carry usage; driver tokens per
#   transition = input_tokens + output_tokens (cache reads excluded). The
#   FIELD definition is a slice-8 ruling input; it lives only here.
set -u

KILN_PLUGIN_DIR="${KILN_PLUGIN_DIR:-/DEV/kiln/plugins/kiln}"
KILN_REVIEW="$KILN_PLUGIN_DIR/scripts/kiln-review"
FIXTURES="$KILN_PLUGIN_DIR/tests/fixtures"
RUN_TIMEOUT="${RUN_TIMEOUT:-3600}"

# PROVISIONAL ceilings (BEHAVIOR §run) — recalibrated ONCE at slice 8 from the
# skeleton baseline, locked thereafter. Recalibration = editing these two lines.
DRIVER_TRANSITION_CEILING=1500
DRIVER_RUN_CEILING=25000

S1_INVOCATION='/kiln:kiln-fire hello-forge: a static one-page site titled "Hello, Forge" with a nav linking to three in-page sections — About, Data, Contact. Plain HTML and CSS, no build tooling.'

fail() { echo "FAIL: $*" >&2; exit 1; }
note() { echo "  $*"; }

launch_run() { # $1=workdir $2=invocation $3=transcript-path [extra flags...]
  local wd="$1" inv="$2" t="$3"; shift 3
  ( cd "$wd" && timeout "$RUN_TIMEOUT" claude -p "$inv" \
      --plugin-dir "$KILN_PLUGIN_DIR" --permission-mode bypassPermissions \
      --output-format stream-json --verbose "$@" </dev/null >"$t" 2>"${t}.err" )
}

beats() { # assistant text blocks, in order, newlines flattened, one per line
  jq -r 'select(.type=="assistant") | .message.content[]? | select(.type=="text") | .text | gsub("\n"; " ")' "$1" 2>/dev/null
}

first_match_line() { # $1=regex(ERE) — 1-based index of first matching beat, empty if none
  grep -inE "$1" | head -1 | cut -d: -f1
}

assert_anchor_order() { # $1=transcript $2=workdir — annex N1..N7 in order
  # N2–N5 bind to the BOLD active-stage marker (**Law** / **BUILD** …): banner
  # progress lines name every stage in italic, so a bare word regex false-hits
  # (run4 receipt). Bold is the sealed grammar's "this stage is active" mark.
  local t="$1" wd="$2" b n1 n2 n3 n4 n5 n6 n7 id line
  b=$(mktemp); beats "$t" > "$b"
  n1=$(first_match_line '\bKiln\b' < "$b")
  n2=$(first_match_line '\*\*(LAW|Law)\*\*' < "$b")
  n3=$(first_match_line '\*\*(BUILD|Build)\*\*' < "$b")
  n4=$(first_match_line '\*\*(VALIDATE|Validate)\*\*' < "$b")
  n5=$(first_match_line '\*\*(REPORT|Report)\*\*' < "$b")
  # T-01: candidate /seal/i beats filtered CUMULATIVELY by every field-1 slice
  # id in seals.log; N6 = the earliest single surviving beat (the kernel's
  # per-stage return carries all seal lines in one beat block, so one beat
  # names every sealed slice).
  local cand
  cand=$(grep -inE 'seal' "$b")
  while read -r id _; do
    [ -n "$id" ] || continue
    cand=$(printf '%s\n' "$cand" | grep -F "$id")
    [ -n "$cand" ] || { rm -f "$b"; fail "no single seal beat names every sealed slice (missing: $id)"; }
  done < "$wd/.kiln/seals.log"
  n6=$(printf '%s\n' "$cand" | head -1 | cut -d: -f1)
  # T-02: N7's spoken integer must EQUAL the computed full-run driver total.
  local n7line spoken total
  n7line=$(grep -inE 'driver' "$b" | grep -E '[0-9]+' | head -1)
  n7=$(echo "$n7line" | cut -d: -f1)
  spoken=$(echo "$n7line" | cut -d: -f2- | grep -oE '[0-9][0-9,]*' | head -1 | tr -d ',')
  total=$(driver_total "$t")
  rm -f "$b"
  for v in n1 n2 n3 n4 n5 n6 n7; do [ -n "${!v}" ] || fail "anchor $v absent"; done
  [ "$spoken" = "$total" ] || fail "N7 speaks $spoken driver tokens; the transcript computes $total — the completion line must state the measured number"
  [ "$n1" -le "$n2" ] && [ "$n2" -le "$n3" ] && [ "$n3" -le "$n4" ] && \
  [ "$n4" -le "$n5" ] && [ "$n5" -le "$n7" ] || fail "stage anchors out of order ($n1,$n2,$n3,$n4,$n5,$n7)"
  [ "$n6" -ge "$n3" ] && [ "$n6" -le "$n7" ] || fail "seal anchor out of position ($n6)"
}

driver_total() { # $1=transcript — the computed full-run driver-token total
  jq -r 'select(.type=="result") | ((.usage.input_tokens // 0) + (.usage.output_tokens // 0))' "$1" \
    | awk '{ t+=$1 } END { print t+0 }'
}

driver_meter() { # $1=transcript — prints per-turn tokens, asserts ceilings + no upward trend
  local t="$1" turns total=0 i=0 max=0
  turns=$(jq -r 'select(.type=="result") | ((.usage.input_tokens // 0) + (.usage.output_tokens // 0))' "$t")
  [ -n "$turns" ] || fail "no result events — no meter"
  # least-squares slope over turn index; "not trending upward" = slope <= 0 (annex literal)
  local slope
  slope=$(echo "$turns" | awk '{ n++; sx+=n; sy+=$1; sxy+=n*$1; sxx+=n*n }
    END { if (n<2) { print 0; exit } ; print (n*sxy - sx*sy) / (n*sxx - sx*sx) }')
  for v in $turns; do
    i=$((i+1)); total=$((total+v)); [ "$v" -gt "$max" ] && max=$v
    note "transition $i: $v driver tokens"
  done
  note "run total: $total driver tokens (ceilings: $DRIVER_TRANSITION_CEILING/transition, $DRIVER_RUN_CEILING/run; slope: $slope)"
  [ "$max" -le "$DRIVER_TRANSITION_CEILING" ] || fail "transition ceiling exceeded: $max > $DRIVER_TRANSITION_CEILING (PROVISIONAL — slice-8 recalibration)"
  [ "$total" -le "$DRIVER_RUN_CEILING" ] || fail "run ceiling exceeded: $total > $DRIVER_RUN_CEILING (PROVISIONAL — slice-8 recalibration)"
  case "$slope" in -*|0) : ;; *) fail "per-transition tokens trend upward (slope $slope)";; esac
}

assert_state_fields() { # $1=STATE.md — the six locked fields as ^field: lines (T-03)
  local f
  for f in stage active_slice next_action pointers seals updated_at; do
    grep -qE "^${f}:" "$1" || fail "STATE.md missing field line: ^${f}:"
  done
}

assert_s1_artifacts() { # $1=workdir — annex expected artifacts + A1..A4
  local wd="$1"
  ( cd "$wd" || exit 1
    test -f index.html || fail "A1: index.html missing"
    grep -qF "Hello, Forge" index.html || fail "A2: title string missing"
    for a in $(grep -o 'href="#[^"]*"' index.html | sed 's/href="#//;s/"$//'); do
      grep -q "id=\"$a\"" index.html || fail "A3: unresolved anchor #$a"
    done
    [ -f .kiln/STATE.md ] || fail "artifact: STATE.md"
    [ -f .kiln/LAW.md ] || fail "artifact: LAW.md"
    [ -f .kiln/decisions.md ] || fail "artifact: decisions.md"
    [ -f .kiln/gate-review.json ] || fail "artifact: gate-review.json"
    ls .kiln/*.md | grep -vE 'STATE|LAW|decisions' | grep -q . || fail "artifact: no stage-output markdown"
    [ "$(jq -r .verdict .kiln/gate-review.json)" = accept ] || fail "A4: gate record not accept"
    # T-04: the gate carries its hash — it must equal the CURRENT LAW.md.
    [ "$(jq -r .law_hash .kiln/gate-review.json)" = "$(sha256sum .kiln/LAW.md | cut -d' ' -f1)" ] \
      || fail "A4: gate law_hash does not match current .kiln/LAW.md"
    bash .kiln/law/check.sh || fail "A4: fresh LAW rerun red"
  ) || exit 1
  assert_state_fields "$wd/.kiln/STATE.md"
}

gate_request() { # $1=workdir — writes request.json with the annex-locked criteria
  local wd="$1" h
  h=$(sha256sum "$wd/LAW.md" | cut -d' ' -f1)
  jq -n --arg h "$h" '{
    reviewer_model: "gpt-5.6-sol",
    law_hash: $h,
    criteria: "median(xs): odd length → the middle value; even length → the mean of the two middle values.",
    paths: ["slice/median.mjs", "slice/median.test.mjs", "LAW.md"],
    failures: [],
    commands: ["node --test slice/"]
  }' > "$wd/request.json"
}
