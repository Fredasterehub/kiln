'use strict';

// The RUNTIME test for `workflows/implementation.js`.
//
// The chunk this file belongs to once shipped a green suite over a workflow
// script that nothing executed: the resolver was tested exhaustively, the
// script was tested not at all, and it was not even in a form the Workflow
// runtime could run. Unit tests over a resolver prove the resolver. This file
// exists to prove the SCRIPT — the real bytes on disk, executed.
//
// HOW THE SCRIPT IS RUN HERE. A Workflow script is not a module: it exports
// `meta` and then executes at top level with `await`, with `agent`, `phase`
// and `args` supplied by the runtime. So the harness reads the real file,
// makes exactly one textual substitution to capture `meta`, and evaluates the
// rest as an async function body — which is precisely the semantics the
// runtime gives it, including top-level `await` and a top-level `return`.
//
// That one substitution is itself an assertion. If the script ever stops
// beginning with `export const meta =` — if it becomes a CommonJS module
// again, the exact defect this round repaired — the substitution does not
// apply, `meta` is never captured, and every test in this file fails.
//
// WHAT THE STUBS DO AND DO NOT STAND IN FOR. The `workflow-hands` stub does
// not fake a machine call: it pulls the payload out of the prompt the script
// actually built and runs it through the real `workflow.js#invoke` against a
// real git-backed tree. So the facade, the resolver, the transactions, the
// capsule, the gates and the promotions are all genuinely exercised, and the
// payload's own well-formedness is under test too. Two things are stubbed:
// the model's judgment — the seat writes the artifact its prompt named,
// which is exactly what a real seat would do — and, in the default mode, the
// SHAPE of its reply. A hands stub that hands back a native object supplies
// the one thing the live seat cannot promise, since `HANDS.result` is typed
// as anything at all and a model reporting a command's stdout may lawfully
// report its text. The first live invocation did exactly that and died. Both
// shapes are driven here now (`stringifiedHands`).
//
// WHAT THIS IS NOT, SAID HERE BECAUSE THIS IS WHERE IT WILL BE BELIEVED. This
// harness is a FAITHFUL STAND-IN for the Workflow runtime. It is not the
// runtime. Wrapping the script's body in an AsyncFunction reproduces the
// semantics the runtime gives it — top-level `await`, a top-level `return`,
// `agent`/`phase`/`args` supplied from outside — and that is genuinely more
// than the suite has ever executed before. It is still a reproduction.
//
// So, exactly:
//
//   PROVEN HERE. The script is in exported-meta form and executes to
//   completion. The payloads it builds are well-formed and reach the real
//   facade. Every step names an `agentType` and a `schema`. The ladder's order
//   is what the resolver says it is, rung by rung, over a real repository.
//   Killed mid-transition at every rung, the tree resumes and finishes with no
//   duplicated record. The revise round trip, the steer seam and the consult
//   seam all close.
//
//   NOT PROVEN HERE, and only S9's live run can prove it. That the real
//   Workflow runtime accepts this file at all; that `agentType: "kiln:…"`
//   resolves these particular seats and carries their tool fences; that
//   `schema` shapes a real model's reply; that a real seat, reading these
//   prompts, writes where it was told. The S0 spike established the first two
//   for two seats, on one occasion — a platform fact established on one
//   fixture is not a platform fact established for this script.
//
// This build has twice shipped a claim carrying more confidence than its
// evidence, and both times the claim was in a header somebody later trusted.
// The scope belongs in the same breath as the claim, not twenty lines below it.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');

const workflow = require('../src/workflow.js');
const { nextTransition } = require('../src/spine.js');
const { assembleSuite } = require('../src/verification.js');
const { writeAtomic, readJson } = require('../src/atomic-json.js');
const { readRecords } = require('../src/stream.js');
const { writeSteerRaise } = require('../src/receipts.js');

const SCRIPT_PATH = path.join(__dirname, '..', '..', 'workflows', 'implementation.js');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

// ---------- the harness ----------

function loadScript() {
  const source = fs.readFileSync(SCRIPT_PATH, 'utf8');
  const captured = source.replace('export const meta =', 'const meta = __meta.value =');
  assert.notEqual(
    captured,
    source,
    'the workflow script must begin with `export const meta =` — a script that does not is not a workflow, and the runtime never executes it'
  );
  return new AsyncFunction('agent', 'phase', 'args', '__meta', captured);
}

// One invocation of the real script, with a recording `agent`.
//
// `handsShape` is what the SEAT does to a reply on its way back to the script —
// the machine call itself is real either way. The default is the shape this
// stub finds most convenient, and convenient is not the same as faithful: see
// `stringifiedHands`.
async function invokeWorkflow(treeRoot, { seat, calls = [], onHands, handsShape } = {}) {
  const script = loadScript();
  const meta = { value: null };
  const agent = async (prompt, opts) => {
    const call = { prompt, opts };
    calls.push(call);
    if (opts.agentType === 'kiln:workflow-hands') {
      // `onHands` runs BEFORE the operation does, which is what lets a test
      // kill the session at a named window. Without this hook the hands went
      // straight to `runHands` and no stub could ever see them — so a kill
      // matrix aimed at machine operations was only ever killing seat steps,
      // and said nothing about the rungs that run no seat at all.
      if (onHands) await onHands(prompt, opts);
      const reply = runHands(prompt);
      // RECORDED AS THE SCRIPT RECEIVES IT, not as the shaper meant to send it.
      // A shaper counting its own intentions satisfies its own assertion while
      // quietly handing the script the convenient shape — the reply the script
      // actually read is the only witness that a reply-shape test tested one.
      call.reply = handsShape ? handsShape(reply, payloadIn(prompt).op) : reply;
      return call.reply;
    }
    return seat(prompt, opts);
  };
  // THE HARNESS HAD TO STOP LYING TO THE GATES IT RUNS. A gate spawns the
  // target project's suite as a child process, and this file's own process is a
  // child of `node --test`, which sets `NODE_TEST_CONTEXT` in the environment
  // every such child then inherits. A `node --test` that finds that variable
  // believes it is a test FILE being run by a parent runner and reports through
  // the parent instead of its own exit code — so it exits 0 whether its tests
  // passed or failed. Every gate this harness ran was therefore green by
  // construction, and "the chunk gate passed" proved nothing at all about the
  // suite. Removed for the duration of the invocation and restored after: the
  // reporter this file uses to report ITSELF was configured when `node:test`
  // was required, so scrubbing it here reaches the children and not us.
  const savedTestContext = process.env.NODE_TEST_CONTEXT;
  delete process.env.NODE_TEST_CONTEXT;
  let result;
  try {
    result = await script(agent, () => {}, JSON.stringify({ treeRoot }), meta);
  } finally {
    if (savedTestContext !== undefined) process.env.NODE_TEST_CONTEXT = savedTestContext;
  }
  return { result, meta: meta.value, calls };
}

// The payload the script actually built, read back out of the prompt it wrote
// — between the very markers the seat is told to copy — so a script that built
// a malformed payload, or embedded it any other way, fails here.
function payloadIn(prompt) {
  const match = /<<'KILN_PAYLOAD'\n([\s\S]*?)\nKILN_PAYLOAD/.exec(prompt);
  assert.ok(match, 'the hands prompt must carry its payload in a quoted heredoc block');
  assert.equal(match[1].includes('\n'), false, 'the payload must be one line, or the heredoc marker is reachable');
  return JSON.parse(match[1]);
}

// The prompt with its payload lifted out: what the prompt SAYS, as opposed to
// the canonical data it carries. The markers stay, so a prompt that lost them
// still fails `payloadIn`.
function proseOf(prompt) {
  return prompt.replace(/(<<'KILN_PAYLOAD'\n)[\s\S]*?(\nKILN_PAYLOAD)/, '$1$2');
}

// The hands, for real: the payload goes through the real facade against a real
// tree, and what comes back is what the command would have printed.
function runHands(prompt) {
  const payload = payloadIn(prompt);
  try {
    return { ok: true, result: workflow.invoke(payload.treeRoot, payload.op, payload.args) };
  } catch (err) {
    return { ok: false, result: `${err.name}: ${err.message}` };
  }
}

