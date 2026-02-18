'use strict';

const { install } = require('./install');
const { uninstall } = require('./uninstall');
const { update } = require('./update');
const { doctor } = require('./doctor');
const { resolvePaths, encodeProjectPath, projectMemoryDir, projectClaudeMd } = require('./paths');
const {
  readManifest,
  writeManifest,
  computeChecksum,
  validateManifest,
} = require('./manifest');
const {
  insertProtocol,
  replaceProtocol,
  removeProtocol,
  hasProtocol,
  extractVersion,
} = require('./markers');

module.exports = {
  // High-level commands
  install,
  uninstall,
  update,
  doctor,

  // Path utilities
  resolvePaths,
  encodeProjectPath,
  projectMemoryDir,
  projectClaudeMd,

  // Manifest utilities
  readManifest,
  writeManifest,
  computeChecksum,
  validateManifest,

  // Protocol marker utilities
  insertProtocol,
  replaceProtocol,
  removeProtocol,
  hasProtocol,
  extractVersion,
};
