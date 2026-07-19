#!/bin/bash
# BEHAVIOR-SCENARIOS §S2 — seeded defect (slice-defect), gate level through
# the real transport (real codex reviewer; never mocked). Exit 0 = pass.
# Reference execution: .kiln-dev/rework/walk-receipts/gate-cycle/.
. "$(dirname "$0")/lib.sh"

WD=$(mktemp -d)
cp -r "$FIXTURES/slice-defect/." "$WD"
echo "S2 workdir: $WD"
cd "$WD" || exit 1

node --test slice/ || fail "fixture floor not green by construction"
gate_request "$WD"

"$KILN_REVIEW" review "$WD" request.json gate-review.json
rc=$?
[ "$rc" -eq 10 ] || fail "expected reject (10), got $rc"
jq -e '.findings[] | select(.location == "slice/median.mjs:4")' gate-review.json >/dev/null \
  || fail "no finding names the defect evidence location slice/median.mjs:4"

# The locked repair (annex): even branch averages the two middle values.
cp slice/median.mjs slice/median.mjs.orig
sed -i 's|(s\[m\] + s\[m + 1\]) / 2|(s[m - 1] + s[m]) / 2|' slice/median.mjs
node -e "import('./slice/median.mjs').then(m => process.exit(m.median([1,2,3,4]) === 2.5 ? 0 : 1))" \
  || fail "behavioral repaired-state check red"
diff -u slice/median.mjs.orig slice/median.mjs > repair-delta.md

# Repair pass 1 of the annex's two: scoped recheck by the same reviewer contract.
"$KILN_REVIEW" recheck "$WD" request.json gate-review.json repair-delta.md gate-review-2.json
rc=$?
[ "$rc" -eq 0 ] || fail "recheck did not accept (exit $rc) — within-two-passes assertion fails at pass 1"
[ "$(jq -r .verdict gate-review-2.json)" = accept ] || fail "recheck verdict not accept"

echo "S2 PASS (sealed within 1 of 2 repair passes)"
