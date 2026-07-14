#!/usr/bin/env bash
# sol-review.sh — the Kiln Dev Protocol codex bridge (Piece 3). A THIN POLICY WRAPPER over the
# shared receipt-bearing transport: `kiln-codex-receipt.mjs bridge` owns EVERY trust decision
# (spawn, capture, the A5 outcome state machine, receipt attestation, the allowlist, the fallback
# rung). This wrapper owns only ergonomics: defaults, flag translation, paths, the auth preflight,
# and a coreutils `timeout(1)` hard backstop. No verdict authority lives in bash.
#
# Usage: sol-review.sh <promptfile> <outprefix>
#          [--schema <schema.json>] [--effort low|medium|high|xhigh] [--model <id>]
#          [--sandbox read-only|workspace-write|danger-full-access] [--network] [--web]
#          [--ephemeral] [--resume <thread_id>] [--wallclock <seconds>] [--ledger <file>]
#          [--no-fallback]
#          [--run-token <t>] [--keystone <k>] [--phase <p>] [--seat <s>] [--attempt <n>]
#
# Artifacts (written by the transport): <outprefix>.verdict (the -o final message — parse ONLY on
# STATUS:VERDICT), <outprefix>.events.jsonl (the --json stream), <outprefix>.stderr.log (progress;
# never parsed for a verdict), <outprefix>.receipt.json (bridge receipt, only on VERDICT),
# <outprefix>.ledger.jsonl (append-only outcome ledger; override with --ledger).
#
# Exit: 0 VERDICT · 10 SUPPRESSED · 11 FAILED_TURN · 12 TRANSPORT · 124 WALLCLOCK_TIMEOUT ·
#       3 AUTH_MISSING (auth-expired is not a model failure — hygiene).
set -u

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
CLI="$SCRIPT_DIR/../../plugins/kiln/scripts/kiln-codex-receipt.mjs"
DEFAULT_SCHEMA="$SCRIPT_DIR/review-verdict-schema.json"

PROMPT=${1:?usage: sol-review.sh <promptfile> <outprefix> [flags]}
OUT=${2:?outprefix required}
shift 2

SCHEMA="$DEFAULT_SCHEMA"; EFFORT=high; MODEL=gpt-5.6-sol; SANDBOX=read-only; WALL=1800
NETWORK=0; WEB=0; EPHEMERAL=0; RESUME=""; LEDGER=""; FALLBACK=1
RUN_TOKEN=""; KEYSTONE=dev-review; PHASE=""; SEAT=sol; ATTEMPT=1
while [ $# -gt 0 ]; do case $1 in
  --schema)     SCHEMA=$2; shift 2 ;;
  --effort)     EFFORT=$2; shift 2 ;;
  --model)      MODEL=$2; shift 2 ;;
  --sandbox)    SANDBOX=$2; shift 2 ;;
  --network)    NETWORK=1; shift ;;
  --web)        WEB=1; shift ;;
  --ephemeral)  EPHEMERAL=1; shift ;;
  --resume)     RESUME=$2; shift 2 ;;
  --wallclock)  WALL=$2; shift 2 ;;
  --ledger)     LEDGER=$2; shift 2 ;;
  --no-fallback) FALLBACK=0; shift ;;
  --run-token)  RUN_TOKEN=$2; shift 2 ;;
  --keystone)   KEYSTONE=$2; shift 2 ;;
  --phase)      PHASE=$2; shift 2 ;;
  --seat)       SEAT=$2; shift 2 ;;
  --attempt)    ATTEMPT=$2; shift 2 ;;
  *) echo "sol-review.sh: unknown arg: $1" >&2; exit 2 ;;
esac; done

# Ergonomic defaults for the binding fields the transport requires (the dev-review workflow passes
# them explicitly; these keep manual invocation usable and each outprefix distinct).
BASE=$(basename "$OUT")
[ -n "$RUN_TOKEN" ] || RUN_TOKEN="$BASE"
[ -n "$PHASE" ] || PHASE="$BASE"

codex login status >/dev/null 2>&1 || { echo "STATUS:AUTH_MISSING MODEL:$MODEL VERDICT_FILE:$OUT.verdict"; exit 3; }

ARGS=(bridge --prompt "$PROMPT" --out "$OUT" --schema "$SCHEMA"
  --model "$MODEL" --effort "$EFFORT" --sandbox "$SANDBOX" --wallclock "$WALL"
  --run-token "$RUN_TOKEN" --keystone "$KEYSTONE" --phase "$PHASE" --seat "$SEAT" --attempt "$ATTEMPT")
[ "$NETWORK" = 1 ] && ARGS+=(--network)
[ "$WEB" = 1 ] && ARGS+=(--web)
[ "$EPHEMERAL" = 1 ] && ARGS+=(--ephemeral)
[ "$FALLBACK" = 0 ] && ARGS+=(--no-fallback)
[ -n "$RESUME" ] && ARGS+=(--resume "$RESUME")
[ -n "$LEDGER" ] && ARGS+=(--ledger "$LEDGER")

# node owns the inner wall-clock (fail-closed classification); this coreutils bound is the hard
# backstop if node itself wedges. Both surface as exit 124 = WALLCLOCK_TIMEOUT.
OUTER=$((WALL + 30))
timeout "$OUTER" node "$CLI" "${ARGS[@]}"
exit $?
