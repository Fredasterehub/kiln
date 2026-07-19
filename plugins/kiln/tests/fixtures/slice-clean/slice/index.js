'use strict'
// The annex-locked LAW command is `node --test slice/`. On Node lines that
// resolve a directory argument as a module entry (v22.21 does), this index is
// that entry — the ruled tests/index.js aggregator precedent, applied to the
// fixture so the locked literal runs verbatim. Locked fixture files untouched.
const { readdirSync } = require('node:fs')
const { join } = require('node:path')
for (const f of readdirSync(__dirname).sort()) {
  if (f.endsWith('.test.mjs')) import(join(__dirname, f))
}
