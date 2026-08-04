'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { replay } = require('../src/mock-replay.js');

const CLI_PATH = path.join(__dirname, '..', 'src', 'mock-replay.js');

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mock-replay-test-'));
}

function writeScenario(dir, scenario) {
  const file = path.join(dir, 'scenario.json');
  fs.writeFileSync(file, JSON.stringify(scenario));
  return file;
}

test('a passing mini-scenario reports zero failures', () => {
  const dir = mkTmpDir();
  const scenarioPath = writeScenario(dir, {
    name: 'mini-pass',
    steps: [
      { op: 'jsonl.appendLine', args: ['$TMP/x.jsonl', { a: 1 }] },
      { op: 'jsonl.readAll', args: ['$TMP/x.jsonl'], expect: { records: [{ a: 1 }], errors: [] } },
    ],
  });

  const outcome = replay(scenarioPath, { tmpRoot: dir });
  assert.equal(outcome.name, 'mini-pass');
  assert.equal(outcome.passed, 2);
  assert.equal(outcome.failed, 0);
  assert.equal(outcome.results.length, 2);
  assert.ok(outcome.results.every((r) => r.ok === true));
  assert.equal(typeof outcome.ms, 'number');
  assert.ok(outcome.ms >= 0);
});

test('a failing expect is reported as a failed step without throwing', () => {
  const dir = mkTmpDir();
  const scenarioPath = writeScenario(dir, {
    name: 'mini-fail',
    steps: [
      { op: 'jsonl.appendLine', args: ['$TMP/x.jsonl', { a: 1 }] },
      { op: 'jsonl.readAll', args: ['$TMP/x.jsonl'], expect: { records: [{ a: 999 }], errors: [] } },
    ],
  });

  const outcome = replay(scenarioPath, { tmpRoot: dir });
  assert.equal(outcome.passed, 1);
  assert.equal(outcome.failed, 1);
  assert.equal(outcome.results[0].ok, true);
  assert.equal(outcome.results[1].ok, false);
  assert.equal(typeof outcome.results[1].detail, 'string');
});

test('expectError matches a thrown error message substring as a pass', () => {
  const dir = mkTmpDir();
  const scenarioPath = writeScenario(dir, {
    name: 'expect-error',
    steps: [
      {
        op: 'jsonl.appendLine',
        args: ['$TMP/x.jsonl', { big: 'y'.repeat(9000) }],
        expectError: 'LINE_CEILING',
      },
    ],
  });

  const outcome = replay(scenarioPath, { tmpRoot: dir });
  assert.equal(outcome.passed, 1);
  assert.equal(outcome.failed, 0);
  assert.equal(outcome.results[0].ok, true);
});

test('delivery.assembleLastMile/renderFacts/checkDeliveryReady ops are wired into the dispatch table', () => {
  const dir = mkTmpDir();
  const suite = [{ journey_id: 'a', criterion_id: 'c1', script_path: 'test/c1.test.js', harness: 'node-test', added_in_milestone: 'M1' }];
  const scenarioPath = writeScenario(dir, {
    name: 'delivery-ops',
    steps: [
      {
        op: 'stream.appendRecord',
        args: ['$TMP/ledger.jsonl', { kind: 'gate', payload: { gate_id: 'gate-a', cmd: 'x', exit_code: 0 }, correlation_id: 'gate-a' }],
      },
      { op: 'verification.startRun', args: ['$TMP', 'run-1', suite] },
      {
        op: 'verification.recordRun',
        args: ['$TMP', 'run-1', [{ journey_id: 'a', status: 'pass', duration_ms: 1, gate_id: 'gate-a' }], '$TMP/ledger.jsonl'],
      },
      { op: 'verification.computeSuiteState', args: ['$TMP', 'run-1', { schema_version: 1, entries: [] }, suite] },
      {
        op: 'delivery.assembleLastMile',
        args: ['$TMP'],
        expect: {
          schema_version: 1,
          generated_from_run: 'run-1',
          items: [],
          counts: {
            total: 0,
            last_mile_parks: 0,
            quarantine_entries: 0,
            fix_attempts_at_cap: 0,
            verification_reports: 0,
            milestones_not_green: 0,
          },
        },
      },
      { op: 'delivery.renderFacts', args: ['$TMP'] },
      { op: 'delivery.checkDeliveryReady', args: ['$TMP'], expect: { ok: true, missing: [] } },
    ],
  });

  const outcome = replay(scenarioPath, { tmpRoot: dir });
  assert.equal(outcome.failed, 0);
  assert.equal(outcome.passed, 7);
});

