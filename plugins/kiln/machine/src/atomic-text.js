'use strict';

// Plain-text sibling of atomic-json.js's writeAtomic — same tmp-then-rename
// mechanism (unique unpredictable temp name, exclusive create, fsync,
// rename), for the markdown/prose artifacts this tree also has to write
// atomically (`architecture/judge-verdict.md` chief among them — see
// judge-verdict.js). atomic-json.js stays JSON-only rather than growing a
// second responsibility; this module is the one place plain-text atomic
// writes live.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function writeAtomicText(file, text) {
  if (typeof file !== 'string' || file === '') {
    throw new TypeError('atomic-text: file must be a non-empty string');
  }
  if (typeof text !== 'string') {
    throw new TypeError(`atomic-text: value for ${file} is not a string`);
  }

  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });

  const tmpFile = path.join(
    dir,
    `.${path.basename(file)}.tmp-${process.pid}-${crypto.randomBytes(8).toString('hex')}`
  );
  const fd = fs.openSync(tmpFile, 'wx');
  try {
    fs.writeSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  fs.renameSync(tmpFile, file);
}

module.exports = { writeAtomicText };
