#!/bin/bash
# BEHAVIOR-SCENARIOS §S3 — clean pair (slice-clean), gate level through the
# real transport. First-pass accept, findings AND blockers exactly empty,
# exactly one review call. Exit 0 = pass.
. "$(dirname "$0")/lib.sh"

WD=$(mktemp -d)
cp -r "$FIXTURES/slice-clean/." "$WD"
echo "S3 workdir: $WD"
cd "$WD" || exit 1

node --test slice/ || fail "fixture floor not green"
gate_request "$WD"

# Exactly one review call — this runner makes one and only one.
"$KILN_REVIEW" review "$WD" request.json gate-review.json
rc=$?
[ "$rc" -eq 0 ] || fail "expected first-pass accept (0), got $rc"
jq -e '.verdict == "accept" and .findings == [] and .blockers == []' gate-review.json >/dev/null \
  || fail "accept must carry exactly empty findings AND blockers"

echo "S3 PASS (first-pass accept, restraint held)"
