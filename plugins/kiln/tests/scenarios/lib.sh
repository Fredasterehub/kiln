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
# - Driver meter (RATIFIED — heads ruling 2026-07-17, meter-ruling.sol.md +
#   recheck CONFIRMED): driver tokens = input_tokens + output_tokens per `result`
#   window, cache excluded; the product meter is kiln-meter.mjs over the session's
#   own transcript; the runner recovers `metered` per R-6' (see T-02).
set -u

KILN_PLUGIN_DIR="${KILN_PLUGIN_DIR:-/DEV/kiln/plugins/kiln}"
KILN_REVIEW="$KILN_PLUGIN_DIR/scripts/kiln-review"
TIERS="$KILN_PLUGIN_DIR/data/tiers.json"
FIXTURES="$KILN_PLUGIN_DIR/tests/fixtures"
RUN_TIMEOUT="${RUN_TIMEOUT:-3600}"

# Ceilings LOCKED (BEHAVIOR §run) — the one-time slice-8 recalibration is CONSUMED
# (2026-07-17; run4 baseline, rule = max window ×1.25 / run ×1.5, rounded up to 500;
# Sol CONFIRMED: ceiling-derivation.sol.md). These two lines never change again.
DRIVER_TRANSITION_CEILING=3000
DRIVER_RUN_CEILING=8000

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
  # T-02: N7 speaks the METERED driver total. `metered` is recovered from the
  # kiln-meter tool_use↔tool_result the completion beat immediately follows
  # (R-6'); the spoken integer is anchored AT/AFTER the driver keyword, never the
  # line's first integer (run4: "Stage 4 of 4 … Driver spend" ⇒ the driver
  # number, not 4). N7 = the run's final /driver/i beat.
  local n7line spoken metered total_all total_but_last
  n7line=$(grep -inE 'driver' "$b" | tail -1)
  n7=$(echo "$n7line" | cut -d: -f1)
  spoken=$(echo "$n7line" | cut -d: -f2- | grep -ioE 'driver.*' | grep -oE '[0-9][0-9,]*' | head -1 | tr -d ',')
  rm -f "$b"
  for v in n1 n2 n3 n4 n5 n6 n7; do [ -n "${!v}" ] || fail "anchor $v absent"; done
  metered=$(meter_reading "$t") || exit 1
  total_all=$(driver_total "$t")
  total_but_last=$(driver_total "$t" --drop-last)
  [ "$spoken" = "$metered" ] || fail "N7 speaks $spoken driver tokens; the meter recovered $metered — the completion line must state the metered number"
  [ "$total_but_last" -le "$metered" ] && [ "$metered" -le "$total_all" ] \
    || fail "metered $metered outside the independent truth bound [$total_but_last, $total_all]"
  [ "$n1" -le "$n2" ] && [ "$n2" -le "$n3" ] && [ "$n3" -le "$n4" ] && \
  [ "$n4" -le "$n5" ] && [ "$n5" -le "$n7" ] || fail "stage anchors out of order ($n1,$n2,$n3,$n4,$n5,$n7)"
  [ "$n6" -ge "$n3" ] && [ "$n6" -le "$n7" ] || fail "seal anchor out of position ($n6)"
}

driver_total() { # $1=transcript [--drop-last] — Σ driver tokens over result windows;
  # --drop-last excludes the final window (the lower Σ of R-6's independent bound)
  local drop=0; [ "${2:-}" = --drop-last ] && drop=1
  jq -r 'select(.type=="result") | ((.usage.input_tokens // 0) + (.usage.output_tokens // 0))' "$1" \
    | awk -v d="$drop" '{ a[NR]=$1 } END { n=NR-d; for (i=1;i<=n;i++) t+=a[i]; print t+0 }'
}

meter_reading() { # $1=transcript — `metered` per R-6': the FINAL successful kiln-meter
  # tool_use, matched to its tool_result by id, immediately preceding the completion beat
  local t="$1" mid rline nx last reading
  mid=$(jq -r 'select(.type=="assistant") | .message.content[]?
    | select(.type=="tool_use" and .name=="Bash"
        and ((.input.command? // "") | test("\\bnode\\b[^\\n]*scripts/kiln-meter\\.mjs")))
    | .id' "$t" | tail -1)
  [ -n "$mid" ] || { echo "FAIL: T-02 no canonical kiln-meter invocation in capture — the completion line must state a metered number" >&2; return 1; }
  rline=$(jq -r --arg id "$mid" 'select(.type=="user")
    | select(any(.message.content[]?; .type=="tool_result" and .tool_use_id==$id and (.is_error!=true)))
    | input_line_number' "$t" | head -1)
  [ -n "$rline" ] || { echo "FAIL: T-02 kiln-meter tool_use $mid has no successful tool_result" >&2; return 1; }
  nx=$(jq -r --argjson r "$rline" 'select(.type=="assistant")
    | select(any(.message.content[]?; .type=="text" and (.text|test("driver";"i"))))
    | input_line_number | select(. > $r)' "$t" | head -1)
  last=$(jq -r 'select(.type=="assistant")
    | select(any(.message.content[]?; .type=="text" and (.text|test("driver";"i"))))
    | input_line_number' "$t" | tail -1)
  [ -n "$nx" ] || { echo "FAIL: T-02 no completion beat follows the kiln-meter result" >&2; return 1; }
  [ "$nx" = "$last" ] || { echo "FAIL: T-02 kiln-meter result does not immediately precede the completion beat (/driver/i beat intervenes at line $nx)" >&2; return 1; }
  reading=$(jq -r --arg id "$mid" 'select(.type=="user") | .message.content[]?
    | select(.type=="tool_result" and .tool_use_id==$id and (.is_error!=true)) | (.content // "" | tostring)' "$t")
  printf '%s' "$reading" | grep -qzE '^[[:space:]]*[0-9]+[[:space:]]*$' \
    || { echo "FAIL: T-02 kiln-meter tool_result is not a lone integer (stdout must carry exactly one integer per R-5')" >&2; return 1; }
  reading=$(printf '%s' "$reading" | tr -cd '0-9')
  echo "$reading"
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

gate_request() { # $1=workdir — writes request.json + the kernel-side check receipt;
  # reviewer model+effort come from tiers.json. The runner is the kernel side here:
  # it executes the request's check command and captures the output verbatim, so the
  # reviewer (who executes nothing) judges attached evidence.
  local wd="$1" h alias model effort
  h=$(sha256sum "$wd/LAW.md" | cut -d' ' -f1)
  mkdir -p "$wd/.kiln"
  ( cd "$wd" && node --test slice/ > .kiln/check-receipt.txt 2>&1 ) || true
  alias=$(jq -r '.roles["reviewer-gate"].alias' "$TIERS")
  model=$(jq -r --arg a "$alias" '.resolver[$a]' "$TIERS")
  effort=$(jq -r '.roles["reviewer-gate"].effort' "$TIERS")
  jq -n --arg h "$h" --arg model "$model" --arg effort "$effort" '{
    reviewer_model: $model,
    reviewer_effort: $effort,
    law_hash: $h,
    criteria: "median(xs): odd length → the middle value; even length → the mean of the two middle values.",
    paths: ["slice/median.mjs", "slice/median.test.mjs", "LAW.md"],
    failures: [],
    commands: ["node --test slice/"]
  }' > "$wd/request.json"
}