test('expectError step fails when the substring does not match the thrown message', () => {
  const dir = mkTmpDir();
  const scenarioPath = writeScenario(dir, {
    name: 'expect-error-mismatch',
    steps: [
      {
        op: 'jsonl.appendLine',
        args: ['$TMP/x.jsonl', { big: 'y'.repeat(9000) }],
        expectError: 'totally-unrelated-substring',
      },
    ],
  });

  const outcome = replay(scenarioPath, { tmpRoot: dir });
  assert.equal(outcome.failed, 1);
  assert.equal(outcome.results[0].ok, false);
});

test('expectError step fails when the call succeeds instead of throwing', () => {
  const dir = mkTmpDir();
  const scenarioPath = writeScenario(dir, {
    name: 'expect-error-no-throw',
    steps: [{ op: 'jsonl.appendLine', args: ['$TMP/x.jsonl', { a: 1 }], expectError: 'anything' }],
  });

  const outcome = replay(scenarioPath, { tmpRoot: dir });
  assert.equal(outcome.failed, 1);
  assert.equal(outcome.results[0].ok, false);
});

test('step.ignore strips volatile keys before the expect comparison', () => {
  const dir = mkTmpDir();
  const scenarioPath = writeScenario(dir, {
    name: 'ignore-keys',
    steps: [
      {
        op: 'settings.applySchema',
        args: [{}, { width: { default: 3 } }],
        ignore: ['clamps'],
        expect: { settings: { width: 3 } },
      },
    ],
  });

  const outcome = replay(scenarioPath, { tmpRoot: dir });
  assert.equal(outcome.passed, 1);
  assert.equal(outcome.failed, 0);
});

test('$TMP-prefixed args are rewritten into a sandbox and the sandbox is cleaned up after the run', () => {
  const dir = mkTmpDir();
  const scenarioPath = writeScenario(dir, {
    name: 'cleanup',
    steps: [{ op: 'jsonl.appendLine', args: ['$TMP/x.jsonl', { a: 1 }] }],
  });

  assert.deepEqual(fs.readdirSync(dir).filter((n) => n !== 'scenario.json'), []);
  const outcome = replay(scenarioPath, { tmpRoot: dir });
  assert.equal(outcome.failed, 0);
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n !== 'scenario.json'), []);
});

test('$TMP paths nested inside object args are also rewritten (checkHonesty op)', () => {
  const dir = mkTmpDir();
  const scenarioPath = writeScenario(dir, {
    name: 'nested-tmp',
    steps: [
      { op: 'atomicJson.writeAtomic', args: ['$TMP/state.json', { gates: [], checklist: [] }] },
      {
        op: 'checkHonesty',
        args: [{ statePath: '$TMP/state.json', ledgerPath: '$TMP/ledger.jsonl' }],
        expect: { ok: true, violations: [] },
      },
    ],
  });

  const outcome = replay(scenarioPath, { tmpRoot: dir });
  assert.equal(outcome.failed, 0);
});

test('a $TMP path attempting to traverse outside the sandbox is rejected as a failed step, not followed', () => {
  const dir = mkTmpDir();
  const scenarioPath = writeScenario(dir, {
    name: 'traversal',
    steps: [{ op: 'jsonl.appendLine', args: ['$TMP/../outside.jsonl', { a: 1 }] }],
  });

  const outcome = replay(scenarioPath, { tmpRoot: dir });
  assert.equal(outcome.failed, 1);
  assert.equal(outcome.results[0].ok, false);
  assert.equal(fs.existsSync(path.join(dir, 'outside.jsonl')), false);
});

test('a string merely prefixed with "$TMP" (not "$TMP/...") is left untouched rather than rewritten to a sibling path', () => {
  const dir = mkTmpDir();
  const scenarioPath = writeScenario(dir, {
    name: 'sibling-literal',
    steps: [
      {
        op: 'validators.validateEnvelope',
        args: [{ state: 'done', result: '$TMPfoo', evidence: 'e', risks: 'r', artifact: 'a', question: '' }],
        expect: { ok: true, errors: [] },
      },
    ],
  });

  const outcome = replay(scenarioPath, { tmpRoot: dir });
  assert.equal(outcome.failed, 0);
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n !== 'scenario.json'), []);
});

