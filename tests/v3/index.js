// index.js — the directory entry that keeps `node --test tests/v3/` green.
// Modern node (observed on the 22.x line) treats positional --test arguments as literal entry
// paths, not scan roots: the directory itself is loaded as a module, so without an entry the
// canonical command dies with "Cannot find module .../tests/v3". This entry statically imports
// every test file, registering the whole suite in one child process. Older lines (18/20) scan
// the directory and match *.test.mjs themselves — index.js matches none of the runner's
// test-file patterns, so nothing ever runs twice. The sibling package.json ({"type":"module"})
// is what lets a .js entry use static imports; directory resolution only ever finds index.js,
// never index.mjs. Zero dependencies, like everything else in the harness.
// The retired v3 suites live under retired/v3/tests/ — only the surviving rework guards load here.
import './dry-run.test.mjs'
import './packaging.test.mjs'
import './registry.test.mjs'
import './resolve-plugin-root.test.mjs'
