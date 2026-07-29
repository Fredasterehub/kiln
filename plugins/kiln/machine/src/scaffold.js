'use strict';

// The one sanctioned home for `.kiln/` tree-shape knowledge — the final
// `.kiln/` tree specification. Every other module treats paths as
// parameters; the SHAPE of the greenfield skeleton lives here and nowhere
// else.
//
// Genesis records for every JSONL stream below are written through
// stream.js's own `appendRecord` (common header stamping + jsonl.js's
// single-writer seq allocation) rather than hand-rolled here.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { appendRecord } = require('./stream.js');
const { writeAtomic } = require('./atomic-json.js');
const { DATED_ROUTING_CONFIG_RE } = require('./routing.js');
const { approveGate } = require('./plan-gate.js');

const TREE_NAME = '.kiln';

// Directories that exist empty at greenfield genesis, later phases populate
// them. `scout/` is deliberately excluded here — it is brownfield-only and
// this module scaffolds the greenfield tree.
const GREENFIELD_DIRS = [
  '.',
  'vision',
  'research',
  'architecture',
  'milestones',
  'verification',
  path.join('verification', 'runs'),
  'envelopes',
  'delivery',
  'usage',
  'archive',
  'routing',
];

const RFC3339 = () => new Date().toISOString();

function writeGenesisRecord(file) {
  appendRecord(file, { kind: 'genesis', payload: {}, correlation_id: null });
}

function sha256Of(buf) {
  return `sha256:${crypto.createHash('sha256').update(buf).digest('hex')}`;
}

// scaffoldTree(targetRoot, opts) — materializes the greenfield `.kiln/`
// skeleton under targetRoot. Refuses (throws) if
// targetRoot/.kiln already exists unless opts.force is true, in
// which case the existing tree is removed and rebuilt fresh.
//
// opts.routingConfigPath (required): source path to the current dated
// routing config (e.g. machine/routing/routing-2026-07-27-4.json) to copy
// into the new tree's routing/ directory as its genesis dated config.
//
// Returns { created: [absolute paths, in creation order] }.
function scaffoldTree(targetRoot, opts = {}) {
  if (typeof targetRoot !== 'string' || targetRoot === '') {
    throw new TypeError('scaffoldTree: targetRoot must be a non-empty string');
  }

  const routingConfigPath = opts.routingConfigPath;
  if (typeof routingConfigPath !== 'string' || routingConfigPath === '') {
    throw new TypeError(
      'scaffoldTree: opts.routingConfigPath is required (source path to the current dated routing config)'
    );
  }
  const routingBasename = path.basename(routingConfigPath);
  if (!DATED_ROUTING_CONFIG_RE.test(routingBasename)) {
    throw new TypeError(
      `scaffoldTree: opts.routingConfigPath must be named routing-YYYY-MM-DD-N.json (got "${routingBasename}")`
    );
  }
  let routingConfigRaw;
  try {
    routingConfigRaw = fs.readFileSync(routingConfigPath, 'utf8');
  } catch (err) {
    throw new Error(`scaffoldTree: could not read routingConfigPath ${routingConfigPath}: ${err.message}`);
  }
  let routingConfigObj;
  try {
    routingConfigObj = JSON.parse(routingConfigRaw);
  } catch (err) {
    throw new Error(`scaffoldTree: routingConfigPath ${routingConfigPath} is not valid JSON: ${err.message}`);
  }

  const root = path.join(targetRoot, TREE_NAME);
  if (fs.existsSync(root)) {
    if (!opts.force) {
      throw new Error(`scaffoldTree: ${root} already exists (pass opts.force to overwrite)`);
    }
    fs.rmSync(root, { recursive: true, force: true });
  }

  const created = [];

  for (const dir of GREENFIELD_DIRS) {
    const abs = path.join(root, dir);
    fs.mkdirSync(abs, { recursive: true });
    created.push(abs);
  }

  // state.json — THE resume pointer. Deliberately carries no
  // "gates"/"checklist" fields: those are not part of the binding schema
  // (check-honesty.js treats their absence as zero declared obligations,
  // not a violation — see check-honesty.js's state-contract comment).
  const statePath = path.join(root, 'state.json');
  writeAtomic(statePath, {
    schema_version: 1,
    created_ts: RFC3339(),
    phase: 'onboarding',
    phase_status: {},
    current_milestone: null,
    current_chunk: null,
    next_action: 'onboarding',
    updated_utc: RFC3339(),
  });
  created.push(statePath);

  // settings.json — onboarding genesis; ALL knobs incl. internal seats live
  // here. Empty at genesis: unknown keys are preserved,
  // and the onboarding interview (or a re-run's "settings.json already
  // exists" check) populates it — the scaffold itself makes no model
  // judgment about what belongs inside.
  const settingsPath = path.join(root, 'settings.json');
  writeAtomic(settingsPath, {});
  created.push(settingsPath);

  // handoff.md — a purely mechanical view of state.json/ledger.jsonl facts,
  // rewritten by machine/src/handoff.js's writeStop() at every Stop-states
  // event — never hand-authored prose. Genesis is a stub; the first real
  // write happens at this project's first stop.
  const handoffPath = path.join(root, 'handoff.md');
  fs.writeFileSync(handoffPath, '# Handoff\n\nOnboarding in progress. No phase has completed yet.\n');
  created.push(handoffPath);

  // ledger.jsonl — Maestro-only global event log genesis record.
  const ledgerPath = path.join(root, 'ledger.jsonl');
  writeGenesisRecord(ledgerPath);
  created.push(ledgerPath);

  // last-mile.jsonl — Maestro-only parking stream.
  const lastMilePath = path.join(root, 'last-mile.jsonl');
  writeGenesisRecord(lastMilePath);
  created.push(lastMilePath);

  // vision/transcript.jsonl — the long brainstorm dialogue stream. NEVER
  // projected into Maestro; genesis record only establishes
  // the stream, the facilitator is its sole writer from here.
  const transcriptPath = path.join(root, 'vision', 'transcript.jsonl');
  writeGenesisRecord(transcriptPath);
  created.push(transcriptPath);

  // vision/decisions.jsonl — single decision stream across phases.
  const decisionsPath = path.join(root, 'vision', 'decisions.jsonl');
  writeGenesisRecord(decisionsPath);
  created.push(decisionsPath);

  // research/scratchpad.jsonl — chief researcher's steering log.
  const scratchpadPath = path.join(root, 'research', 'scratchpad.jsonl');
  writeGenesisRecord(scratchpadPath);
  created.push(scratchpadPath);

  // routing/<dated config> — immutable copy of the current dated config.
  const routingConfigDest = path.join(root, 'routing', routingBasename);
  writeAtomic(routingConfigDest, routingConfigObj);
  created.push(routingConfigDest);

  // routing/active.json — atomic pointer to the dated config above.
  const digest = sha256Of(fs.readFileSync(routingConfigDest));
  const activePath = path.join(root, 'routing', 'active.json');
  writeAtomic(activePath, {
    schema_version: 1,
    active_config: routingBasename,
    digest,
  });
  created.push(activePath);

  return { created };
}