// THE LIVE SEAT'S OTHER REPLY SHAPE — AND THE ONE THE FIRST LIVE FIRE ACTUALLY
// PRODUCED. `workflow-hands` is a model reporting a command's stdout into a
// schema whose `result` is typed as anything at all, so the operation's return
// reaches the script as the JSON TEXT the command printed just as lawfully as
// it reaches it parsed. A stub that only ever hands back a parsed object
// supplies, for production, precisely the fact production must demand for
// itself — which is how this ladder walked green here hundreds of times while
// BURN-1 died on its first invocation reading `.transition` off a string.
//
// The refusal path is left alone on purpose: a refusal's `result` is the error
// text the command printed, which is already a string and is carried back as
// one.
function stringifiedHands() {
  return (reply) => (reply.ok === true ? { ok: true, result: JSON.stringify(reply.result) } : reply);
}

// Every hands reply the script was actually handed, in order.
function handsRepliesIn(calls) {
  return calls.filter((c) => c.opts.agentType === 'kiln:workflow-hands').map((c) => c.reply);
}

// The paths a seat prompt names, in the order it names them. The script writes
// each on its own four-space-indented line, which is also how a real seat
// reads them.
function pathsIn(prompt) {
  return [...prompt.matchAll(/^ {4}(\/\S+)$/gm)].map((m) => m[1]);
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeAtomic(file, value);
}

// The last gate record for a gate id — the one that counts, exactly as the
// resolver reads it.
function gateRecord(treeRoot, gateId) {
  return readRecords(path.join(treeRoot, 'ledger.jsonl'))
    .records.filter((r) => r.kind === 'gate' && r.gate_id === gateId)
    .pop();
}

// The tree the index currently describes, derived WITHOUT touching the real
// index: `git write-tree` rewrites the index's cache-tree extension, so it runs
// against a copy. The gate's own materialization holds to the same rule, and a
// helper that broke it would be measuring its own damage.
function stagedTreeOf(repoRoot) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'staged-tree-'));
  const indexCopy = path.join(scratch, 'index');
  try {
    fs.copyFileSync(path.join(repoRoot, '.git', 'index'), indexCopy);
    return execFileSync('git', ['write-tree'], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, GIT_INDEX_FILE: indexCopy },
    }).trim();
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

// ---------- the fixture project ----------

// A real repository with a real, fast suite: the chunk gate and the regression
// floor both execute `node --test` in it for real, so "the gate passed" means
// a suite actually ran rather than a record somebody wrote.
// The journey the architecture minted for this fixture's one criterion. The
// register is the frozen 1:1 map of criterion to journey, so both ids come from
// there and nothing downstream may invent either.
const CRITERION = 'ACR-1';
const JOURNEY = 'J-ACR-1';
const JOURNEY_SCRIPT = 'test/journeys/acr-1.test.js';

