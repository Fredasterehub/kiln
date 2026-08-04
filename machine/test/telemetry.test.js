'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const telemetry = require('../src/telemetry.js');
const { enabled, recordEvent, purge, status, EVENT_KINDS } = telemetry;

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'telemetry-test-'));
}

function usageDirIn(dir) {
  return path.join(dir, '.thelastskill', 'usage');
}

function git(args, cwd) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${res.stderr}`);
  }
  return res;
}

function withEnv(vars, fn) {
  const saved = {};
  for (const key of Object.keys(vars)) {
    saved[key] = Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined;
    if (vars[key] === undefined) delete process.env[key];
    else process.env[key] = vars[key];
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(vars)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

const CONSENTED = { telemetry_consent: true };
const NOT_CONSENTED = { telemetry_consent: false };

// A safe, minimal env base every test runs under unless it's specifically
// testing DO_NOT_TRACK/CI: clears every recognized CI marker plus
// DO_NOT_TRACK so the ambient test-runner environment can never leak in.
const CLEAN_ENV = Object.fromEntries(
  ['DO_NOT_TRACK', 'CI', 'CONTINUOUS_INTEGRATION', 'CODEX_CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'CIRCLECI', 'TRAVIS',
    'JENKINS_URL', 'TEAMCITY_VERSION', 'APPVEYOR', 'BUILDKITE', 'DRONE', 'TF_BUILD', 'CODEBUILD_BUILD_ID',
    'NETLIFY', 'VERCEL', 'RENDER', 'CIRRUS_CI', 'SEMAPHORE', 'BUDDY', 'BITBUCKET_BUILD_NUMBER'].map((k) => [k, undefined])
);

const PHASE_TRANSITION = { kind: 'phase_transition', payload: { from: 'onboarding', to: 'brainstorm' } };

// --- enabled(): consent gate ---

test('enabled is false with reason "consent" when telemetry_consent is not true', () => {
  const dir = mkTmpDir();
  withEnv(CLEAN_ENV, () => {
    const result = enabled(usageDirIn(dir), NOT_CONSENTED);
    assert.equal(result.enabled, false);
    assert.equal(result.reason, 'consent');
  });
});

test('enabled is false with reason "consent" when telemetry_consent is a truthy non-true value', () => {
  const dir = mkTmpDir();
  withEnv(CLEAN_ENV, () => {
    const result = enabled(usageDirIn(dir), { telemetry_consent: 'yes' });
    assert.equal(result.enabled, false);
    assert.equal(result.reason, 'consent');
  });
});

test('enabled is false with reason "consent" when telemetry_consent key is entirely absent (unset, not just false)', () => {
  const dir = mkTmpDir();
  withEnv(CLEAN_ENV, () => {
    const result = enabled(usageDirIn(dir), {});
    assert.equal(result.enabled, false);
    assert.equal(result.reason, 'consent');
  });
});

test('enabled is false with reason "consent" when telemetry_consent is explicitly null', () => {
  const dir = mkTmpDir();
  withEnv(CLEAN_ENV, () => {
    const result = enabled(usageDirIn(dir), { telemetry_consent: null });
    assert.equal(result.enabled, false);
    assert.equal(result.reason, 'consent');
  });
});

// --- enabled(): DO_NOT_TRACK ---

test('enabled is false with reason "do_not_track" when DO_NOT_TRACK is set to any value', () => {
  const dir = mkTmpDir();
  withEnv({ ...CLEAN_ENV, DO_NOT_TRACK: '0' }, () => {
    const result = enabled(usageDirIn(dir), CONSENTED);
    assert.equal(result.enabled, false);
    assert.equal(result.reason, 'do_not_track');
  });
});

// --- enabled(): CI (broadened marker set) ---

test('enabled is false with reason "ci" when CI is set', () => {
  const dir = mkTmpDir();
  withEnv({ ...CLEAN_ENV, CI: 'true' }, () => {
    const result = enabled(usageDirIn(dir), CONSENTED);
    assert.equal(result.enabled, false);
    assert.equal(result.reason, 'ci');
  });
});

test('enabled is false with reason "ci" when only CODEX_CI is set (this runtime\'s own marker, CI unset) — P3 Sol review finding 4', () => {
  const dir = mkTmpDir();
  withEnv({ ...CLEAN_ENV, CODEX_CI: '1' }, () => {
    const result = enabled(usageDirIn(dir), CONSENTED);
    assert.equal(result.enabled, false);
    assert.equal(result.reason, 'ci');
  });
});

for (const marker of ['GITHUB_ACTIONS', 'GITLAB_CI', 'CIRCLECI', 'TRAVIS', 'JENKINS_URL', 'TEAMCITY_VERSION',
  'APPVEYOR', 'BUILDKITE', 'DRONE', 'TF_BUILD', 'CODEBUILD_BUILD_ID', 'NETLIFY', 'VERCEL', 'RENDER', 'CIRRUS_CI',
  'SEMAPHORE', 'BUDDY', 'BITBUCKET_BUILD_NUMBER', 'CONTINUOUS_INTEGRATION']) {
  test(`enabled is false with reason "ci" when only ${marker} is set`, () => {
    const dir = mkTmpDir();
    withEnv({ ...CLEAN_ENV, [marker]: '1' }, () => {
      const result = enabled(usageDirIn(dir), CONSENTED);
      assert.equal(result.enabled, false);
      assert.equal(result.reason, 'ci');
    });
  });
}

// --- enabled(): git-tracked refusal ---

test('enabled is false with reason "git_tracked" when the usage dir is not covered by .gitignore inside a git repo', () => {
  const dir = mkTmpDir();
  git(['init', '-q'], dir);
  const usageDir = usageDirIn(dir);
  fs.mkdirSync(usageDir, { recursive: true });
  withEnv(CLEAN_ENV, () => {
    const result = enabled(usageDir, CONSENTED);
    assert.equal(result.enabled, false);
    assert.equal(result.reason, 'git_tracked');
  });
});

test('enabled is false with reason "git_tracked" when the usage dir is already tracked by git', () => {
  const dir = mkTmpDir();
  git(['init', '-q'], dir);
  const usageDir = usageDirIn(dir);
  fs.mkdirSync(usageDir, { recursive: true });
  fs.writeFileSync(path.join(usageDir, 'events-2026-01.jsonl'), '{}\n');
  git(['add', '.'], dir);
  git(['-c', 'user.email=a@b.c', '-c', 'user.name=a', 'commit', '-q', '-m', 'init'], dir);
  withEnv(CLEAN_ENV, () => {
    const result = enabled(usageDir, CONSENTED);
    assert.equal(result.enabled, false);
    assert.equal(result.reason, 'git_tracked');
  });
});

test('enabled is true when consented, no env refusals, and the usage dir is gitignore-covered', () => {
  const dir = mkTmpDir();
  git(['init', '-q'], dir);
  fs.writeFileSync(path.join(dir, '.gitignore'), '.thelastskill/usage/\n');
  withEnv(CLEAN_ENV, () => {
    const result = enabled(usageDirIn(dir), CONSENTED);
    assert.equal(result.enabled, true);
    assert.equal(result.reason, null);
  });
});

test('enabled is true when consented and the project has no git repo at all', () => {
  const dir = mkTmpDir();
  withEnv(CLEAN_ENV, () => {
    const result = enabled(usageDirIn(dir), CONSENTED);
    assert.equal(result.enabled, true);
    assert.equal(result.reason, null);
  });
});

// --- recordEvent(): the closed kind registry ---

test('EVENT_KINDS is a non-empty, frozen registry where every kind names a non-empty consumer and a non-empty field set', () => {
  assert.ok(Object.isFrozen(EVENT_KINDS));
  const kinds = Object.keys(EVENT_KINDS);
  assert.ok(kinds.length > 0);
  for (const kind of kinds) {
    const schema = EVENT_KINDS[kind];
    assert.equal(typeof schema.consumer, 'string');
    assert.ok(schema.consumer.length > 0, `${kind}.consumer must be non-empty`);
    assert.ok(Object.keys(schema.fields).length > 0, `${kind}.fields must be non-empty`);
    for (const [field, validator] of Object.entries(schema.fields)) {
      assert.equal(typeof validator, 'function', `${kind}.fields.${field} must be a validator function`);
    }
  }
});

test('recordEvent throws when evt.kind is not one of the registered kinds', () => {
  const dir = mkTmpDir();
  assert.throws(
    () => recordEvent(usageDirIn(dir), NOT_CONSENTED, { kind: 'not_a_real_kind', payload: {} }),
    TypeError
  );
});

test('recordEvent throws when payload is missing a field the kind declares', () => {
  const dir = mkTmpDir();
  assert.throws(() => {
    recordEvent(usageDirIn(dir), NOT_CONSENTED, { kind: 'phase_transition', payload: { from: 'onboarding' } });
  }, TypeError);
});

test('recordEvent throws when payload carries a key outside the kind\'s declared field set', () => {
  const dir = mkTmpDir();
  assert.throws(() => {
    recordEvent(usageDirIn(dir), NOT_CONSENTED, {
      kind: 'phase_transition',
      payload: { from: 'onboarding', to: 'brainstorm', extra: 'nope' },
    });
  }, TypeError);
});

test('recordEvent throws when payload is not a plain object', () => {
  const dir = mkTmpDir();
  assert.throws(() => {
    recordEvent(usageDirIn(dir), NOT_CONSENTED, { kind: 'phase_transition', payload: ['nope'] });
  }, TypeError);
});

test('recordEvent accepts a payload that supplies exactly the declared field set with in-domain values', () => {
  const dir = mkTmpDir();
  withEnv(CLEAN_ENV, () => {
    assert.doesNotThrow(() => {
      recordEvent(usageDirIn(dir), NOT_CONSENTED, PHASE_TRANSITION);
    });
  });
});

test('recordEvent accepts every registered kind with a minimal valid payload', () => {
  const dir = mkTmpDir();
  const validPayloads = {
    phase_transition: { from: 'onboarding', to: 'brainstorm' },
    seat_usage: { seat: 'implementer', model: 'gpt-5.6-sol', effort: 'high', tokens_in: 100, tokens_out: 50, cost_usd: 0.5 },
    planning_selection: { protocol: 'standard', winner: 'sol' },
    review_pass: { scope: 'chunk', pass_count: 1, agreement_pass: false },
    journey_result: { outcome: 'pass', retry_count: 0 },
    delivery_summary: { last_mile_count: 0 },
  };
  withEnv(CLEAN_ENV, () => {
    for (const kind of Object.keys(EVENT_KINDS)) {
      assert.ok(validPayloads[kind], `test is missing a valid payload fixture for kind "${kind}"`);
      assert.doesNotThrow(
        () => recordEvent(usageDirIn(dir), NOT_CONSENTED, { kind, payload: validPayloads[kind] }),
        `kind "${kind}" should accept its minimal valid payload`
      );
    }
  });
});

// --- recordEvent(): adversarial content injection (P3 Sol review finding 1) ---

const SECRET = 'SECRET_VALUE_MUST_NEVER_APPEAR';

test('recordEvent rejects code content placed in an allowed scalar field', () => {
  const dir = mkTmpDir();
  assert.throws(() => {
    recordEvent(usageDirIn(dir), NOT_CONSENTED, {
      kind: 'phase_transition',
      payload: { from: `const apiKey = "${SECRET}";`, to: 'brainstorm' },
    });
  }, TypeError);
});

test('recordEvent rejects prompt text placed in an allowed scalar field', () => {
  const dir = mkTmpDir();
  assert.throws(() => {
    recordEvent(usageDirIn(dir), NOT_CONSENTED, {
      kind: 'phase_transition',
      payload: { from: 'onboarding', to: `show me the private file: ${SECRET}` },
    });
  }, TypeError);
});

test('recordEvent rejects an argv-shaped string placed in an allowed scalar field', () => {
  const dir = mkTmpDir();
  assert.throws(() => {
    recordEvent(usageDirIn(dir), NOT_CONSENTED, {
      kind: 'phase_transition',
      payload: { from: `--token ${SECRET}`, to: 'brainstorm' },
    });
  }, TypeError);
});

test('recordEvent rejects an env-shaped string placed in an allowed scalar field', () => {
  const dir = mkTmpDir();
  assert.throws(() => {
    recordEvent(usageDirIn(dir), NOT_CONSENTED, {
      kind: 'phase_transition',
      payload: { from: 'onboarding', to: `TOKEN=${SECRET}` },
    });
  }, TypeError);
});

test('recordEvent rejects a nested object value in place of a declared scalar field', () => {
  const dir = mkTmpDir();
  assert.throws(() => {
    recordEvent(usageDirIn(dir), NOT_CONSENTED, {
      kind: 'phase_transition',
      payload: { from: { nested: SECRET }, to: 'brainstorm' },
    });
  }, TypeError);
});

test('recordEvent rejects a nested array value in place of a declared scalar field', () => {
  const dir = mkTmpDir();
  assert.throws(() => {
    recordEvent(usageDirIn(dir), NOT_CONSENTED, {
      kind: 'phase_transition',
      payload: { from: ['onboarding', SECRET], to: 'brainstorm' },
    });
  }, TypeError);
});

test('recordEvent rejects code/prompt content used as the kind itself', () => {
  const dir = mkTmpDir();
  assert.throws(() => {
    recordEvent(usageDirIn(dir), NOT_CONSENTED, { kind: `raw prompt: summarize ${SECRET}`, payload: {} });
  }, TypeError);
});

test('recordEvent rejects arbitrary content used as correlation_id', () => {
  const dir = mkTmpDir();
  assert.throws(() => {
    recordEvent(usageDirIn(dir), NOT_CONSENTED, { ...PHASE_TRANSITION, correlation_id: `argv=--token ${SECRET}` });
  }, TypeError);
});

test('recordEvent rejects a non-string correlation_id', () => {
  const dir = mkTmpDir();
  assert.throws(() => {
    recordEvent(usageDirIn(dir), NOT_CONSENTED, { ...PHASE_TRANSITION, correlation_id: { nested: SECRET } });
  }, TypeError);
});

test('recordEvent accepts a null correlation_id and a well-formed short identifier correlation_id', () => {
  const dir = mkTmpDir();
  withEnv(CLEAN_ENV, () => {
    assert.doesNotThrow(() => recordEvent(usageDirIn(dir), NOT_CONSENTED, { ...PHASE_TRANSITION, correlation_id: null }));
    assert.doesNotThrow(() =>
      recordEvent(usageDirIn(dir), NOT_CONSENTED, { ...PHASE_TRANSITION, correlation_id: 'chunk_C03' })
    );
  });
});

test('no thrown error message from any rejection path contains the injected secret content', () => {
  const dir = mkTmpDir();
  const attempts = [
    () => recordEvent(usageDirIn(dir), NOT_CONSENTED, { kind: `bad-${SECRET}`, payload: {} }),
    () =>
      recordEvent(usageDirIn(dir), NOT_CONSENTED, {
        kind: 'phase_transition',
        payload: { from: SECRET, to: 'brainstorm' },
      }),
    () =>
      recordEvent(usageDirIn(dir), NOT_CONSENTED, {
        kind: 'phase_transition',
        payload: { from: 'onboarding', to: 'brainstorm', [SECRET]: SECRET },
      }),
    () => recordEvent(usageDirIn(dir), NOT_CONSENTED, { ...PHASE_TRANSITION, correlation_id: SECRET + '!!!' }),
  ];
  for (const attempt of attempts) {
    assert.throws(attempt, (err) => {
      assert.equal(err.message.includes(SECRET), false, `error message leaked injected content: ${err.message}`);
      return true;
    });
  }
});

// --- recordEvent(): refusal when disabled, zero side effects for every reason ---

test('recordEvent is a no-op and reports {recorded:false, reason} when telemetry is disabled by consent', () => {
  const dir = mkTmpDir();
  const usageDir = usageDirIn(dir);
  withEnv(CLEAN_ENV, () => {
    const result = recordEvent(usageDir, NOT_CONSENTED, PHASE_TRANSITION);
    assert.equal(result.recorded, false);
    assert.equal(result.reason, 'consent');
    assert.equal(fs.existsSync(usageDir), false);
  });
});

test('recordEvent makes no filesystem change for every disabled reason (consent, do_not_track, ci, git_tracked)', () => {
  const cases = [
    { env: {}, settings: NOT_CONSENTED, reason: 'consent' },
    { env: { DO_NOT_TRACK: '1' }, settings: CONSENTED, reason: 'do_not_track' },
    { env: { CI: '1' }, settings: CONSENTED, reason: 'ci' },
    { env: { CODEX_CI: '1' }, settings: CONSENTED, reason: 'ci' },
  ];
  for (const { env, settings, reason } of cases) {
    const dir = mkTmpDir();
    const usageDir = usageDirIn(dir);
    withEnv({ ...CLEAN_ENV, ...env }, () => {
      const result = recordEvent(usageDir, settings, PHASE_TRANSITION);
      assert.equal(result.recorded, false, `case reason=${reason}`);
      assert.equal(result.reason, reason);
      assert.equal(fs.existsSync(usageDir), false, `filesystem changed for reason=${reason}`);
    });
  }

  // git_tracked case needs its own repo setup.
  const gitDir = mkTmpDir();
  git(['init', '-q'], gitDir);
  const gitUsageDir = usageDirIn(gitDir);
  withEnv(CLEAN_ENV, () => {
    const result = recordEvent(gitUsageDir, CONSENTED, PHASE_TRANSITION);
    assert.equal(result.recorded, false);
    assert.equal(result.reason, 'git_tracked');
    assert.equal(fs.existsSync(gitUsageDir), false);
  });
});

// --- recordEvent(): success path writes via stream.appendRecord ---

test('recordEvent writes a record and sets dir mode 0o700 / file mode 0o600 when enabled', () => {
  const dir = mkTmpDir();
  const usageDir = usageDirIn(dir);
  withEnv(CLEAN_ENV, () => {
    const result = recordEvent(usageDir, CONSENTED, PHASE_TRANSITION);
    assert.equal(result.recorded, true);
    assert.equal(typeof result.seq, 'number');
    assert.equal(typeof result.file, 'string');

    const dirMode = fs.statSync(usageDir).mode & 0o777;
    const fileMode = fs.statSync(result.file).mode & 0o777;
    assert.equal(dirMode, 0o700);
    assert.equal(fileMode, 0o600);

    const raw = fs.readFileSync(result.file, 'utf8').trim();
    const record = JSON.parse(raw);
    assert.equal(record.kind, 'phase_transition');
    assert.equal(record.schema_version, 1);
    assert.equal(record.from, 'onboarding');
    assert.equal(record.to, 'brainstorm');
    assert.equal(typeof record.ts, 'string');
    assert.match(path.basename(result.file), /^events-\d{4}-\d{2}\.jsonl$/);
  });
});

test('recordEvent appends multiple events to the same month file with increasing seq', () => {
  const dir = mkTmpDir();
  const usageDir = usageDirIn(dir);
  withEnv(CLEAN_ENV, () => {
    const r1 = recordEvent(usageDir, CONSENTED, { kind: 'journey_result', payload: { outcome: 'pass', retry_count: 0 } });
    const r2 = recordEvent(usageDir, CONSENTED, { kind: 'journey_result', payload: { outcome: 'pass', retry_count: 0 } });
    assert.equal(r1.file, r2.file);
    assert.equal(r2.seq, r1.seq + 1);
  });
});

// --- recordEvent(): permission window (P3 Sol review finding 3) ---

test('the usage stream file is already mode 0600 by the time content is appended (no permissive window) under umask 022', () => {
  const dir = mkTmpDir();
  const usageDir = usageDirIn(dir);
  const originalUmask = process.umask(0o022);
  const originalAppend = fs.appendFileSync;
  let modeAtAppendTime = null;
  fs.appendFileSync = function (file, data, ...rest) {
    modeAtAppendTime = fs.statSync(file).mode & 0o777;
    return originalAppend.call(fs, file, data, ...rest);
  };
  try {
    withEnv(CLEAN_ENV, () => {
      recordEvent(usageDir, CONSENTED, PHASE_TRANSITION);
    });
  } finally {
    fs.appendFileSync = originalAppend;
    process.umask(originalUmask);
  }
  assert.equal(modeAtAppendTime, 0o600);
});

test('a pre-existing month file at a permissive mode is repaired to 0600 before content is appended', () => {
  const dir = mkTmpDir();
  const usageDir = usageDirIn(dir);
  fs.mkdirSync(usageDir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().slice(0, 7);
  const file = path.join(usageDir, `events-${stamp}.jsonl`);
  fs.writeFileSync(file, '', { mode: 0o644 });
  assert.equal(fs.statSync(file).mode & 0o777, 0o644);

  const originalAppend = fs.appendFileSync;
  let modeAtAppendTime = null;
  fs.appendFileSync = function (f, data, ...rest) {
    modeAtAppendTime = fs.statSync(f).mode & 0o777;
    return originalAppend.call(fs, f, data, ...rest);
  };
  try {
    withEnv(CLEAN_ENV, () => {
      recordEvent(usageDir, CONSENTED, PHASE_TRANSITION);
    });
  } finally {
    fs.appendFileSync = originalAppend;
  }
  assert.equal(modeAtAppendTime, 0o600);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('recordEvent refuses to write through a symlinked month-file target', () => {
  const dir = mkTmpDir();
  const usageDir = usageDirIn(dir);
  fs.mkdirSync(usageDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 7);
  const target = path.join(dir, 'elsewhere.jsonl');
  fs.writeFileSync(target, '');
  fs.symlinkSync(target, path.join(usageDir, `events-${stamp}.jsonl`));

  withEnv(CLEAN_ENV, () => {
    assert.throws(() => recordEvent(usageDir, CONSENTED, PHASE_TRANSITION), /symlink/);
  });
});

test('recordEvent refuses to write through a symlinked usage directory (P11 Sol review finding 1)', () => {
  const dir = mkTmpDir();
  const usageDir = usageDirIn(dir);
  fs.mkdirSync(path.dirname(usageDir), { recursive: true });
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'telemetry-outside-'));
  fs.symlinkSync(outside, usageDir, 'dir');

  withEnv(CLEAN_ENV, () => {
    assert.throws(() => recordEvent(usageDir, CONSENTED, PHASE_TRANSITION), /symlink/);
  });
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('recordEvent refuses when the usage directory target is a regular file, not a directory', () => {
  const dir = mkTmpDir();
  const usageDir = usageDirIn(dir);
  fs.mkdirSync(path.dirname(usageDir), { recursive: true });
  fs.writeFileSync(usageDir, '');

  withEnv(CLEAN_ENV, () => {
    assert.throws(() => recordEvent(usageDir, CONSENTED, PHASE_TRANSITION), /not a real directory/);
  });
});

test('recordEvent refuses when the month-file target is a directory, not a regular file', () => {
  const dir = mkTmpDir();
  const usageDir = usageDirIn(dir);
  const stamp = new Date().toISOString().slice(0, 7);
  fs.mkdirSync(path.join(usageDir, `events-${stamp}.jsonl`), { recursive: true });

  withEnv(CLEAN_ENV, () => {
    assert.throws(() => recordEvent(usageDir, CONSENTED, PHASE_TRANSITION), /not a regular file/);
  });
});

// --- purge(): scope, symlink/basename refusal (P3 Sol review finding 5) ---

test('purge removes all usage stream files without deleting the usage directory itself', () => {
  const dir = mkTmpDir();
  const usageDir = usageDirIn(dir);
  withEnv(CLEAN_ENV, () => {
    recordEvent(usageDir, CONSENTED, PHASE_TRANSITION);
    assert.equal(fs.existsSync(usageDir), true);
    const result = purge(usageDir);
    assert.equal(result.removed.length, 1);
    assert.equal(fs.readdirSync(usageDir).filter((n) => /^events-\d{4}-\d{2}\.jsonl$/.test(n)).length, 0);
  });
});

test('purge removes multiple month files across different months', () => {
  const dir = mkTmpDir();
  const usageDir = usageDirIn(dir);
  fs.mkdirSync(usageDir, { recursive: true });
  fs.writeFileSync(path.join(usageDir, 'events-2026-01.jsonl'), '{}\n');
  fs.writeFileSync(path.join(usageDir, 'events-2026-02.jsonl'), '{}\n');
  fs.writeFileSync(path.join(usageDir, 'events-2026-03.jsonl'), '{}\n');

  const result = purge(usageDir);
  assert.deepEqual(result.removed.sort(), ['events-2026-01.jsonl', 'events-2026-02.jsonl', 'events-2026-03.jsonl']);
  assert.equal(fs.readdirSync(usageDir).length, 0);
});

test('purge leaves non-stream sidecar files (e.g. a lockfile remnant) and subdirectories untouched', () => {
  const dir = mkTmpDir();
  const usageDir = usageDirIn(dir);
  fs.mkdirSync(usageDir, { recursive: true });
  fs.writeFileSync(path.join(usageDir, 'events-2026-01.jsonl'), '{}\n');
  fs.writeFileSync(path.join(usageDir, 'events-2026-01.jsonl.lock'), '');
  fs.writeFileSync(path.join(usageDir, 'notes.txt'), 'unrelated');
  fs.mkdirSync(path.join(usageDir, 'nested'), { recursive: true });

  const result = purge(usageDir);
  assert.deepEqual(result.removed, ['events-2026-01.jsonl']);
  const remaining = fs.readdirSync(usageDir).sort();
  assert.deepEqual(remaining, ['events-2026-01.jsonl.lock', 'nested', 'notes.txt']);
});

test('purge on a directory that does not exist is a harmless no-op', () => {
  const dir = mkTmpDir();
  assert.doesNotThrow(() => purge(usageDirIn(dir)));
});

test('purge refuses a target directory whose basename is not "usage"', () => {
  const dir = mkTmpDir();
  const wrong = path.join(dir, '.thelastskill', 'not-usage');
  fs.mkdirSync(wrong, { recursive: true });
  assert.throws(() => purge(wrong), /not named "usage"/);
  assert.equal(fs.existsSync(wrong), true); // refused, not deleted
});

test('purge refuses a symlinked usage directory rather than following it', () => {
  const dir = mkTmpDir();
  const realDir = path.join(dir, 'real-usage-target');
  fs.mkdirSync(realDir, { recursive: true });
  fs.writeFileSync(path.join(realDir, 'events-2026-01.jsonl'), '{}\n');
  const usageDir = path.join(dir, '.thelastskill', 'usage');
  fs.mkdirSync(path.join(dir, '.thelastskill'), { recursive: true });
  fs.symlinkSync(realDir, usageDir);

  assert.throws(() => purge(usageDir), /symlink/);
  assert.equal(fs.existsSync(path.join(realDir, 'events-2026-01.jsonl')), true);
});

test('purge throws a TypeError for a missing or empty usageDir', () => {
  assert.throws(() => purge(''), TypeError);
  assert.throws(() => purge(undefined), TypeError);
});

// --- status(): enabled/reason/file list/sizes ---

test('status reports enabled:false, reason, and an empty file list when disabled and never written', () => {
  const dir = mkTmpDir();
  withEnv(CLEAN_ENV, () => {
    const result = status(usageDirIn(dir), NOT_CONSENTED);
    assert.equal(result.enabled, false);
    assert.equal(result.reason, 'consent');
    assert.deepEqual(result.files, []);
    assert.equal(result.totalBytes, 0);
  });
});

test('status lists written stream files with their sizes when enabled', () => {
  const dir = mkTmpDir();
  const usageDir = usageDirIn(dir);
  withEnv(CLEAN_ENV, () => {
    recordEvent(usageDir, CONSENTED, PHASE_TRANSITION);
    const result = status(usageDir, CONSENTED);
    assert.equal(result.enabled, true);
    assert.equal(result.reason, null);
    assert.equal(result.files.length, 1);
    assert.match(result.files[0].name, /^events-\d{4}-\d{2}\.jsonl$/);
    assert.ok(result.files[0].bytes > 0);
    assert.equal(result.totalBytes, result.files[0].bytes);
  });
});

test('status still reports the file list even when telemetry is now disabled (inspection works regardless of consent)', () => {
  const dir = mkTmpDir();
  const usageDir = usageDirIn(dir);
  withEnv(CLEAN_ENV, () => {
    recordEvent(usageDir, CONSENTED, PHASE_TRANSITION);
  });
  const result = status(usageDir, NOT_CONSENTED);
  assert.equal(result.enabled, false);
  assert.equal(result.files.length, 1);
});

// ---------- CLI (P11 finding F3: telemetry.js had no require.main guard at
// all — six documented call sites named function-level calls with no
// invocation form) ----------

const CLI_PATH = path.join(__dirname, '..', 'src', 'telemetry.js');

// A clean spawn env — every recognized CI/DO_NOT_TRACK marker stripped —
// mirroring CLEAN_ENV's own intent for the in-process enabled()/recordEvent()
// tests above, but built for passing to a real child process via spawnSync's
// own `env` option rather than mutating process.env.
function cleanSpawnEnv(overrides = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(CLEAN_ENV)) delete env[key];
  return { ...env, ...overrides };
}

test('CLI: enabled prints {enabled:false, reason:"consent"} when settings withhold consent', () => {
  const dir = mkTmpDir();
  const proc = spawnSync(process.execPath, [CLI_PATH, 'enabled', usageDirIn(dir), JSON.stringify(NOT_CONSENTED)], {
    encoding: 'utf8',
    env: cleanSpawnEnv(),
  });
  assert.equal(proc.status, 0, proc.stderr);
  assert.deepEqual(JSON.parse(proc.stdout), { enabled: false, reason: 'consent' });
});

test('CLI: enabled prints {enabled:true, reason:null} when consented with no env refusals and no git repo', () => {
  const dir = mkTmpDir();
  const proc = spawnSync(process.execPath, [CLI_PATH, 'enabled', usageDirIn(dir), JSON.stringify(CONSENTED)], {
    encoding: 'utf8',
    env: cleanSpawnEnv(),
  });
  assert.equal(proc.status, 0, proc.stderr);
  assert.deepEqual(JSON.parse(proc.stdout), { enabled: true, reason: null });
});

test('CLI: record writes the event via stdin and reports recorded:true when enabled', () => {
  const dir = mkTmpDir();
  const usageDir = usageDirIn(dir);
  const proc = spawnSync(process.execPath, [CLI_PATH, 'record', usageDir, JSON.stringify(CONSENTED)], {
    encoding: 'utf8',
    env: cleanSpawnEnv(),
    input: JSON.stringify(PHASE_TRANSITION),
  });
  assert.equal(proc.status, 0, proc.stderr);
  const printed = JSON.parse(proc.stdout);
  assert.equal(printed.recorded, true);
  assert.equal(typeof printed.seq, 'number');

  const status_ = status(usageDir, CONSENTED);
  assert.equal(status_.files.length, 1);
});

test('CLI: record reports recorded:false with a reason and writes nothing when consent is withheld', () => {
  const dir = mkTmpDir();
  const usageDir = usageDirIn(dir);
  const proc = spawnSync(process.execPath, [CLI_PATH, 'record', usageDir, JSON.stringify(NOT_CONSENTED)], {
    encoding: 'utf8',
    env: cleanSpawnEnv(),
    input: JSON.stringify(PHASE_TRANSITION),
  });
  assert.equal(proc.status, 0, proc.stderr);
  assert.deepEqual(JSON.parse(proc.stdout), { recorded: false, reason: 'consent' });
  assert.equal(fs.existsSync(usageDir), false);
});

test('CLI: record exits 1 for an unregistered event kind', () => {
  const dir = mkTmpDir();
  const proc = spawnSync(process.execPath, [CLI_PATH, 'record', usageDirIn(dir), JSON.stringify(CONSENTED)], {
    encoding: 'utf8',
    env: cleanSpawnEnv(),
    input: JSON.stringify({ kind: 'not_a_real_kind', payload: {} }),
  });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /telemetry\.js/);
});

test('CLI: missing usageDir exits 1 with a usage message', () => {
  const proc = spawnSync(process.execPath, [CLI_PATH, 'enabled'], { encoding: 'utf8' });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /usage/);
});

test('CLI: unknown command exits 1 with a usage message', () => {
  const dir = mkTmpDir();
  const proc = spawnSync(process.execPath, [CLI_PATH, 'purge', usageDirIn(dir)], { encoding: 'utf8' });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /usage/);
});
