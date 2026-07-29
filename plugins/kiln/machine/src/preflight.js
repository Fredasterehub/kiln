'use strict';

// Onboarding preflight (product/onboarding/preflight.md is LAW for this
// module's check semantics — every comment below cites that document's own
// section, not a paraphrase of it). Runs immediately after
// scaffold.scaffoldTree() has created the tree and before the settings
// interview's first AskUserQuestion call (preflight.md "Ordering"). The five
// checks execute in preflight.md's own document order: node present, codex
// present+responsive, the Workflow tool, agent teams, git present+repo
// state. Three are real subprocess checks via check-honesty.js's runGate —
// the sole sanctioned producer of gate evidence (machine/src/check-honesty.js
// :329-356) — writing kind:"gate" records straight into state.json's
// top-level gates[] (the same array shape every later phase gate lands in,
// so a later check-honesty run audits onboarding's own preflight
// exactly the way it audits every later phase gate). The other two are
// session-introspection facts: there is no shell command that answers "is
// Workflow in this session's tool list" — only the running session that
// invokes this script knows that, so --workflow-tool/--agent-teams are
// REQUIRED flags and this module fails closed (throws before touching disk)
// rather than guessing when either is missing.

const path = require('node:path');

const { readJson, updateJson } = require('./atomic-json.js');
const { appendRecord } = require('./stream.js');
const { runGate } = require('./check-honesty.js');

const TREE_NAME = '.kiln';
const MISSING_STATE = Symbol('preflight.missing-state');

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value !== '';
}

// P11 convergence parked question (b) AMEND: downstream routing stays
// binary (opts.workflowTool/opts.agentTeams, unchanged above), but the
// FACT of how that boolean was arrived at is preserved separately —
// "unknown" (an introspection source that could not be resolved) is not
// the same recorded fact as a measured "absent", even though both route
// identically (degraded). observed is OPTIONAL (defaults to the routing
// boolean's own present/absent reading when the caller has nothing more to
// say); when supplied, it must be one of exactly these three values, and an
// "unknown" observation may only accompany a routing value of false — a
// caller cannot claim "unknown" while still routing as though the
// capability were confirmed present.
const OBSERVED_VALUES = new Set(['present', 'absent', 'unknown']);

function resolveObserved(explicit, routingBoolean, flagName) {
  if (explicit === undefined) {
    return routingBoolean ? 'present' : 'absent';
  }
  if (!OBSERVED_VALUES.has(explicit)) {
    throw new TypeError(`preflight: ${flagName} must be one of present, absent, unknown (got ${JSON.stringify(explicit)})`);
  }
  if (explicit === 'unknown' && routingBoolean !== false) {
    throw new Error(
      `preflight: ${flagName} "unknown" must route as degraded — the matching present/absent routing value must be false`
    );
  }
  return explicit;
}

// preflight.md check 2's exact pipeline — the same base command the dev
// record froze as "codex-preflight" at project kickoff,
// with the exact-match `grep -qx codex-ok` addition preflight.md documents
// (P3 Sol review finding 9) so the gate's own exit code IS the semantic
// check, closing the "a false semantic pass written into state is
// indistinguishable from a real one" hole — nothing left for a second,
// script-side comparison to get wrong. Overridable ONLY via --codex-cmd, a
// documented test seam; preflight.md sanctions no other override path.
const DEFAULT_CODEX_CMD =
  'timeout 30 codex exec -m gpt-5.6-sol -c \'model_reasoning_effort="low"\' -s read-only --skip-git-repo-check --ephemeral "Reply with exactly: codex-ok" 2>/dev/null | tail -1 | grep -qx codex-ok';