function makeProject({ chunks = ['C1'], nominate = { C1: { journey_id: JOURNEY, script_path: JOURNEY_SCRIPT, harness: 'node-test' } } } = {}) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-runtime-'));
  const git = (...a) => execFileSync('git', a, { cwd: repoRoot, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  fs.writeFileSync(path.join(repoRoot, '.gitignore'), 'tree/\n');
  fs.writeFileSync(path.join(repoRoot, 'README.md'), 'seed\n');
  fs.mkdirSync(path.join(repoRoot, 'test'));
  fs.writeFileSync(
    path.join(repoRoot, 'test', 'smoke.test.js'),
    "const test = require('node:test');\nconst assert = require('node:assert');\ntest('smoke', () => assert.ok(true));\n"
  );
  git('add', '-A');
  git('commit', '-q', '-m', 'initial');

  const treeRoot = path.join(repoRoot, 'tree');
  fs.mkdirSync(path.join(treeRoot, 'architecture'), { recursive: true });
  writeAtomic(path.join(treeRoot, 'architecture', 'milestones.json'), {
    schema_version: 1,
    milestones: [
      {
        id: 'M1',
        order: 1,
        title: 'The first slice',
        designer_family: 'gpt',
        toolchain_profile: 'node-cli',
        slice_goal: 'Ship M1.',
        chunk_count_estimate: chunks.length,
        criteria_ids: ['ACR-1'],
      },
    ],
  });
  writeAtomic(path.join(treeRoot, 'state.json'), { phase: 'implementation', phase_status: {} });
  // The routing table a scaffolded tree carries. Which family reviews is read
  // out of this config by code, so the fixture ships the real one rather than
  // an idea of it — the reviewer seat this walk selects is the seat the
  // shipped config actually names.
  fs.cpSync(path.join(__dirname, '..', 'routing'), path.join(treeRoot, 'routing'), { recursive: true });

  // Everything the NEXT phase's entry_requires names, so the phase-advance
  // rung is reachable and gets invoked for real. A harness that stops short of
  // a rung proves nothing about it — and that rung is where `ledger:undefined`
  // was waiting.
  for (const rel of [
    'settings.json',
    'handoff.md',
    'vision/vision.md',
    'vision/decisions.jsonl',
    'research/index.json',
    'research/scratchpad.jsonl',
    'research/summary.md',
    'architecture/plan.md',
    'architecture/criteria-register.json',
    'architecture/artifact-map.json',
    'architecture/manifest.json',
    'architecture/gate.json',
    'architecture/protocol-record.md',
  ]) {
    const file = path.join(treeRoot, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, rel.endsWith('.json') ? '{}\n' : rel.endsWith('.jsonl') ? '{}\n' : `# ${rel}\n`);
  }
  // The REAL criteria register, not a placeholder: it is the frozen 1:1 map the
  // catalog writer derives a criterion from and the only thing that makes a
  // nominated journey_id legitimate. A `{}` here would let any id through and
  // the acceptance would be proving nothing.
  writeAtomic(path.join(treeRoot, 'architecture', 'criteria-register.json'), {
    schema_version: 1,
    criteria: [
      { id: CRITERION, text: 'The operator can run the thing.', source_ref: 'vision/vision.md#1', journey_id: JOURNEY },
    ],
  });
  return { repoRoot, treeRoot, chunks, nominate };
}

// The seat stub: it writes what its prompt asked for, at the path its prompt
// named, and reports the shape the schema requires.
function makeSeat({ repoRoot, chunks, nominate = {} }, { verdicts = {}, reviewsSeen = {}, findings = {}, breaksSuite = false } = {}) {
  return async (prompt, opts) => {
    const targets = pathsIn(prompt);
    const seat = opts.agentType;

    if (/^kiln:implementer-/.test(seat)) {
      const [capsuleDir, resultPath] = targets;
      // Real work in the capsule: a tracked file changes, so the export is a
      // real patch and the staged diff is a real diff.
      // A revise prompt carries the review that asked for changes; the seat
      // answers THAT rather than editing again at random, and the assertion
      // downstream checks the remediation actually landed.
      const remediating = /REMEDIATION/.test(prompt);
      fs.appendFileSync(
        path.join(capsuleDir, 'README.md'),
        remediating ? `remediated: names chunk C1\n` : `built ${path.basename(resultPath)}\n`
      );
      // A chunk that breaks the project's suite, written where a chunk's work
      // actually goes: a TRACKED file inside the capsule. The project's own
      // working tree keeps the passing copy, which is the whole point — the
      // gate has to answer about the chunk, not about the tree it replaces.
      if (breaksSuite) {
        fs.writeFileSync(
          path.join(capsuleDir, 'test', 'smoke.test.js'),
          "const test = require('node:test');\nconst assert = require('node:assert');\ntest('smoke', () => assert.ok(false, 'this chunk broke the suite'));\n"
        );
      }
      // JIT journey authoring: the chunk whose plan entry nominated a journey
      // writes the script, inside the capsule, like any other work it does — so
      // it crosses as part of the reviewed patch and exists in the sealed tree.
      const chunkId = /chunk (\S+) of milestone/.exec(prompt);
      const nomination = chunkId === null ? undefined : nominate[chunkId[1]];
      if (nomination !== undefined) {
        const script = path.join(capsuleDir, nomination.script_path);
        fs.mkdirSync(path.dirname(script), { recursive: true });
        fs.writeFileSync(
          script,
          "const test = require('node:test');\nconst assert = require('node:assert');\ntest('the operator can run the thing', () => assert.ok(true));\n"
        );
        execFileSync('git', ['add', nomination.script_path], { cwd: capsuleDir });
      }
      fs.mkdirSync(path.dirname(resultPath), { recursive: true });
      fs.writeFileSync(resultPath, 'implemented the chunk\n');
      // The Sol-hosting seat reports the session identity of the run it hosted;
      // the native Opus seat has none to report. This is the seat saying what
      // it did, which is the only evidence a hosted run can produce.
      return seat === 'kiln:implementer-sol'
        ? {
            wrote: true,
            model_id: 'gpt-5.6-sol',
            summary: 'built it',
            hosted_session: '019fc563-021f-7f10-a8c4-99f7d44f25e0',
          }
        : { wrote: true, model_id: 'opus-5', summary: 'built it' };
    }

    if (seat === 'kiln:milestone-designer' && targets.length === 2) {
      const [specPath, planPath] = targets;
      fs.mkdirSync(path.dirname(specPath), { recursive: true });
      fs.writeFileSync(specPath, '# M1\n\nThe slice.\n');
      // The plan is the machine-facing half of the decomposition, and a journey
      // nomination lives here for the same reason the chunk list does: prose
      // cannot be asked which journey a chunk closes.
      writeJson(planPath, {
        schema_version: 1,
        chunks: chunks.map((id) => ({
          id,
          title: `Chunk ${id}`,
          ...(nominate[id] === undefined ? {} : { journey: nominate[id] }),
        })),
      });
      return { wrote: true, model_id: 'opus-5', summary: 'decomposed the milestone' };
    }

    const [target] = targets;
    if (seat === 'kiln:milestone-designer' && /consults?[/\\]/.test(target)) {
      writeJson(target, {
        consult_id: path.basename(target, '.json'),
        asker: 'implementer',
        question: 'which boundary owns the retry?',
        verdict: 'the caller owns the retry',
        anchor: 'spec.md:42',
      });
      return { wrote: true, model_id: 'opus-5', summary: 'answered the consult' };
    }
    if (seat === 'kiln:milestone-designer') {
      writeJson(target, {
        outcome: 'build the chunk',
        scope: 'the chunk',
        anchors: ['spec.md:1'],
        acceptance: 'the suite is green',
        freshness: '2026-08-03',
        tier: 'standard',
        return_format: 'the six-field envelope',
        stop_condition: 'review approves',
      });
      return { wrote: true, model_id: 'opus-5', summary: 'wrote the brief' };
    }

    // A reviewing seat. Which verdict it gives is fixture-controlled, keyed by
    // how many times this chunk has already been reviewed, so a revise round
    // can be driven.
    const chunkId = path.basename(target, '.json').replace(/-r\d+$/, '');
    const seen = reviewsSeen[chunkId] || 0;
    reviewsSeen[chunkId] = seen + 1;
    const verdict = (verdicts[chunkId] || [])[seen] || 'approve';
    if (verdict === 'revise') findings[chunkId] = 'the README line must name the chunk it came from';
    // TOLD, never re-derived. The old stub matched /sonnet/ against the seat
    // string exactly as the real selector derives family from routing — so an
    // invalid seat produced a valid family and the ladder walked green over a
    // binding that bound nothing.
    const told = /"family" set to "([a-z]+)"/.exec(prompt);
    assert.ok(told, `the review prompt must tell its seat which family it is: ${seat}`);
    const family = told[1];
    writeJson(target, {
      verdict,
      evidence: verdict === 'revise' ? findings[chunkId] : 'the finding was addressed: the line names its chunk',
      family,
    });
    return { wrote: true, model_id: 'sonnet-5', summary: `reviewed: ${verdict}` };
  };
}

// Drive invocations until the ladder reaches one of the transitions named, or
// the budget runs out. Returns every transition seen, in order.
async function driveTo(project, stopAt, { budget = 40, calls = [], seatOpts = {}, stopBefore = false, handsShape } = {}) {
  const stops = stopAt;
  const seat = makeSeat(project, seatOpts);
  const seen = [];
  for (let i = 0; i < budget; i++) {
    // Peek before invoking. The stop has to be decided BEFORE the invocation,
    // not after it: an invocation that resolves `phase-advance` performs it,
    // and leaving the phase is not what any of these walks are driving.
    const peek = nextTransition(project.treeRoot).transition;
    if (peek === 'phase-advance') return { seen, result: null };
    // `stopBefore` leaves the ladder standing AT the named rung. Executing it
    // first is what made every kill land on a rung nobody named.
    if (stopBefore && stops.includes(peek)) return { seen, result: null };
    const { result } = await invokeWorkflow(project.treeRoot, { seat, calls, handsShape });
    seen.push(result.transition);
    if (stops.includes(result.transition)) return { seen, result };
  }
  throw new Error(`the ladder did not reach ${stops.join('/')} in ${budget} invocations: ${seen.join(' -> ')}`);
}

// ---------- the runtime form ----------

test('the script is a workflow: it exports meta, executes at top level, and returns its result', async () => {
  const project = makeProject();
  const { result, meta } = await invokeWorkflow(project.treeRoot, { seat: makeSeat(project) });

  assert.equal(meta.name, 'implementation');
  assert.ok(Array.isArray(meta.phases) && meta.phases.length > 0);
  assert.ok(typeof meta.description === 'string' && meta.description !== '');
  // The value a top-level `return` produced — a script written as a module
  // with an uncalled `run()` would return nothing at all.
  assert.equal(result.transition, 'open-milestone');
  assert.equal(result.return, 'beat');
});

test('the script file itself carries no CommonJS module form', () => {
  const source = fs.readFileSync(SCRIPT_PATH, 'utf8');

  assert.equal(/module\.exports/.test(source), false);
  assert.equal(/\basync function run\s*\(/.test(source), false);
  assert.equal(/\brequire\s*\(/.test(source), false);
});

// Every step the script takes is bound to a seat definition, which is what
// carries that seat's tool fences into the run, and every step is schema-bound,
// which is what makes its reply structurally guaranteed rather than hoped for.
test('every agent step binds a plugin seat and a schema, and none of them runs on Haiku', async () => {
  const project = makeProject();
  const calls = [];
  await driveTo(project, ['close'], { calls });

  assert.ok(calls.length > 10, 'the walk must actually have taken steps');
  for (const { opts } of calls) {
    // EXISTENCE, not a prefix. `/^kiln:/` accepted the routing key
    // `kiln:chunk_review_of_claude_work`, which binds no agent — the assertion
    // proved a prefix and was read as proving a binding.
    assert.match(opts.agentType, /^kiln:/, `a step ran unbound: ${JSON.stringify(opts)}`);
    const seatFile = path.join(__dirname, '..', '..', 'agents', `${opts.agentType.slice('kiln:'.length)}.md`);
    assert.ok(fs.existsSync(seatFile), `${opts.agentType} is not an installed agent (${seatFile})`);
    assert.ok(opts.schema, `a step ran with no schema: ${opts.agentType}`);
    assert.notEqual(opts.model, 'haiku');
  }
  const source = fs.readFileSync(SCRIPT_PATH, 'utf8');
  assert.equal(/haiku/i.test(source), false);
});

// ---------- the machine command has one home ----------

// BURN-1 F6, the blocker that stopped the relight. This prompt used to write
// the machine command out itself — `node "${CLAUDE_PLUGIN_ROOT}/machine/src/
// workflow.js"` — and order it run verbatim. A dispatch prompt is composed at
// RUNTIME and nothing substitutes it, so that variable reached the seat's shell
// as the empty string it is: the lawful seats ran `node /machine/src/
// workflow.js`, got MODULE_NOT_FOUND, reported the refusal exactly as their own
// never-adjust law requires, and the script threw. The transport worked only
// for the seats that broke that law and substituted a literal path. The seat's
// BODY is a different case and is where the command belongs: `${CLAUDE_PLUGIN_
// ROOT}` is text-substituted into agent bodies at load, which is why
// `charter.md` records that it does NOT substitute inside `product/**/*.md`.
// Two homes for one command, and the broken one won because the prompt ordered
// it verbatim. So this asserts the prompt prescribes NO command at all.
test('the hands dispatch prescribes no command of its own, and sends the seat to the one its body carries', async () => {
  const project = makeProject();
  const calls = [];
  await invokeWorkflow(project.treeRoot, { seat: makeSeat(project), calls });

  const prompts = calls.filter((c) => c.opts.agentType === 'kiln:workflow-hands').map((c) => c.prompt);
  assert.ok(prompts.length > 3, `the invocation barely called the machine: ${prompts.length}`);

  for (const prompt of prompts) {
    // Asked of the prompt's own PROSE, never of the payload: the payload is
    // canonical data and may lawfully carry anything, including this fixture's
    // `node-cli` toolchain profile. A prescription assertion that read the
    // payload too would be asserting about the project, not about the prompt.
    const prose = proseOf(prompt);

    // The exact byte-shape that died live.
    assert.doesNotMatch(
      prose,
      /CLAUDE_PLUGIN_ROOT/,
      'the hands prompt names a variable that is empty in the seat\'s shell, and it orders the command run verbatim'
    );
    // Nor any other spelling of the command: a literal path written here would
    // be right on exactly one install, and the duplicate would be back.
    assert.doesNotMatch(prose, /workflow\.js/, 'the hands prompt prescribes the machine script itself');
    assert.doesNotMatch(prose, /\bnode\b/, 'the hands prompt prescribes a command of its own');
    // Where the command DOES come from, said in the prompt rather than left to
    // the seat to work out.
    assert.match(
      prose,
      /command is [^.]*\byour own seat definition\b/i,
      'the hands prompt never sends the seat to its own body for the command'
    );
    assert.match(
      prose,
      /take nothing about the command from this brief/i,
      'the hands prompt does not forbid taking the command from the brief, which is what the seat did when the two disagreed'
    );
    // The payload laws are payload laws and survive the deletion: what the
    // brief still supplies, and the properties that make it survivable.
    assert.match(
      prose,
      /payload line[^.]*\bVERBATIM\b/,
      'the hands prompt no longer demands the payload line verbatim'
    );
    assert.match(prose, /\bon one line\b/, 'the hands prompt no longer demands the payload on one line');
    // Bound inside its own sentence: `quoted heredoc` occurs twice in this
    // prompt, so a bare match would be satisfied from the other clause and
    // would bind neither. The scope stops at a colon as well as a period —
    // this sentence ends in one, and `[^.]*` alone walked straight past it
    // into the next paragraph's `quoted heredoc marker` and reported bound.
    assert.match(
      prose,
      /payload line[^.:]*\bquoted heredoc\b/i,
      'the hands prompt no longer says the payload goes into the command\'s quoted heredoc'
    );
    // And the payload is really there, in the markers the seat is told to copy
    // it between — the extraction the whole harness runs on.
    assert.equal(typeof payloadIn(prompt).op, 'string');

    // The rest of this prompt, bound the same way, because every clause of it
    // was independently deletable with the whole suite green before this test
    // existed. Each is asserted as the literal phrase it is, so a sub-clause
    // reworded out of it — "never reformat it", "never adjust an argument" —
    // breaks the match rather than hiding behind a surviving keyword.
    assert.match(prose, /Run exactly one Kiln machine operation/, 'the hands prompt no longer asks for exactly one operation');
    assert.match(
      prose,
      /Never rebuild that line, never reformat it, and never lift its values out into shell quotes/,
      'the hands prompt no longer forbids rebuilding, reformatting or unquoting the payload line'
    );
    assert.match(
      prose,
      /The command has no argument form; the block is the only way in/,
      'the hands prompt no longer says the block is the only way in, which is why there is no quoting decision to make'
    );
    assert.match(
      prose,
      /Report those two fields as they came out/,
      'the hands prompt no longer asks for `ok` and `result` as they came out'
    );
    assert.match(
      prose,
      /never retry, never adjust an argument, never summarise/,
      'the hands prompt no longer holds the seat to the never-adjust law — the law the live seats that made the transport work were breaking'
    );
  }
});

// ---------- the whole ladder, executed ----------

test('the workflow walks the ladder from an unopened milestone through to the close', async () => {
  const project = makeProject();
  const { seen } = await driveTo(project, ['close']);

  assert.deepEqual(seen, [
    'open-milestone',
    'toolchain-preflight',
    'spec',
    'next-chunk-brief',
    'dispatch-implementer',
    'record-built',
    'review',
    'chunk-gate',
    'seal',
    'post-seal',
    'milestone-review',
    'regression-floor',
    'close',
  ]);

  // Each rung's own durable evidence, on disk, after the run.
  const treeRoot = project.treeRoot;
  assert.ok(fs.existsSync(path.join(treeRoot, 'milestones', 'M1', 'spec.md')));
  assert.ok(fs.existsSync(path.join(treeRoot, 'milestones', 'M1', 'chunk-plan.json')));
  assert.ok(fs.existsSync(path.join(treeRoot, 'milestones', 'M1', 'briefs', 'C1.json')));
  assert.ok(fs.existsSync(path.join(treeRoot, 'milestones', 'M1', 'reviews', 'C1-r1.json')));
  assert.ok(fs.existsSync(path.join(treeRoot, 'milestones', 'M1', 'review.json')));

  const chunkRecords = readRecords(path.join(treeRoot, 'milestones', 'M1', 'chunks.jsonl')).records;
  assert.deepEqual(
    chunkRecords.filter((r) => r.chunk_id === 'C1').map((r) => r.kind),
    // `chunk-journeys` follows the green deliberately: it is the audit half of
    // the catalog write, which happens at post-seal because that is the first
    // moment the journey script is committed work anybody has trusted. It is a
    // side-channel record and does not move the lifecycle pointer.
    ['chunk-spec', 'chunk-start', 'chunk-built', 'chunk-review', 'chunk-green', 'chunk-journeys']
  );

  const index = JSON.parse(fs.readFileSync(path.join(treeRoot, 'milestones', 'index.json'), 'utf8'));
  assert.equal(index.milestones[0].status, 'green');
  // And the rung the harness used to stop before is INVOKED, not merely
  // resolved: this is where `ledger:undefined` was waiting, behind a phase
  // pointer that had already moved.
  assert.equal(nextTransition(treeRoot).transition, 'phase-advance');
  const advanced = await invokeWorkflow(treeRoot, { seat: makeSeat(project) });
  assert.equal(advanced.result.transition, 'phase-advance');
  assert.equal(advanced.result.return, 'phase_complete');
  assert.match(advanced.result.record_ref, /^ledger:\d+$/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(treeRoot, 'state.json'), 'utf8')).phase, 'verification');
});

// ---------- the hands report text, which is what the live seat did ----------

// The same ladder, with the hands reporting the way the live seat reported in
// BURN-1. Every field this script reads off a machine return — `.transition`,
// `.ref`, `.seq`, `.staged_path`, `.capsuleDir`, `.patch_digest` — is
// `undefined` against a string, so a walk that gets past the first rung at all
// is a walk whose boundary parsed. This is the class the first live fire died
// of, on its first invocation, bound here.
test('the ladder walks the same when the hands report their result as JSON text', async () => {
  const project = makeProject();
  const calls = [];
  const { seen, result } = await driveTo(project, ['close'], { calls, handsShape: stringifiedHands() });

  // VERIFY THE VERIFIER, off the replies the SCRIPT received rather than off a
  // counter the shaper keeps: every machine call in this walk came back as
  // text, and there were many of them. A walk that stringified nothing would
  // otherwise pass this test while proving the opposite of what it claims.
  const replies = handsRepliesIn(calls);
  assert.ok(replies.length > 30, `the walk barely called the machine: ${replies.length}`);
  for (const reply of replies) {
    assert.equal(typeof reply.result, 'string', 'a hands reply reached the script parsed, so this walk asks nothing');
  }
  assert.deepEqual(seen, [
    'open-milestone',
    'toolchain-preflight',
    'spec',
    'next-chunk-brief',
    'dispatch-implementer',
    'record-built',
    'review',
    'chunk-gate',
    'seal',
    'post-seal',
    'milestone-review',
    'regression-floor',
    'close',
  ]);
  // And the walk was real rather than a sequence of names: the artifacts a
  // stringified `staged_path` would have sent to `undefined` are on disk, the
  // milestone actually closed, and the invocation's own return cites a record —
  // which is the `.ref` read off a machine return, one boundary further on.
  const treeRoot = project.treeRoot;
  assert.ok(fs.existsSync(path.join(treeRoot, 'milestones', 'M1', 'briefs', 'C1.json')));
  assert.ok(fs.existsSync(path.join(treeRoot, 'milestones', 'M1', 'reviews', 'C1-r1.json')));
  assert.equal(readJson(path.join(treeRoot, 'milestones', 'index.json'), null).milestones[0].status, 'green');
  assert.match(
    result.record_ref,
    /^envelope:implementation\/close\.M1$/,
    'the closing return cites no record, so a `.ref` read off a machine return came back undefined'
  );
});

// The other half of the boundary: text that is not a result at all. Handed on
// unparsed it becomes a silent `undefined` at whichever field is read next, and
// the failure then surfaces blaming something that was correct — the first live
// fire blamed its resolver for an answer the resolver had given right. So it is
// refused at the call that produced it, naming the op.
test("a hands reply that is text but not the operation's result is refused, naming the op", async () => {
  const project = makeProject();

  await assert.rejects(
    invokeWorkflow(project.treeRoot, {
      seat: makeSeat(project),
      handsShape: (reply, op) =>
        op === 'spine.nextTransition' ? { ok: true, result: 'the operation ran fine' } : reply,
    }),
    (err) => {
      assert.match(err.message, /spine\.nextTransition/, 'the refusal must name the op whose reply it could not read');
      assert.match(err.message, /the operation ran fine/, 'the refusal must carry the text it could not read');
      // Not the downstream symptom: a boundary that passes the string on
      // reaches `perform` and blames the resolver for a resolution it made
      // correctly.
      assert.doesNotMatch(err.message, /resolver named/);
      return true;
    }
  );
});

// The return contract, checked over the whole walk rather than at one rung:
// every invocation records a workflow-return, and every one of those cites a
// ref that actually resolves. Path fragments outside the receipt grammar were
// the defect, and `writeWorkflowReturn` refuses them — so a run that completes
// at all is a run whose refs are real.
test('every invocation leaves a workflow-return citing a resolvable record', async () => {
  const project = makeProject();
  const { seen } = await driveTo(project, ['close']);

  const ledger = readRecords(path.join(project.treeRoot, 'ledger.jsonl')).records;
  const returns = ledger.filter((r) => r.kind === 'workflow-return');
  assert.equal(returns.length, seen.length);
  for (const record of returns) {
    assert.equal(record.workflow, 'implementation');
    assert.ok(record.record_ref, `a return cited nothing: ${record.run_ref}`);
  }
  // The run identities are distinct: a deterministic identity built from the
  // transition and the milestone alone collides the moment the same milestone
  // stops twice for different reasons.
  assert.equal(new Set(returns.map((r) => r.run_ref)).size, returns.length);
});

// ---------- kill and rerun ----------

// The property the whole design rests on: an invocation killed anywhere leaves
// a tree the next invocation can resume from. Driven at EVERY rung of the
// ladder, not at one chosen point — the harness runs the ladder up to rung N,
// abandons an invocation mid-transition, and then finishes the walk.
test('the ladder finishes after an invocation is killed at any rung', async () => {
  const rungs = [
    'open-milestone',
    'toolchain-preflight',
    'spec',
    'next-chunk-brief',
    'dispatch-implementer',
    'record-built',
    'review',
    'chunk-gate',
    'seal',
    'milestone-review',
    'regression-floor',
  ];

  for (const rung of rungs) {
    const project = makeProject();

    // WHICH WINDOWS THIS RUNG ACTUALLY HAS. Recorded from a real run of it, on
    // its own throwaway tree, so the matrix kills the windows the design has
    // rather than the ones it hopes for.
    const probe = makeProject();
    await driveTo(probe, [rung], { budget: 20, stopBefore: true });
    // PROVE THE OPTION WAS HONORED. An option passed but never read is
    // indistinguishable from an option obeyed — the destructuring silently
    // dropped `stopBefore` for a whole round and every kill landed on the rung
    // AFTER the one named. Only asserting the behavior it was supposed to
    // change can tell the two apart.
    assert.equal(
      nextTransition(probe.treeRoot).transition,
      rung,
      `stopBefore left the ladder past ${rung}, so this case would probe the wrong rung`
    );
    const opsSeen = [];
    await invokeWorkflow(probe.treeRoot, {
      seat: makeSeat(probe),
      onHands: async (prompt) => {
        const m = /"op":\s*"([^"]+)"/.exec(prompt);
        if (m) opsSeen.push(m[1]);
      },
    }).catch(() => {});
    const windows = ['dispatch.completeNative', 'implementation.sealChunk', 'views.regenerate'].filter((op) =>
      opsSeen.includes(op)
    );
    assert.ok(windows.length > 0, `${rung} reached none of the named windows: ${opsSeen.join(', ')}`);

    // Kill in each of them BY NAME, on its own tree, with its OWN counter. An
    // aggregated counter let `views.regenerate` — which runs at every
    // invocation start — satisfy the assertion while the window that mattered
    // never fired.
    for (const op of windows) {
      const victim = makeProject();
      await driveTo(victim, [rung], { budget: 20, stopBefore: true });
      assert.equal(
        nextTransition(victim.treeRoot).transition,
        rung,
        `stopBefore left the ladder past ${rung}, so this kill would hit the wrong rung`
      );
      let fired = 0;
      await invokeWorkflow(victim.treeRoot, {
        seat: makeSeat(victim),
        onHands: async (prompt) => {
          if (new RegExp(`"op":\\s*"${op.replace(/\./g, '\\.')}"`).test(prompt)) {
            fired += 1;
            throw new Error(`the session died just before ${op}`);
          }
        },
      }).catch(() => {});
      assert.equal(fired, 1, `killed at ${rung} before ${op}: the kill never fired, so this case proved nothing`);

      const { seen } = await driveTo(victim, ['close'], { budget: 40 });
      assert.ok(seen.length >= 0);
      const idx = JSON.parse(
        fs.readFileSync(path.join(victim.treeRoot, 'milestones', 'index.json'), 'utf8')
      );
      assert.equal(idx.milestones[0].status, 'green', `killed at ${rung} before ${op}: the milestone never closed`);
      const recs = readRecords(path.join(victim.treeRoot, 'milestones', 'M1', 'chunks.jsonl')).records.filter(
        (r) => r.chunk_id === 'C1'
      );
      assert.equal(recs.filter((r) => r.kind === 'chunk-green').length, 1, `${rung}/${op}: sealed more than once`);
      assert.equal(recs.filter((r) => r.kind === 'chunk-start').length, 1, `${rung}/${op}: started more than once`);
    }

  }
});