test('CLI: exit code 0 on an all-passing scenario', () => {
  const dir = mkTmpDir();
  const scenarioPath = writeScenario(dir, {
    name: 'cli-pass',
    steps: [{ op: 'jsonl.appendLine', args: ['$TMP/x.jsonl', { a: 1 }] }],
  });

  const proc = spawnSync(process.execPath, [CLI_PATH, scenarioPath], { encoding: 'utf8' });
  assert.equal(proc.status, 0);
  assert.match(proc.stdout, /PASS/);
});

test('stream.appendRecord and stream.validateRecordHeader ops are wired into the dispatch table', () => {
  const dir = mkTmpDir();
  const scenarioPath = writeScenario(dir, {
    name: 'stream-ops',
    steps: [
      {
        op: 'stream.appendRecord',
        args: ['$TMP/s.jsonl', { kind: 'genesis', payload: {}, correlation_id: null }],
        expect: 0,
      },
      {
        op: 'stream.validateRecordHeader',
        args: [{ seq: 0, kind: 'genesis' }],
        expect: { ok: false, errors: ['missing schema_version', 'missing ts', 'missing correlation_id'] },
      },
      { op: 'stream.readRecords', args: ['$TMP/s.jsonl'] },
    ],
  });

  const outcome = replay(scenarioPath, { tmpRoot: dir });
  assert.equal(outcome.failed, 0);
  assert.equal(outcome.passed, 3);
});

test('scaffold.scaffoldTree and routing.loadRouting ops are wired into the dispatch table', () => {
  const dir = mkTmpDir();
  const routingConfig = path.join(__dirname, '..', 'routing', 'routing-2026-07-27-4.json');
  const scenarioPath = writeScenario(dir, {
    name: 'scaffold-routing-ops',
    steps: [
      { op: 'scaffold.scaffoldTree', args: ['$TMP/proj', { routingConfigPath: routingConfig }] },
      {
        op: 'routing.loadRouting',
        args: ['$TMP/proj/.thelastskill/routing'],
        ignore: ['config'],
        expect: { activeFile: 'routing-2026-07-27-4.json' },
      },
    ],
  });

  const outcome = replay(scenarioPath, { tmpRoot: dir });
  assert.equal(outcome.failed, 0);
  assert.equal(outcome.passed, 2);
});

test('researchCache.loadIndex/upsertEntry/isFresh/requireFreshOrExplain ops are wired into the dispatch table', () => {
  const dir = mkTmpDir();
  const scenarioPath = writeScenario(dir, {
    name: 'research-cache-ops',
    steps: [
      {
        op: 'researchCache.loadIndex',
        args: ['$TMP/research/index.json'],
        expect: { schema_version: 1, entries: [] },
      },
      {
        op: 'researchCache.upsertEntry',
        args: [
          '$TMP/research/index.json',
          {
            topic: 'chief-researcher-pattern',
            path: 'research/chief-researcher-pattern-2026-07-20.md',
            date: '2026-07-20',
            sources: [{ url: 'https://example.com/doc', fetched_ts: '2026-07-20T10:00:00Z' }],
          },
        ],
        expect: {
          schema_version: 1,
          entries: [
            {
              topic: 'chief-researcher-pattern',
              path: 'research/chief-researcher-pattern-2026-07-20.md',
              date: '2026-07-20',
              sources: [{ url: 'https://example.com/doc', fetched_ts: '2026-07-20T10:00:00Z' }],
            },
          ],
        },
      },
      {
        op: 'researchCache.isFresh',
        args: [
          { topic: 'chief-researcher-pattern', date: '2026-07-20' },
          '2026-07-27T00:00:00Z',
          7,
        ],
        expect: true,
      },
      {
        op: 'researchCache.requireFreshOrExplain',
        args: [
          { schema_version: 1, entries: [{ topic: 'chief-researcher-pattern', date: '2026-07-20' }] },
          'chief-researcher-pattern',
          '2026-07-27T00:00:00Z',
        ],
        expect: { fresh: true, entry: { topic: 'chief-researcher-pattern', date: '2026-07-20' } },
        ignore: ['reason'],
      },
    ],
  });

  const outcome = replay(scenarioPath, { tmpRoot: dir });
  assert.equal(outcome.failed, 0);
  assert.equal(outcome.passed, 4);
});