// preflight.md check 2's exact degraded-mode sentence, stored
// into state.json.preflight.notice VERBATIM — never paraphrased. The
// sentence itself, word for word, is the operator-facing contract this
// module owes; reworking it here would silently break preflight.md's own
// "report to the operator" law.
const DEGRADED_NOTICE =
  "GPT-5.6-Sol isn't reachable right now, so this build runs in degraded Claude-only mode: Opus 5, Sonnet 5, and Fable 5 check each other's work instead of a second model family doing it. The build still completes end to end — every seat gets a same-family substitute — but single-family mode loses cross-family error decorrelation: the benefit of two different model families being wrong in different, uncorrelated ways is gone until Codex is reachable again.";

// run(projectRoot, opts) — the sole entry point, mirroring the CLI's own
// `run <projectRoot>` command 1:1. opts.workflowTool/opts.agentTeams are
// REQUIRED booleans (fail closed, checked before any read/write below);
// opts.codexCmd is the documented --codex-cmd test seam (defaults to
// preflight.md's own DEFAULT_CODEX_CMD).
function run(projectRoot, opts = {}) {
  if (!isNonEmptyString(projectRoot)) {
    throw new TypeError('preflight: projectRoot must be a non-empty string');
  }
  if (opts.workflowTool !== true && opts.workflowTool !== false) {
    throw new TypeError(
      'preflight: opts.workflowTool must be a boolean — only the calling session knows its own toolset, so this fact is required, never inferred'
    );
  }
  if (opts.agentTeams !== true && opts.agentTeams !== false) {
    throw new TypeError(
      'preflight: opts.agentTeams must be a boolean — only the calling session knows its own toolset, so this fact is required, never inferred'
    );
  }
  const workflowObserved = resolveObserved(opts.workflowToolObserved, opts.workflowTool, 'opts.workflowToolObserved');
  const agentTeamsObserved = resolveObserved(opts.agentTeamsObserved, opts.agentTeams, 'opts.agentTeamsObserved');

  const treeRoot = path.join(projectRoot, TREE_NAME);
  const statePath = path.join(treeRoot, 'state.json');
  const ledgerPath = path.join(treeRoot, 'ledger.jsonl');

  // Fail fast, before running any of the five subprocess/introspection
  // checks below, on a tree that was never scaffolded — this read is
  // advisory only (a cheap precondition check); the state.json read that
  // actually decides what gets WRITTEN happens fresh, inside updateJson's
  // own lock, at the bottom of this function (P11 convergence finding 21 —
  // a stale pre-lock read must never be what a concurrent writer's update
  // gets built on top of).
  const precheckState = readJson(statePath, MISSING_STATE);
  if (precheckState === MISSING_STATE) {
    throw new Error(`preflight: no state.json found at ${statePath} — scaffold the tree first`);
  }
  if (!isPlainObject(precheckState)) {
    throw new Error(`preflight: state at ${statePath} must be a JSON object`);
  }

  // "append", per preflight.md's own State field on every one of the five
  // checks — never overwritten/deduped by gate name, so a re-run of
  // preflight (e.g. a resumed session re-confirming its toolset) leaves the
  // prior run's evidence on the record rather than erasing it. Collected
  // here as THIS run's own fresh entries only; merged against whatever
  // state.gates[] is actually on disk inside the updateJson lock below,
  // never against the precheck read above.
  const freshGates = [];

  // Check 1: node present (preflight.md #1). Pass criterion is
  // exitCode===0, driven by the REAL exit code runGate returns — never
  // hardcoded to 'pass' (preflight.md's own P3 review citation: a script
  // that always wrote 'pass' here would make "none possible in practice"
  // unfalsifiable rather than merely rare).
  const nodeCmd = 'node --version';
  const nodeResult = runGate({ gateId: 'preflight-node', cmd: nodeCmd, ledgerPath });
  freshGates.push({ name: 'preflight-node', cmd: nodeCmd, last_result: nodeResult.exitCode === 0 ? 'pass' : 'fail' });

  // Check 2: codex present + responsive (preflight.md #2). mode/notice are
  // decided here, off the gate's own real exit code — nothing else.
  const codexCmd = isNonEmptyString(opts.codexCmd) ? opts.codexCmd : DEFAULT_CODEX_CMD;
  const codexResult = runGate({ gateId: 'codex-preflight', cmd: codexCmd, ledgerPath });
  const codexOk = codexResult.exitCode === 0;
  freshGates.push({ name: 'codex-preflight', cmd: codexCmd, last_result: codexOk ? 'pass' : 'fail' });
  const mode = codexOk ? 'full-cross-family' : 'degraded-claude-only';
  const notice = codexOk ? null : DEGRADED_NOTICE;
  if (!codexOk) {
    // The mode decision itself is a fact worth its own ledger line, distinct
    // from the raw gate's exit code (preflight.md #2's own ledger-evidence
    // note).
    appendRecord(ledgerPath, {
      kind: 'preflight',
      payload: { check: 'codex-responsive', ok: false, mode: 'degraded-claude-only' },
      correlation_id: 'codex-preflight',
    });
  }

  // Check 3: the Workflow tool — session-introspection, not a subprocess
  // (preflight.md #3). Recorded as a kind:"preflight" ledger record, never
  // gates[] — gates[] is reserved for checks with a real subprocess exit
  // code behind them (preflight.md §"The check-honesty gate pattern").
  appendRecord(ledgerPath, {
    kind: 'preflight',
    payload: { check: 'workflow-tool', present: opts.workflowTool, source: 'session-tool-list', observed: workflowObserved },
    correlation_id: 'workflow-tool',
  });

  // Check 4: agent teams — same shape as check 3 (preflight.md #4).
  appendRecord(ledgerPath, {
    kind: 'preflight',
    payload: { check: 'agent-teams', present: opts.agentTeams, source: 'session-tool-list', observed: agentTeamsObserved },
    correlation_id: 'agent-teams',
  });

  // Check 5: git present + repo state (preflight.md #5). "git absent" and
  // "present but not a repo" both surface as the same clean runGate failure
  // (spawnSync cannot start the process; runGate maps status===null to
  // exitCode 1) — advisory, non-blocking, a brand-new greenfield project
  // legitimately may not have a repo yet.
  const gitCmd = 'git rev-parse --is-inside-work-tree';
  const gitResult = runGate({ gateId: 'preflight-git', cmd: gitCmd, ledgerPath });
  const gitOk = gitResult.exitCode === 0;
  freshGates.push({ name: 'preflight-git', cmd: gitCmd, last_result: gitOk ? 'pass' : 'fail' });

  // Branch context is captured ONLY on pass, and never gets a gates[] entry
  // of its own — "what branch" has no pass/fail meaning (preflight.md #5's
  // own note); the runGate call below is still real ledger evidence that
  // the read actually happened.
  const repo = {};
  if (gitOk) {
    const branchResult = runGate({
      gateId: 'preflight-git-branch',
      cmd: 'git rev-parse --abbrev-ref HEAD',
      ledgerPath,
    });
    repo.branch = typeof branchResult.stdout === 'string' ? branchResult.stdout.trim() : '';
  }

  const capabilities = {
    workflow_tool: { present: opts.workflowTool, source: 'session-tool-list', observed: workflowObserved },
    agent_teams: { present: opts.agentTeams, source: 'session-tool-list', observed: agentTeamsObserved },
  };

  // Written once, after all five checks resolve (preflight.md "The
  // state.json.preflight block"), through atomic-json.js's updateJson (P11
  // convergence finding 21) — the read of state.gates[] to append onto and
  // the write of the merged result happen inside the SAME lock, so a
  // concurrent state.json writer (another preflight run, a phases.js
  // transition, a handoff.js stop) can never have its own update silently
  // overwritten by this one landing on a stale read.
  const preflightBlock = {
    ran_utc: new Date().toISOString(),
    mode,
    notice,
    capabilities,
    repo,
  };

  const newState = updateJson(statePath, MISSING_STATE, (state) => {
    if (state === MISSING_STATE) {
      throw new Error(`preflight: no state.json found at ${statePath} — scaffold the tree first`);
    }
    if (!isPlainObject(state)) {
      throw new Error(`preflight: state at ${statePath} must be a JSON object`);
    }
    const gates = Array.isArray(state.gates) ? [...state.gates, ...freshGates] : [...freshGates];
    return { ...state, gates, preflight: preflightBlock };
  });

  return { mode, gates: newState.gates, capabilities, repo };
}

