// index.js — the directory entry that keeps `node --test tests/v3/` green (BLUEPRINT §13).
// Modern node (observed on the 22.x line) treats positional --test arguments as literal entry
// paths, not scan roots: the directory itself is loaded as a module, so without an entry the
// canonical command dies with "Cannot find module .../tests/v3". This entry statically imports
// every test file, registering the whole suite in one child process. Older lines (18/20) scan
// the directory and match *.test.mjs themselves — index.js matches none of the runner's
// test-file patterns, so nothing ever runs twice. The sibling package.json ({"type":"module"})
// is what lets a .js entry use static imports; directory resolution only ever finds index.js,
// never index.mjs. Zero dependencies, like everything else in the harness.
import './src-modules.test.mjs'
import './gauge.test.mjs'
import './spine.test.mjs'
import './gauge-workflow.test.mjs'
import './posture-args.test.mjs'
import './build-spine.test.mjs'
import './bundler.test.mjs'
import './kiln-state.test.mjs'
import './law.test.mjs'
import './probe.test.mjs'
import './defect-fixes.test.mjs'
import './dry-run.test.mjs'
import './validate-traversal-deadline.test.mjs'
import './validate-lease-integration.test.mjs'
import './ledger-vocabulary.test.mjs'