// ---------- the revise loop, executed ----------

// A revise cannot write another `chunk-start`, so the round-trip only works if
// the attempt itself is the evidence. Driven through the runtime rather than
// asserted on the resolver: a revising review, another implementer attempt, a
// second review, then the seal.
test('a revising review sends the chunk back and the second attempt reaches the seal', async () => {
  const project = makeProject();
  const calls = [];
  const { seen } = await driveTo(project, ['close'], {
    budget: 40,
    calls,
    seatOpts: { verdicts: { C1: ['revise', 'approve'] } },
  });

  assert.deepEqual(seen.slice(0, 9), [
    'open-milestone',
    'toolchain-preflight',
    'spec',
    'next-chunk-brief',
    'dispatch-implementer',
    'record-built',
    'review',
    'revise',
    'review',
  ]);
  assert.equal(seen[seen.length - 1], 'close');

  const chunkRecords = readRecords(
    path.join(project.treeRoot, 'milestones', 'M1', 'chunks.jsonl')
  ).records.filter((r) => r.chunk_id === 'C1');
  assert.equal(chunkRecords.filter((r) => r.kind === 'chunk-review').length, 2);
  assert.equal(chunkRecords.filter((r) => r.kind === 'chunk-start').length, 1);

  // The revise was a REMEDIATION, not a second roll of the dice: the prompt
  // named the review that asked for changes, and the work that sealed is the
  // work that answered it.
  const revisePrompt = calls.find((c) => /REMEDIATION/.test(c.prompt));
  assert.ok(revisePrompt, 'the revise dispatch never told its implementer what was asked for');
  assert.match(revisePrompt.prompt, /reviews\/C1-r1\.json/, 'the revise prompt did not name the review it answers');
  assert.match(
    execFileSync('git', ['show', 'HEAD:README.md'], { cwd: project.repoRoot, encoding: 'utf8' }),
    /remediated: names chunk C1/,
    'the sealed work is not the work that answered the finding'
  );
});