function parsePresence(value, flagName) {
  if (value === 'present') return true;
  if (value === 'absent') return false;
  throw new Error(`${flagName} must be "present" or "absent" (got ${JSON.stringify(value)})`);
}

// parseArgv fails closed on any token outside its five recognized flags
// (P11 Sol review finding 11 / convergence parked question (b) STILL-OPEN):
// the loop previously had no rejection branch, so a misspelled
// `--workflow-tool-obesrved` silently fell through unconsumed, and `run`
// then defaulted that flag's own value to the routing boolean's own
// present/absent reading — recreating exactly the measured-absence/unknown
// collapse the amendment required this module to prevent. Every token past
// `<command> <projectRoot>` is now either one of the five known flags (with
// its value consumed) or an outright refusal — the same "every token
// accounted for" discipline validators.js's own parseArgv already applies
// to an unrecognized flag.
function parseArgv(argv) {
  const [command, projectRoot, ...rest] = argv;
  let workflowTool;
  let agentTeams;
  let codexCmd;
  let workflowToolObserved;
  let agentTeamsObserved;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--workflow-tool') {
      workflowTool = rest[i + 1];
      i++;
    } else if (arg === '--agent-teams') {
      agentTeams = rest[i + 1];
      i++;
    } else if (arg === '--codex-cmd') {
      codexCmd = rest[i + 1];
      i++;
    } else if (arg === '--workflow-tool-observed') {
      workflowToolObserved = rest[i + 1];
      i++;
    } else if (arg === '--agent-teams-observed') {
      agentTeamsObserved = rest[i + 1];
      i++;
    } else {
      return { command, projectRoot, error: `unrecognized argument "${arg}"` };
    }
  }
  return { command, projectRoot, workflowTool, agentTeams, codexCmd, workflowToolObserved, agentTeamsObserved, error: null };
}

