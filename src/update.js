'use strict';

const path = require('node:path');
const { readManifest } = require('./manifest.js');
const { install }      = require('./install.js');
const { uninstall }    = require('./uninstall.js');
const currentVersion   = require('../package.json').version;

async function update({ home, force } = {}) {
  const manifest = await readManifest(home);

  if (!manifest) {
    return { error: 'not-installed', hint: 'Run kilntwo install first' };
  }

  const oldVersion = manifest.kilnVersion;

  if (oldVersion === currentVersion && !force) {
    return { status: 'up-to-date', version: currentVersion };
  }

  const { removed }   = await uninstall({ home });
  const { installed } = await install({ home, force: true });

  return {
    status:    'updated',
    from:      oldVersion,
    to:        currentVersion,
    installed,
    removed,
  };
}

module.exports = { update };