// The revise dispatch once told its seat to CONTINUE the Codex session that
// built the work under review. A hosting seat's session identity is the only
// evidence its dispatch was gpt work, and one session answering two dispatch
// terminals attests the same id on both — so an attempt runs in a session of
// its own, and the dispatch carries what a resumed context would have held
// instead: the review to answer, the brief the chunk was built against, and the
// capsule that still holds the work.
test('a revise dispatch composes a session of its own rather than reopening the one under review', async () => {
  const project = makeProject();
  const calls = [];
  await driveTo(project, ['revise'], {
    budget: 40,
    calls,
    seatOpts: { verdicts: { C1: ['revise'] } },
  });

  const revisePrompt = calls.find((c) => /REMEDIATION/.test(c.prompt));
  assert.ok(revisePrompt, 'the revise dispatch never went out');

  // THE QUESTION HAS TO BE ASKABLE. The instruction this test refuses was
  // composed only when the attempt under review had attested a hosted session;
  // a fixture whose implementer never attested one would pass this test against
  // the very code it exists to refuse. Read off the ledger the derivation read.
  const priorSessions = readRecords(path.join(project.treeRoot, 'ledger.jsonl'))
    .records.filter(
      (r) =>
        r.kind === 'dispatch-terminal' &&
        typeof r.hosted_session === 'string' &&
        r.hosted_session.length > 0
    )
    .map((r) => r.hosted_session);
  assert.ok(
    priorSessions.length > 0,
    'the attempt under review attested no hosted session, so this fixture cannot pose the question'
  );

  // Naming the session is what a resume instruction cannot do without, so its
  // absence is the EFFECT the descriptor field was removed for — not the shape
  // of one sentence, which any rewording would slip past.
  for (const session of priorSessions) {
    assert.equal(
      revisePrompt.prompt.includes(session),
      false,
      `the revise prompt still names Codex session ${session}, which built the work under review`
    );
  }
  assert.doesNotMatch(
    revisePrompt.prompt,
    /resum|continue that session|rather than starting a new one/i,
    'the revise prompt still instructs the seat to carry on the session under review'
  );

  // ...and it says so positively, because a seat that is told nothing about
  // which session it is in will do whatever its habit is. Asserted on the
  // wording deliberately, the way `REMEDIATION` is: a rewrite that drops the
  // law should have to notice it dropped it.
  assert.match(
    revisePrompt.prompt,
    /session of its own/i,
    'the revise prompt does not tell the seat this attempt is a session of its own'
  );

  // ...and it carries what that session would have held.
  assert.match(
    revisePrompt.prompt,
    /milestones\/M1\/reviews\/C1-r1\.json/,
    'the revise prompt does not name the review it answers'
  );
  // Three of the assertions below — verdict-as-spec, findings verbatim, and the
  // capsule's state — bind one semantic each, and each binds it on something no
  // other part of this prompt can satisfy. `verdict` and `capsule` both occur in
  // unrelated clauses of the same string, so an assertion on the bare token stays
  // green while the clause it means is deleted; that is how this guard was first
  // written and it is why it is written this way now.
  assert.match(
    revisePrompt.prompt,
    /verdict is [^.]*\bspec\b/i,
    "the revise prompt does not tell the seat the review's verdict is this attempt's spec — that the verdict is mentioned somewhere is the enumeration clause's job, not this one"
  );
  assert.match(
    revisePrompt.prompt,
    /finding[^.;]*\b(?:word for word|verbatim)\b/i,
    "the revise prompt does not ask for the review's FINDINGS word for word — a summary of a finding is the seat's reading of it, which is the thing the review already refused, and asking for the verdict verbatim is not the same demand"
  );
  assert.match(
    revisePrompt.prompt,
    /milestones\/M1\/briefs\/C1\.json/,
    'the revise prompt does not name the brief the chunk was built against'
  );
  assert.match(
    revisePrompt.prompt,
    /brief in full/i,
    'the revise prompt names the brief but does not ask for it in full'
  );
  assert.match(
    revisePrompt.prompt,
    /put in front of you[^.]*\bcapsule\b/i,
    'the revise prompt does not carry the state of the capsule into what this attempt puts in front of itself — naming the capsule later as the place to work is a different claim, and it is the one that kept this assertion green'
  );
  assert.match(
    revisePrompt.prompt,
    /fresh session/i,
    'the revise prompt never tells a hosting seat what its fresh session\'s prompt is composed of, so the law reaches the seat file and not the dispatch'
  );
});

