#!/bin/bash
# The dev gate: rebuild the full verify tree from the public plugin at plugins/kiln plus the
# dev-side test assets (tests/scenarios/mock-replay, renamed identically), then run the
# inherited floor: full suite + all scenarios. Reproducible any time; the tree lives in scratch.
set -euo pipefail
cd "$(dirname "$0")/.."
V="${1:-/tmp/kiln-verify}"

rm -rf "$V"; mkdir -p "$V"
cp -r plugins/kiln/. "$V/"
cp -r machine/test "$V/machine/test"
cp -r machine/scenarios "$V/machine/scenarios"
cp machine/src/mock-replay.js "$V/machine/src/mock-replay.js"

grep -rl -i "thelastskill" "$V/machine/test" "$V/machine/scenarios" "$V/machine/src/mock-replay.js" 2>/dev/null | while read -r f; do
  sed -i -e 's/thelastskill/kiln/g' -e 's/Thelastskill/Kiln/g' -e 's/THELASTSKILL/KILN/g' "$f"
done

# Scenario fixtures cite the dev repo by absolute path; retarget them at this verify tree.
sed -i "s|/DEV/kiln/machine|$V/machine|g" "$V"/machine/scenarios/*.json

cd "$V"
# The suite's preflight tests run a real `git rev-parse --is-inside-work-tree` under the
# tree they scaffold; in the dev repo that passes because the repo IS a work tree. Mirror it.
git init -q
echo "=== SUITE ==="
node --test machine/test/*.test.js 2>&1 | grep -E '^# (tests|pass|fail)'
echo "=== SCENARIOS ==="
for s in machine/scenarios/*.json; do node machine/src/mock-replay.js "$s" | tail -1; done