test('manifest.buildManifest/writeManifest/verifyManifest ops are wired and detect drift', () => {
  const dir = mkTmpDir();
  const scenarioPath = writeScenario(dir, {
    name: 'manifest-ops',
    steps: [
      { op: 'atomicJson.writeAtomic', args: ['$TMP/arch/plan.json', { note: 'plan' }] },
      { op: 'manifest.buildManifest', args: ['$TMP/arch', ['plan.json']] },
      { op: 'manifest.writeManifest', args: ['$TMP/arch', ['plan.json'], '$TMP/arch/manifest.json'] },
      {
        op: 'manifest.verifyManifest',
        args: [
          '$TMP/arch',
          { schema_version: 1, revision: 1, artifacts: [{ path: 'ghost.json', digest: `sha256:${'0'.repeat(64)}` }] },
        ],
        expect: { ok: false, drift: [{ file: 'ghost.json', reason: 'missing' }] },
      },
    ],
  });

  const outcome = replay(scenarioPath, { tmpRoot: dir });
  assert.equal(outcome.failed, 0);
  assert.equal(outcome.passed, 4);
});

test('phases.loadRegistry/canEnter/advance/resumePoint ops are wired into the dispatch table', () => {
  const dir = mkTmpDir();
  const routingConfig = path.join(__dirname, '..', 'routing', 'routing-2026-07-27-4.json');
  const registryPath = path.join(__dirname, '..', 'phases-registry.json');
  const miniRegistry = {
    schema_version: 1,
    phases: [
      { id: 'onboarding', order: 1, title: 'Onboarding', interactive: true, entry_requires: [], exit_emits: ['state.json'], resumable: true },
      { id: 'brainstorm', order: 2, title: 'Brainstorm', interactive: true, entry_requires: [], exit_emits: [], resumable: true },
    ],
  };
  const scenarioPath = writeScenario(dir, {
    name: 'phases-ops',
    steps: [
      { op: 'scaffold.scaffoldTree', args: ['$TMP/proj', { routingConfigPath: routingConfig }] },
      {
        op: 'phases.loadRegistry',
        args: [registryPath],
        ignore: ['phases'],
        expect: { schema_version: 1 },
      },
      {
        op: 'phases.canEnter',
        args: ['$TMP/proj/.thelastskill', miniRegistry, 'brainstorm'],
        expect: { ok: true, missing: [] },
      },
      {
        op: 'phases.advance',
        args: [
          '$TMP/proj/.thelastskill',
          miniRegistry,
          '$TMP/proj/.thelastskill/state.json',
          '$TMP/proj/.thelastskill/ledger.jsonl',
        ],
        ignore: ['state'],
        expect: { from: 'onboarding', to: 'brainstorm' },
      },
      {
        op: 'phases.resumePoint',
        args: ['$TMP/proj/.thelastskill', miniRegistry, '$TMP/proj/.thelastskill/state.json'],
        expect: { phase: 'brainstorm', canResume: true, missing: [] },
      },
    ],
  });

  const outcome = replay(scenarioPath, { tmpRoot: dir });
  assert.equal(outcome.failed, 0, JSON.stringify(outcome.results, null, 2));
  assert.equal(outcome.passed, 5);
});

test('telemetry.status and telemetry.recordEvent ops are wired into the dispatch table and refuse without consent', () => {
  const dir = mkTmpDir();
  const scenarioPath = writeScenario(dir, {
    name: 'telemetry-ops',
    steps: [
      {
        op: 'telemetry.status',
        args: ['$TMP/usage', { telemetry_consent: false }],
        expect: { enabled: false, reason: 'consent', files: [], totalBytes: 0 },
      },
      {
        op: 'telemetry.recordEvent',
        args: [
          '$TMP/usage',
          { telemetry_consent: false },
          { kind: 'phase_transition', payload: { from: 'onboarding', to: 'brainstorm' } },
        ],
        expect: { recorded: false, reason: 'consent' },
      },
    ],
  });

  const outcome = replay(scenarioPath, { tmpRoot: dir });
  assert.equal(outcome.failed, 0, JSON.stringify(outcome.results, null, 2));
  assert.equal(outcome.passed, 2);
});