// The other half of the same law, one level down: the descriptor the resolver
// hands the script. A prompt cannot name a session the descriptor never
// carried, so this is where the derivation is held dead — and it is asserted
// against the SESSION ID rather than a field name, because a value re-added
// under any name is the same defect.
test('a revise descriptor carries the review to answer and not the session that built what it rejected', async () => {
  const project = makeProject();
  await driveTo(project, ['revise'], {
    budget: 40,
    stopBefore: true,
    seatOpts: { verdicts: { C1: ['revise'] } },
  });

  const next = nextTransition(project.treeRoot);
  assert.equal(next.transition, 'revise', 'the ladder is not standing at a revise');
  assert.match(next.review_ref, /reviews\/C1-r1\.json/, 'the revise descriptor does not name the review it answers');

  const priorSessions = readRecords(path.join(project.treeRoot, 'ledger.jsonl'))
    .records.filter(
      (r) =>
        r.kind === 'dispatch-terminal' &&
        typeof r.hosted_session === 'string' &&
        r.hosted_session.length > 0
    )
    .map((r) => r.hosted_session);
  assert.ok(
    priorSessions.length > 0,
    'the attempt under review attested no hosted session, so this fixture cannot pose the question'
  );

  const carried = JSON.stringify(next);
  for (const session of priorSessions) {
    assert.equal(
      carried.includes(session),
      false,
      `the revise descriptor still carries Codex session ${session}, which built the work under review`
    );
  }
});

// ---------- more than one chunk ----------

test('a milestone of several chunks builds them in the plan\'s order', async () => {
  const project = makeProject({ chunks: ['C1', 'C2'] });
  const { seen } = await driveTo(project, ['close'], { budget: 40 });

  assert.equal(seen.filter((t) => t === 'seal').length, 2);
  const chunkRecords = readRecords(path.join(project.treeRoot, 'milestones', 'M1', 'chunks.jsonl')).records;
  const greens = chunkRecords.filter((r) => r.kind === 'chunk-green').map((r) => r.chunk_id);
  assert.deepEqual(greens, ['C1', 'C2']);
});

