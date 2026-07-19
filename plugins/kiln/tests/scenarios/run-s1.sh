#!/bin/bash
# BEHAVIOR-SCENARIOS §S1 — greenfield end-to-end (hello-forge). Exit 0 = pass.
# Adaptation on record: the annex-locked invocation string rides behind the
# platform's namespaced command /kiln:kiln-fire (see lib.sh receipts).
. "$(dirname "$0")/lib.sh"

WD=$(mktemp -d)
echo "S1 workdir: $WD"

# One fresh driver session, locked invocation, stdin closed (lib closes it),
# gates default (user plan gate OFF). Unattended: a run that stops to ask
# never emits the completion anchor, so the anchor assertions fail it.
launch_run "$WD" "$S1_INVOCATION" "$WD/transcript.jsonl"

assert_s1_artifacts "$WD"
assert_anchor_order "$WD/transcript.jsonl" "$WD"
driver_meter "$WD/transcript.jsonl"

echo "S1 PASS"