test('detect.detect op is wired into the dispatch table and reports greenfield for a fresh sandbox', () => {
  const dir = mkTmpDir();
  const scenarioPath = writeScenario(dir, {
    name: 'detect-op',
    steps: [
      {
        op: 'detect.detect',
        args: ['$TMP'],
        expect: {
          mode: 'greenfield',
          evidence: {
            has_tree: false,
            has_state: false,
            has_git: false,
            has_code: false,
            legacy_tier: null,
            legacy_markers: [],
            intake_txn: null,
          },
        },
      },
    ],
  });

  const outcome = replay(scenarioPath, { tmpRoot: dir });
  assert.equal(outcome.failed, 0, JSON.stringify(outcome.results, null, 2));
  assert.equal(outcome.passed, 1);
});

test('interviewPanels.buildPanel3 op is wired into the dispatch table and produces the 4x4-compliant Panel 3 shape', () => {
  const dir = mkTmpDir();
  const knobs = {
    checkpoints: {
      default: 'milestone_pauses',
      enum: ['milestone_pauses', 'autonomous'],
      description: 'When the pipeline stops and shows you its work.',
    },
    budget: {
      properties: {
        claude_ceiling_usd: { description: 'Hard spend ceiling in USD for Claude-family seats on this slice.' },
        codex_ceiling_usd: { description: 'Hard spend ceiling in USD for Codex/Sol-family seats on this slice.' },
        budget_report: { description: 'Opt in to a rough cost report.', default: false },
      },
    },
  };
  const scenarioPath = writeScenario(dir, {
    name: 'interview-panels-op',
    steps: [
      { op: 'interviewPanels.buildPanel3', args: [knobs, 'full-cross-family'] },
    ],
  });

  const outcome = replay(scenarioPath, { tmpRoot: dir });
  assert.equal(outcome.failed, 0, JSON.stringify(outcome.results, null, 2));
  assert.equal(outcome.passed, 1);
});

test('catalog.categories/list/show/sample ops are wired into the dispatch table, scoped only', () => {
  const dir = mkTmpDir();
  const miniCatalog = {
    schema_version: 1,
    categories: [{ id: 'cat-a', title: 'Category A', description: 'desc a' }],
    techniques: [
      { id: 't1', name: 'T1', category: 'cat-a', mechanics: 'Do the first thing then the second thing.', goal_tags: ['feature'], audience_tags: ['solo'], phase: 'divergent' },
      { id: 't2', name: 'T2', category: 'cat-a', mechanics: 'Do the third thing then the fourth thing.', goal_tags: ['novelty'], audience_tags: ['group'], phase: 'divergent' },
    ],
  };
  const scenarioPath = writeScenario(dir, {
    name: 'catalog-ops',
    steps: [
      {
        op: 'catalog.categories',
        args: [miniCatalog],
        expect: [{ id: 'cat-a', title: 'Category A', count: 2 }],
      },
      {
        op: 'catalog.list',
        args: [miniCatalog, { category: 'cat-a', goal_tag: 'novelty' }],
        expect: [{ id: 't2', name: 'T2', mechanics: 'Do the third thing then the fourth thing.' }],
      },
      {
        op: 'catalog.show',
        args: [miniCatalog, 't1'],
        expect: {
          id: 't1',
          name: 'T1',
          category: 'cat-a',
          mechanics: 'Do the first thing then the second thing.',
          goal_tags: ['feature'],
          audience_tags: ['solo'],
          phase: 'divergent',
        },
      },
      {
        op: 'catalog.sample',
        args: [miniCatalog, { phase: 'divergent', n: 1, seed: 'replay-seed' }],
      },
    ],
  });

  const outcome = replay(scenarioPath, { tmpRoot: dir });
  assert.equal(outcome.failed, 0, JSON.stringify(outcome.results, null, 2));
  assert.equal(outcome.passed, 4);
});

