'use strict'
// The locked machine-floor command is `node --test tests/` from the plugin
// root. On Node lines that resolve a directory argument as a module entry
// (v22.21 does), this index is that entry: it aggregates every sibling
// *.test.mjs so the locked literal runs the whole floor either way.
const { readdirSync } = require('node:fs')
const { join } = require('node:path')
for (const f of readdirSync(__dirname).sort()) {
  if (f.endsWith('.test.mjs')) import(join(__dirname, f))
}