// scaffoldArchitecture(architectureDir, opts) — the phase-4 sealing
// operation: given the five substantive architecture artifacts already
// authored on disk by the architecture agents (plan.md,
// criteria-register.json, milestones.json, artifact-map.json,
// protocol-record.md — authorship needs model judgment, so this module does
// not write their content, only requires their presence), closes the
// canonical artifact shape. Refuses (throws) if any of the five required
// artifacts is missing — sealing before authoring is not permitted.
//
// This is a thin caller of plan-gate.js's approveGate() — the sole
// sanctioned producer of the manifest.json + gate.json pair (one native
// mechanism per constraint): two independent implementations of one
// sealing operation is exactly the redundant-enforcement failure mode the
// rule forbids, so this module owns only the phase-4 naming/opts surface
// and delegates the actual sealing to plan-gate.js.
function scaffoldArchitecture(architectureDir, opts = {}) {
  if (typeof architectureDir !== 'string' || architectureDir === '') {
    throw new TypeError('scaffoldArchitecture: architectureDir must be a non-empty string');
  }

  const gateOpts = {};
  if (Object.prototype.hasOwnProperty.call(opts, 'decision')) gateOpts.decision = opts.decision;
  if (Object.prototype.hasOwnProperty.call(opts, 'decisionSource')) gateOpts.decision_source = opts.decisionSource;
  if (Object.prototype.hasOwnProperty.call(opts, 'revision')) gateOpts.revision = opts.revision;

  const { manifest, manifestPath, gatePath } = approveGate(architectureDir, gateOpts);
  return { manifest, manifestPath, gatePath, created: [manifestPath, gatePath] };
}

function parseArgv(argv) {
  const positional = [];
  let routingConfigPath;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--routing') {
      routingConfigPath = argv[i + 1];
      i++;
    } else {
      positional.push(arg);
    }
  }
  return { targetRoot: positional[0], routingConfigPath };
}

function main(argv) {
  const { targetRoot, routingConfigPath } = parseArgv(argv);
  if (!targetRoot || !routingConfigPath) {
    process.stderr.write('usage: scaffold.js <targetRoot> --routing <datedConfigPath>\n');
    process.exit(1);
  }
  try {
    const { created } = scaffoldTree(targetRoot, { routingConfigPath });
    for (const p of created) console.log(p);
  } catch (err) {
    process.stderr.write(`scaffold.js: ${err.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { scaffoldTree, scaffoldArchitecture, TREE_NAME };