test('catalog.loadCatalog is not a reachable dispatch op — no exported/dispatcher path returns the full roster', () => {
  const dir = mkTmpDir();
  const catalogPath = path.join(__dirname, '..', '..', 'product', 'brainstorm', 'catalog.json');
  const scenarioPath = writeScenario(dir, {
    name: 'catalog-no-unscoped-op',
    steps: [
      { op: 'catalog.loadCatalog', args: [catalogPath], expectError: 'unknown op' },
      { op: 'catalog._load', args: [catalogPath], expectError: 'unknown op' },
      // Even a nominally scoped call is refused when it isn't actually scoped.
      { op: 'catalog.list', args: [{ schema_version: 1, categories: [], techniques: [] }], expectError: 'requires at least one of' },
    ],
  });

  const outcome = replay(scenarioPath, { tmpRoot: dir });
  assert.equal(outcome.failed, 0, JSON.stringify(outcome.results, null, 2));
  assert.equal(outcome.passed, 3);
});

test('validators.validateCriteriaRegister/validateMilestones and planGate.approveGate/verifyGate ops are wired into the dispatch table', () => {
  const dir = mkTmpDir();
  const scenarioPath = writeScenario(dir, {
    name: 'criteria-milestones-plan-gate-ops',
    steps: [
      {
        op: 'validators.validateCriteriaRegister',
        args: [
          {
            schema_version: 1,
            criteria: [{ id: 'ACR-1', text: 'A thing works.', source_ref: 'vision.md#5', journey_id: 'J1' }],
          },
        ],
        expect: { ok: true, errors: [] },
      },
      {
        op: 'validators.validateMilestones',
        args: [
          {
            schema_version: 1,
            milestones: [
              {
                id: 'M1',
                order: 1,
                title: 'Skeleton',
                designer_family: 'claude',
                slice_goal: 'Stand it up.',
                chunk_count_estimate: 1,
                criteria_ids: ['ACR-1'],
              },
            ],
          },
        ],
        expect: { ok: true, errors: [] },
      },
      { op: 'atomicJson.writeAtomic', args: ['$TMP/arch/plan.md', { note: 'plan' }] },
      {
        op: 'atomicJson.writeAtomic',
        args: [
          '$TMP/arch/criteria-register.json',
          {
            schema_version: 1,
            criteria: [{ id: 'ACR-1', text: 'A thing works.', source_ref: 'vision.md#5', journey_id: 'J1' }],
          },
        ],
      },
      {
        op: 'atomicJson.writeAtomic',
        args: [
          '$TMP/arch/milestones.json',
          {
            schema_version: 1,
            milestones: [
              {
                id: 'M1',
                order: 1,
                title: 'Skeleton',
                designer_family: 'claude',
                slice_goal: 'Stand it up.',
                chunk_count_estimate: 1,
                criteria_ids: ['ACR-1'],
              },
            ],
          },
        ],
      },
      { op: 'atomicJson.writeAtomic', args: ['$TMP/arch/artifact-map.json', { artifacts: [{ path: 'x', format: 'json', writer: 'x', created_by_phase: 'x', restart_role: 'x' }] }] },
      { op: 'atomicJson.writeAtomic', args: ['$TMP/arch/protocol-record.md', { protocol: 'standard', note: 'protocol' }] },
      {
        op: 'planGate.approveGate',
        args: ['$TMP/arch'],
        ignore: ['manifest', 'manifestPath', 'gate', 'gatePath', 'manifestDigest', 'created', 'ledgerPath', 'ledgerSeq'],
        expect: {},
      },
      {
        op: 'planGate.verifyGate',
        args: ['$TMP/arch'],
        expect: { ok: true, reasons: [] },
      },
    ],
  });

  const outcome = replay(scenarioPath, { tmpRoot: dir });
  assert.equal(outcome.failed, 0, JSON.stringify(outcome.results, null, 2));
  assert.equal(outcome.passed, 9);
});

test('CLI: exit code 1 when any step fails', () => {
  const dir = mkTmpDir();
  const scenarioPath = writeScenario(dir, {
    name: 'cli-fail',
    steps: [{ op: 'jsonl.appendLine', args: ['$TMP/x.jsonl', { a: 1 }], expectError: 'never-matches' }],
  });

  const proc = spawnSync(process.execPath, [CLI_PATH, scenarioPath], { encoding: 'utf8' });
  assert.equal(proc.status, 1);
  assert.match(proc.stdout, /FAIL/);
});