// ---------- the journey catalog ----------

// THE CONSUMER IS THE JUDGE. `assembleSuite` is fail-closed on a malformed or
// incomplete catalog and it is what the verification phase actually calls, so
// the acceptance here is its own verdict over a real build's output — never a
// comparison against a hand-written expectation, which would only prove the
// writer agrees with whoever wrote the expectation.
test('a sealed build leaves a journeys catalog the real assembleSuite accepts', async () => {
  const project = makeProject();
  await driveTo(project, ['close']);

  const register = readJson(path.join(project.treeRoot, 'architecture', 'criteria-register.json'), null);
  const catalog = readJson(path.join(project.treeRoot, 'verification', 'journeys.json'), null);
  const assembled = assembleSuite(project.treeRoot, register, catalog);

  assert.deepEqual(assembled.errors, [], 'the catalog a real build produced does not assemble');
  assert.equal(assembled.ok, true);
  assert.deepEqual(assembled.journeys, [
    {
      journey_id: JOURNEY,
      criterion_id: CRITERION,
      script_path: JOURNEY_SCRIPT,
      harness: 'node-test',
      added_in_milestone: 'M1',
    },
  ]);
  // The script the entry names is really there, in the commit the seal made.
  assert.match(
    execFileSync('git', ['show', `HEAD:${JOURNEY_SCRIPT}`], { cwd: project.repoRoot, encoding: 'utf8' }),
    /the operator can run the thing/
  );
});

test('the catalog is byte-stable when the same seal is driven again', async () => {
  const project = makeProject();
  await driveTo(project, ['close']);
  const catalogPath = path.join(project.treeRoot, 'verification', 'journeys.json');
  const before = fs.readFileSync(catalogPath);
  const stat = fs.statSync(catalogPath);

  // The post-seal rung is owed again whenever its envelope is absent, which is
  // exactly the state a crash between the two leaves — so removing it is not a
  // contrivance, it is the re-entry the ladder is built for.
  fs.rmSync(path.join(project.treeRoot, 'envelopes', 'implementation', 'postseal.M1.C1.json'));
  await invokeWorkflow(project.treeRoot, { seat: makeSeat(project) });

  assert.deepEqual(fs.readFileSync(catalogPath), before, 'the replay rewrote the catalog');
  const after = fs.statSync(catalogPath);
  assert.equal(after.ino, stat.ino, 'the replay replaced the catalog file');
  assert.equal(after.mtimeMs, stat.mtimeMs, 'the replay rewrote the catalog with identical bytes');
});

// THE NOMINATION BELONGS TO A NAMED CHUNK, and the case that proves it is one
// where the wrong answer is a DIFFERENT answer: the nomination sits on the
// SECOND chunk, so a resolver reading "the plan's journey" rather than "this
// chunk's journey" catalogues nothing at all — and with the nomination on the
// first chunk, as every other fixture here has it, that mistake is invisible.
test("a nomination is read off the chunk that carries it, not the first one in the plan", async () => {
  const project = makeProject({
    chunks: ['C1', 'C2'],
    nominate: { C2: { journey_id: JOURNEY, script_path: JOURNEY_SCRIPT, harness: 'node-test' } },
  });
  await driveTo(project, ['close'], { budget: 40 });

  const catalog = readJson(path.join(project.treeRoot, 'verification', 'journeys.json'), null);
  assert.deepEqual(
    catalog.journeys.map((entry) => entry.journey_id),
    [JOURNEY],
    'the journey the second chunk nominated never reached the catalog'
  );
  const records = readRecords(path.join(project.treeRoot, 'milestones', 'M1', 'chunks.jsonl')).records;
  assert.deepEqual(
    records.filter((r) => r.kind === 'chunk-journeys').map((r) => r.chunk_id),
    ['C2'],
    'the audit record was filed against the wrong chunk'
  );
});

test('a chunk that nominates no journey leaves the catalog alone', async () => {
  // Two chunks, one nomination: the catalog must be untouched by the second,
  // and a fixture with no nomination at all could not tell "left alone" from
  // "never written".
  const project = makeProject({ chunks: ['C1', 'C2'] });
  const catalogPath = path.join(project.treeRoot, 'verification', 'journeys.json');
  await driveTo(project, ['seal'], { budget: 40 });
  // C1 is sealed and its journey is catalogued; C2 has not been built yet.
  await driveTo(project, ['post-seal'], { budget: 40 });
  const afterFirst = fs.readFileSync(catalogPath);
  const statFirst = fs.statSync(catalogPath);
  assert.equal(JSON.parse(afterFirst).journeys.length, 1);

  await driveTo(project, ['close'], { budget: 40 });

  assert.deepEqual(fs.readFileSync(catalogPath), afterFirst, 'the un-nominated chunk wrote to the catalog');
  const statLast = fs.statSync(catalogPath);
  assert.equal(statLast.ino, statFirst.ino);
  assert.equal(statLast.mtimeMs, statFirst.mtimeMs);
});

// ---------- the gate evidences the chunk ----------

// THE DEFECT THIS SECTION EXISTS FOR. A chunk's approved work lives in the
// INDEX until the seal commits it — `applyToStaging` writes the index and
// never the working tree, on purpose — so a gate run in the project's own
// working directory answers about the tree the chunk REPLACES. It passed a
// chunk that breaks the suite, and the ledger recorded that pass under the
// chunk's own gate id.
test("the chunk gate fails when the chunk's own staged work breaks the suite", async () => {
  const project = makeProject();
  const { result } = await driveTo(project, ['chunk-gate'], { seatOpts: { breaksSuite: true } });

  assert.equal(result.transition, 'chunk-gate');
  const gate = gateRecord(project.treeRoot, 'chunk:M1:C1');
  assert.ok(gate, 'the gate rung left no record');
  assert.notEqual(
    gate.exit_code,
    0,
    "the gate passed a chunk whose own suite is red — it ran against the tree the chunk replaces, not the chunk"
  );

  // The project's own working tree still holds the passing copy, which is
  // exactly why the old gate came back green: it was never asked about the
  // chunk at all.
  assert.match(
    fs.readFileSync(path.join(project.repoRoot, 'test', 'smoke.test.js'), 'utf8'),
    /assert\.ok\(true\)/,
    'the fixture staged its break into the working tree, so this case proves nothing about where the gate ran'
  );

  // And the ladder stops on it rather than sealing.
  const next = nextTransition(project.treeRoot);
  assert.equal(next.transition, 'blocked');
  assert.match(next.reason, /does not pass its own suite/);
});

// A gate record that does not say which tree it ran against is a claim nobody
// can check later. The tree it names is the STAGED one — the chunk's — and it
// is not HEAD's, because the chunk is not committed yet.
test('the gate record names the tree it ran against, and that tree is the chunk\'s', async () => {
  const project = makeProject();
  await driveTo(project, ['chunk-gate']);

  const gate = gateRecord(project.treeRoot, 'chunk:M1:C1');
  assert.equal(gate.exit_code, 0);
  assert.match(gate.tree, /^[0-9a-f]{40}$/, 'the gate record states no tree');
  assert.equal(gate.tree, stagedTreeOf(project.repoRoot), 'the gate did not run against the staged tree');
  assert.notEqual(
    gate.tree,
    execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: project.repoRoot, encoding: 'utf8' }).trim(),
    'the staged tree equals HEAD, so this case cannot tell the two apart'
  );
});

