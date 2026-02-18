const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { resolvePaths } = require('./paths.js');

/**
 * Reads and parses the manifest.json file.
 * @param {{ manifestPath: string }|string|undefined} options
 *   When an object with a `manifestPath` string is passed (e.g. from uninstall.js),
 *   that path is used directly. Otherwise the argument is treated as a homeOverride
 *   string and paths are resolved via resolvePaths().
 * @returns {object|null} Parsed manifest object, or null if the file does not exist.
 * @throws {SyntaxError} If the file exists but contains invalid JSON.
 */
function readManifest(options) {
  let manifestPath;
  if (options && typeof options === 'object' && typeof options.manifestPath === 'string') {
    manifestPath = options.manifestPath;
  } else {
    const paths = resolvePaths(typeof options === 'string' ? options : undefined);
    manifestPath = paths.manifestPath;
  }

  try {
    const raw = fs.readFileSync(manifestPath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Serializes and writes data to manifest.json, creating parent directories if needed.
 * @param {object} data - The manifest object to serialize.
 * @param {string|undefined} homeOverride
 * @returns {void}
 */
function writeManifest(data, homeOverride) {
  const { kilntwoDir, manifestPath } = resolvePaths(homeOverride);
  fs.mkdirSync(kilntwoDir, { recursive: true });
  const serialized = JSON.stringify(data, null, 2);
  fs.writeFileSync(manifestPath, serialized, 'utf8');
}

/**
 * Computes the SHA-256 checksum of a file.
 * @param {string} filePath - Absolute path to the file.
 * @returns {string} Checksum in the format "sha256:<hex>".
 * @throws If the file cannot be read.
 */
function computeChecksum(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const hex = crypto.createHash('sha256').update(fileBuffer).digest('hex');
  return 'sha256:' + hex;
}

/**
 * Validates a manifest object against the required schema.
 * @param {object} data - The object to validate (may be null/undefined).
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateManifest(data) {
  const errors = [];

  if (typeof data !== 'object' || data === null) {
    errors.push('manifest must be a non-null object');
    return { valid: false, errors };
  }

  if (data.manifestVersion !== 1) {
    errors.push('manifestVersion must be the number 1');
  }

  if (typeof data.kilnVersion !== 'string' || data.kilnVersion.length === 0) {
    errors.push('kilnVersion must be a non-empty string');
  }

  if (typeof data.installedAt !== 'string' || Number.isNaN(new Date(data.installedAt).getTime())) {
    errors.push('installedAt must be a valid ISO-8601 date string');
  }

  if (!Array.isArray(data.files)) {
    errors.push('files must be an array');
  } else {
    for (let i = 0; i < data.files.length; i += 1) {
      const entry = data.files[i];
      const validEntry =
        entry !== null &&
        typeof entry === 'object' &&
        typeof entry.path === 'string' &&
        typeof entry.checksum === 'string';

      if (!validEntry) {
        errors.push(`files[${i}] must have string path and checksum`);
      }
    }
  }

  const protocolMarkersValid =
    data.protocolMarkers !== null && typeof data.protocolMarkers === 'object';

  if (!protocolMarkersValid) {
    errors.push('protocolMarkers must be a non-null object');
  } else {
    if (
      typeof data.protocolMarkers.begin !== 'string' ||
      data.protocolMarkers.begin.length === 0
    ) {
      errors.push('protocolMarkers.begin must be a non-empty string');
    }

    if (
      typeof data.protocolMarkers.end !== 'string' ||
      data.protocolMarkers.end.length === 0
    ) {
      errors.push('protocolMarkers.end must be a non-empty string');
    }
  }

  return { valid: errors.length === 0, errors };
}

module.exports = {
  readManifest,
  writeManifest,
  computeChecksum,
  validateManifest,
};