test('verification.* and quarantine.* ops are wired into the dispatch table end to end', () => {
  const dir = mkTmpDir();
  const criteriaRegister = {
    schema_version: 1,
    criteria: [
      { id: 'c1', text: 'criterion one', source_ref: 'vision.md#1', journey_id: 'journey-c1' },
      { id: 'c2', text: 'criterion two', source_ref: 'vision.md#2', journey_id: 'journey-c2' },
    ],
  };
  const journeysIndex = {
    schema_version: 1,
    journeys: [
      { journey_id: 'journey-c1', criterion_id: 'c1', script_path: 'test/c1.test.js', harness: 'node-test', added_in_milestone: 'M1' },
      { journey_id: 'journey-c2', criterion_id: 'c2', script_path: 'test/c2.test.js', harness: 'node-test', added_in_milestone: 'M1' },
    ],
  };

  const scenarioPath = writeScenario(dir, {
    name: 'verification-ops',
    steps: [
      {
        op: 'verification.assembleSuite',
        args: ['$TMP', criteriaRegister, journeysIndex],
        expect: { ok: true, errors: [], journeys: journeysIndex.journeys },
      },
      {
        op: 'verification.orderRun',
        args: [
          [{ journey_id: 'journey-c2', status: 'fail', duration_ms: 5, gate_id: 'g0' }],
          { schema_version: 1, generated_at: '2026-01-01T00:00:00.000Z', entries: [] },
          [{ journey_id: 'journey-c1' }, { journey_id: 'journey-c2' }],
        ],
        expect: [{ journey_id: 'journey-c2' }, { journey_id: 'journey-c1' }],
      },
      {
        op: 'verification.startRun',
        args: ['$TMP', 'run-1', journeysIndex.journeys],
        ignore: ['suiteDigest', 'runPath'],
        expect: { runId: 'run-1', seq: 0 },
      },
      {
        op: 'stream.appendRecord',
        args: ['$TMP/ledger.jsonl', { kind: 'gate', payload: { gate_id: 'gate-c1', cmd: 'x', exit_code: 0 }, correlation_id: 'gate-c1' }],
        expect: 0,
      },
      {
        op: 'stream.appendRecord',
        args: ['$TMP/ledger.jsonl', { kind: 'gate', payload: { gate_id: 'gate-c2', cmd: 'x', exit_code: 0 }, correlation_id: 'gate-c2' }],
        expect: 1,
      },
      {
        op: 'verification.recordRun',
        args: [
          '$TMP',
          'run-1',
          [
            { journey_id: 'journey-c1', status: 'pass', duration_ms: 10, gate_id: 'gate-c1' },
            { journey_id: 'journey-c2', status: 'pass', duration_ms: 12, gate_id: 'gate-c2' },
          ],
          '$TMP/ledger.jsonl',
        ],
        ignore: ['runPath'],
        // run-1.jsonl already carries the run-start record (seq 0) from
        // startRun above, so these two results land at seq 1 and 2.
        expect: { seqs: [1, 2] },
      },
      {
        op: 'verification.computeSuiteState',
        args: ['$TMP', 'run-1', { schema_version: 1, entries: [] }, journeysIndex.journeys],
        ignore: ['ts', 'run_seq', 'suite_digest'],
        expect: {
          schema_version: 1,
          run_id: 'run-1',
          status: 'green',
          passing: ['journey-c1', 'journey-c2'],
          failing: [],
          reasons: {},
          quarantined: [],
        },
      },
      {
        op: 'quarantine.recordOutcome',
        args: ['$TMP/verification/quarantine.json', 'journey-c2', 'fail', { runId: 'run-1' }],
        expect: {
          doc: {
            schema_version: 1,
            entries: [{ journey_id: 'journey-c2', since_run: 'run-1', reason: null, history: [{ outcome: 'fail', run_id: 'run-1' }] }],
          },
          verdict: null,
        },
      },
      {
        op: 'quarantine.decideFlake',
        args: [
          [
            { outcome: 'fail', run_id: 'run-1' },
            { outcome: 'pass', run_id: 'run-2' },
          ],
        ],
        expect: 'quarantine',
      },
      {
        op: 'quarantine.release',
        args: ['$TMP/verification/quarantine.json', 'journey-c2'],
        expect: { schema_version: 1, entries: [] },
      },
      {
        op: 'quarantine.capCheckAndRecord',
        args: ['$TMP', 'problem-journey-c2'],
        expect: { allowed: true, agreement_pass_required: false, count: 1 },
      },
      {
        op: 'verification.recordAffected',
        args: ['$TMP', [{ journey_id: 'journey-c1', affected_by: ['M1'], status: 'pending' }]],
        ignore: ['generated_at'],
        expect: {
          schema_version: 1,
          entries: [{ journey_id: 'journey-c1', affected_by: ['M1'], status: 'pending' }],
        },
      },
    ],
  });

  const outcome = replay(scenarioPath, { tmpRoot: dir });
  assert.equal(outcome.failed, 0, JSON.stringify(outcome.results, null, 2));
  assert.equal(outcome.passed, 12);
});