// The gate is evidence, not a mutation. Content equality alone cannot see a
// rewrite that produced identical bytes, so inode and mtime travel with it.
test("the gate leaves the project's own working tree and index untouched", async () => {
  const project = makeProject();
  await driveTo(project, ['chunk-gate'], { stopBefore: true });
  assert.equal(
    nextTransition(project.treeRoot).transition,
    'chunk-gate',
    'the ladder is not standing at the gate, so this case watches the wrong invocation'
  );

  const watched = ['.git/index', 'README.md', 'test/smoke.test.js', '.gitignore'];
  const snapshot = () =>
    watched.map((rel) => {
      const file = path.join(project.repoRoot, rel);
      const stat = fs.statSync(file);
      const digest = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
      return `${rel} ino=${stat.ino} mtime=${stat.mtimeMs} ${digest}`;
    });

  const before = snapshot();
  const { result } = await invokeWorkflow(project.treeRoot, { seat: makeSeat(project) });

  assert.equal(result.transition, 'chunk-gate');
  assert.equal(gateRecord(project.treeRoot, 'chunk:M1:C1').exit_code, 0, 'no gate ran, so nothing was proven unchanged');
  assert.deepEqual(snapshot(), before);
});

// ---------- a stop is durable too ----------

test('a blocked resolution raises a hold and returns it, rather than a path fragment', async () => {
  const project = makeProject();
  // An architecture naming no milestone at all: nothing to build, and no gate
  // record to cite as the reason.
  writeAtomic(path.join(project.treeRoot, 'architecture', 'milestones.json'), {
    schema_version: 1,
    milestones: [],
  });

  const { result } = await invokeWorkflow(project.treeRoot, { seat: makeSeat(project) });

  assert.equal(result.return, 'blocked');
  assert.match(result.record_ref, /^ledger:\d+$/);
  const ledger = readRecords(path.join(project.treeRoot, 'ledger.jsonl')).records;
  const hold = ledger.find((r) => r.kind === 'hold-open');
  assert.ok(hold, 'a stop with no record of its own must raise one');
  assert.match(hold.summary, /no milestones/);
});

// ---------- no lawful reviewer, through the runtime ----------

// The declared stop, end to end: a claude-built chunk in a tree where no gpt
// model is reachable has no lawful reviewer, and the invocation that meets it
// writes exactly one degraded-route record and returns `blocked` citing it.
// A relaunch resolves the same stop and writes nothing further — the record's
// identity is the route, so the second write is the first one's receipt.
test('a chunk with no reachable cross-family reviewer stops, records the route once, and cites it', async () => {
  const project = makeProject();
  // A milestone the claude family builds: its lawful reviewer is the gpt one.
  const arch = readJson(path.join(project.treeRoot, 'architecture', 'milestones.json'));
  arch.milestones[0].designer_family = 'claude';
  writeAtomic(path.join(project.treeRoot, 'architecture', 'milestones.json'), arch);

  await driveTo(project, ['record-built']);

  // Only now is the family unreachable — the build already happened.
  const state = readJson(path.join(project.treeRoot, 'state.json'));
  state.preflight = { mode: 'degraded-claude-only' };
  writeAtomic(path.join(project.treeRoot, 'state.json'), state);

  const seat = makeSeat(project);
  const { result } = await invokeWorkflow(project.treeRoot, { seat });

  assert.equal(result.return, 'blocked');
  assert.match(result.record_ref, /^ledger:\d+$/);

  const routesAfterFirst = readRecords(path.join(project.treeRoot, 'ledger.jsonl')).records.filter(
    (r) => r.kind === 'degraded-route'
  );
  assert.equal(routesAfterFirst.length, 1, 'exactly one degraded-route record describes this stop');
  assert.equal(routesAfterFirst[0].expected, 'gpt');
  assert.equal(routesAfterFirst[0].actual, 'none');
  assert.equal(result.record_ref, `ledger:${routesAfterFirst[0].seq}`, 'the return cites that record');

  // No reviewer was dispatched: the stop happens before a seat is paid for.
  // Scoped by the REVIEW rung's own prompt_ref — the spec and brief steps are
  // dispatches of the same task class, and counting the class would count them.
  const reviewDispatches = readRecords(path.join(project.treeRoot, 'ledger.jsonl')).records.filter(
    (r) => r.kind === 'dispatch' && String(r.prompt_ref).startsWith('implementation/review/')
  );
  assert.equal(reviewDispatches.length, 0);

  const { result: again } = await invokeWorkflow(project.treeRoot, { seat });

  assert.equal(again.return, 'blocked');
  assert.equal(again.record_ref, result.record_ref);
  assert.equal(
    readRecords(path.join(project.treeRoot, 'ledger.jsonl')).records.filter((r) => r.kind === 'degraded-route').length,
    1,
    'a relaunch reuses the record rather than adding a second one'
  );
});

// ---------- steering, through the runtime ----------

// The steer seam was modelled correctly and wired to nothing: the transition
// had no case in the script and its writer was not in the facade's op table,
// so a steer landing mid-build stopped the phase dead. Driven here end to end.
test('a steer landing mid-build is answered, and the ladder resumes where it left off', async () => {
  const project = makeProject();
  const seat = makeSeat(project);
  await driveTo(project, ['next-chunk-brief']);

  // Raised the way the operator raises one — NOT through the facade, which
  // deliberately carries no steer-raise op: a workflow that could raise its own
  // steer could manufacture its own instructions.
  writeSteerRaise(project.treeRoot, {
    steer_id: 'S1',
    scope: 'milestones/M1',
    instruction: 'do the smaller chunk first',
    origin: 'operator',
  });

  const steered = await invokeWorkflow(project.treeRoot, { seat });
  assert.equal(steered.result.transition, 'apply-steer');
  assert.equal(steered.result.return, 'beat');

  // Answered once and only once: the pair is on the ledger, and the next
  // invocation is back on the ladder rather than on the steer again.
  const ledger = readRecords(path.join(project.treeRoot, 'ledger.jsonl')).records;
  assert.equal(ledger.filter((r) => r.kind === 'steer-apply').length, 1);
  assert.equal(ledger.find((r) => r.kind === 'steer-apply').exit, 'applied');
  assert.equal(nextTransition(project.treeRoot).transition, 'dispatch-implementer');
});

test('a steer aimed at a milestone this phase is not building goes to the operator', async () => {
  const project = makeProject();
  const seat = makeSeat(project);
  await driveTo(project, ['next-chunk-brief']);

  writeSteerRaise(project.treeRoot, {
    steer_id: 'S2',
    scope: 'milestones/M9',
    instruction: 'rework the slice after this one',
    origin: 'operator',
  });

  const { result } = await invokeWorkflow(project.treeRoot, { seat });

  assert.equal(result.transition, 'apply-steer');
  assert.equal(result.return, 'operator_needed');
  const ledger = readRecords(path.join(project.treeRoot, 'ledger.jsonl')).records;
  assert.equal(ledger.find((r) => r.kind === 'steer-apply').exit, 'operator');
});

// ---------- consults, through the runtime ----------

// The consult seam was absent altogether: no transition, no durable request
// state, no promotion class, no anchored-answer step, no `needs_consult`
// return. All five exist now, and this drives them.
test('an unanswered consult pre-empts the ladder, is answered into the tree, and stops pre-empting', async () => {
  const project = makeProject();
  const seat = makeSeat(project);
  await driveTo(project, ['next-chunk-brief']);
  const before = nextTransition(project.treeRoot).transition;

  const request = path.join(project.treeRoot, 'staging', 'consult-request', 'M1', 'Q1.json');
  writeJson(request, {
    consult_id: 'Q1',
    chunk_id: 'C1',
    asker: 'implementer',
    question: 'which boundary owns the retry?',
  });

  const { result } = await invokeWorkflow(project.treeRoot, { seat });
  assert.equal(result.transition, 'consult');
  assert.equal(result.return, 'needs_consult');

  // The answer is canonical, carries its anchor, and the ladder resumes.
  const answered = path.join(project.treeRoot, 'milestones', 'M1', 'consults', 'Q1.json');
  assert.ok(fs.existsSync(answered), 'the consult answer was never promoted');
  const answer = JSON.parse(fs.readFileSync(answered, 'utf8'));
  assert.equal(answer.consult_id, 'Q1');
  assert.ok(answer.anchor, 'a consult answer with no anchor is an opinion');
  assert.equal(nextTransition(project.treeRoot).transition, before);
});