// CLI entrypoint (this codebase's flat one-command convention — phases.js/
// delivery.js/scaffold.js all end in a `node <file> ...` shell-runnable
// form). Prints the {mode, gates, capabilities, repo} JSON on success; on
// failure — including either capability flag missing — prints the thrown
// message to stderr and exits 1, nothing here catches an error to keep
// going.
function main(argv) {
  const { command, projectRoot, workflowTool, agentTeams, codexCmd, workflowToolObserved, agentTeamsObserved, error } =
    parseArgv(argv);
  if (!command || !projectRoot || error) {
    if (error) process.stderr.write(`preflight.js: ${error}\n`);
    process.stderr.write(
      'usage: preflight.js run <projectRoot> --workflow-tool present|absent --agent-teams present|absent ' +
        '[--codex-cmd "<override>"] [--workflow-tool-observed present|absent|unknown] [--agent-teams-observed present|absent|unknown]\n'
    );
    process.exit(1);
    return;
  }
  try {
    if (command !== 'run') {
      throw new Error(`unknown command "${command}" (expected run)`);
    }
    const opts = {
      workflowTool: parsePresence(workflowTool, '--workflow-tool'),
      agentTeams: parsePresence(agentTeams, '--agent-teams'),
    };
    if (isNonEmptyString(codexCmd)) opts.codexCmd = codexCmd;
    if (workflowToolObserved !== undefined) opts.workflowToolObserved = workflowToolObserved;
    if (agentTeamsObserved !== undefined) opts.agentTeamsObserved = agentTeamsObserved;
    const result = run(projectRoot, opts);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    process.stderr.write(`preflight.js: ${err.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { run, DEFAULT_CODEX_CMD, DEGRADED_NOTICE, TREE_NAME };