test('anonymize.anonymizeBundle op is wired into the dispatch table', () => {
  const dir = mkTmpDir();
  const scenarioPath = writeScenario(dir, {
    name: 'anonymize-ops',
    steps: [
      { op: 'atomicJson.writeAtomic', args: ['$TMP/src/plan.md', { note: 'Drafted by Claude Opus.' }] },
      {
        op: 'anonymize.anonymizeBundle',
        args: ['$TMP/src', '$TMP/anon', ['plan.md']],
        ignore: ['written'],
        expect: {},
      },
    ],
  });

  const outcome = replay(scenarioPath, { tmpRoot: dir });
  assert.equal(outcome.failed, 0, JSON.stringify(outcome.results, null, 2));
  assert.equal(outcome.passed, 2);
});

test('preflight.run op is wired into the dispatch table (real node/git, stubbed codex)', () => {
  const dir = mkTmpDir();
  const routingConfig = path.join(__dirname, '..', 'routing', 'routing-2026-07-27-4.json');
  const scenarioPath = writeScenario(dir, {
    name: 'preflight-ops',
    steps: [
      { op: 'scaffold.scaffoldTree', args: ['$TMP/proj', { routingConfigPath: routingConfig }] },
      {
        op: 'preflight.run',
        args: ['$TMP/proj', { workflowTool: true, agentTeams: true, codexCmd: 'exit 0' }],
        ignore: ['repo'],
        expect: {
          mode: 'full-cross-family',
          gates: [
            { name: 'preflight-node', cmd: 'node --version', last_result: 'pass' },
            { name: 'codex-preflight', cmd: 'exit 0', last_result: 'pass' },
            { name: 'preflight-git', cmd: 'git rev-parse --is-inside-work-tree', last_result: 'pass' },
          ],
          capabilities: {
            workflow_tool: { present: true, source: 'session-tool-list', observed: 'present' },
            agent_teams: { present: true, source: 'session-tool-list', observed: 'present' },
          },
        },
      },
    ],
  });

  const outcome = replay(scenarioPath, { tmpRoot: dir });
  assert.equal(outcome.failed, 0, JSON.stringify(outcome.results, null, 2));
  assert.equal(outcome.passed, 2);
});

test('settings.write/settings.read ops are wired into the dispatch table', () => {
  const dir = mkTmpDir();
  const scenarioPath = writeScenario(dir, {
    name: 'settings-write-ops',
    steps: [
      {
        op: 'settings.write',
        args: ['$TMP', { budget: { claude_ceiling_usd: -10 } }],
        expect: {
          facilitator: 'opus-5',
          research_width: 3,
          planning: 'standard',
          reviews: 'floor',
          checkpoints: 'milestone_pauses',
          narration: 'full_cast',
          budget: { claude_ceiling_usd: 0, codex_ceiling_usd: null, budget_report: false },
          telemetry_consent: false,
          blocking_preference: 'auto_remedy',
          plan_review: 'auto_proceed',
          floor_lock: true,
        },
      },
      {
        op: 'settings.read',
        args: ['$TMP'],
        expect: {
          facilitator: 'opus-5',
          research_width: 3,
          planning: 'standard',
          reviews: 'floor',
          checkpoints: 'milestone_pauses',
          narration: 'full_cast',
          budget: { claude_ceiling_usd: 0, codex_ceiling_usd: null, budget_report: false },
          telemetry_consent: false,
          blocking_preference: 'auto_remedy',
          plan_review: 'auto_proceed',
          floor_lock: true,
        },
      },
    ],
  });

  const outcome = replay(scenarioPath, { tmpRoot: dir });
  assert.equal(outcome.failed, 0, JSON.stringify(outcome.results, null, 2));
  assert.equal(outcome.passed, 2);
});
