#!/usr/bin/env node
/**
 * Enforce Kiln Spawn Map Hook
 * Blocks Task sub-agent spawns that violate Kiln alias <-> internal-name mapping.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const LOG_DIR = path.join(os.homedir(), ".claude", "hooks-logs");
const LOG_FILE = path.join(LOG_DIR, "enforce-kiln-spawn-map.log");
const STATE_DIR = path.join(os.homedir(), ".claude", "hooks-state");
const STATE_FILE = path.join(STATE_DIR, "kiln-spawn-state.json");

const MAP = {
  Kiln: null,
  Confucius: "kiln-planner-claude",
  "Sun Tzu": "kiln-planner-codex",
  Socrates: "kiln-debater",
  Plato: "kiln-synthesizer",
  Scheherazade: "kiln-prompter",
  Codex: "kiln-implementer",
  Sphinx: "kiln-reviewer",
  Maestro: "kiln-phase-executor",
  Argus: "kiln-validator",
  "Da Vinci": "kiln-brainstormer",
  Sherlock: "kiln-researcher",
  Athena: "kiln-plan-validator",
  Mnemosyne: "kiln-mapper",
  Aristotle: "kiln-planning-coordinator",
};

const INTERNAL_TO_ALIAS = Object.fromEntries(
  Object.entries(MAP)
    .filter(([, internal]) => internal)
    .map(([alias, internal]) => [internal, alias]),
);

const ALIAS_SYNONYMS = {
  Executor: "Maestro",
  "Phase Executor": "Maestro",
  "Phase-Executor": "Maestro",
  Planner: "Aristotle",
  Implementer: "Codex",
  Reviewer: "Sphinx",
  Validator: "Argus",
};

function log(payload) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${JSON.stringify(payload)}\n`);
  } catch {}
}

function lc(value) {
  return (value || "").toString().toLowerCase();
}

function includesAny(haystack, needles) {
  const h = lc(haystack);
  return needles.some((n) => h.includes(lc(n)));
}

function existsKilnPolicy(cwd) {
  if (!cwd) return false;
  let dir = path.resolve(cwd);
  for (let i = 0; i < 8; i += 1) {
    const probe = path.join(dir, ".agent", "policy", "KilnSpawnMap.md");
    if (fs.existsSync(probe)) return true;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return false;
}

function deny(reason) {
  return {
    permissionDecision: "deny",
    reason,
  };
}

function readState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return {};
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeState(state) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
  } catch {}
}

function runKey(data, cwd) {
  const t = data.transcript_path || "";
  if (t) return `t:${t}`;
  return `c:${cwd || "unknown"}`;
}

async function main() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;

  let data;
  try {
    data = JSON.parse(input);
  } catch {
    console.log("{}");
    return;
  }

  if (data.tool_name !== "Task") {
    console.log("{}");
    return;
  }

  const cwd = data.cwd || "";
  if (!existsKilnPolicy(cwd)) {
    console.log("{}");
    return;
  }

  const ti = data.tool_input || {};
  const rawAlias = (ti.name || "").trim();
  const alias = ALIAS_SYNONYMS[rawAlias] || rawAlias;
  const subagentType = (ti.subagent_type || "").trim();
  const prompt = ti.prompt || ti.description || "";
  const callerHints = [
    data.agent_name,
    data.agent,
    data.subagent_name,
    data.caller_name,
    data.parent_agent_name,
    data.cwd,
    data.transcript_path,
    prompt,
  ]
    .filter(Boolean)
    .join(" | ");

  if (!alias && !subagentType) {
    console.log("{}");
    return;
  }

  // Reject role-label aliases not in spawn map (e.g., "Executor" instead of "Maestro").
  if (rawAlias && ALIAS_SYNONYMS[rawAlias]) {
    const canonical = ALIAS_SYNONYMS[rawAlias];
    const msg = `TEAMLEAD_ALERT|agent=Kiln|issue=noncanonical_alias|provided=${rawAlias}|canonical=${canonical}|action=halted`;
    log({ level: "DENY", cwd, alias: rawAlias, canonical, subagentType, reason: msg });
    console.log(
      JSON.stringify(
        deny(`Kiln spawn blocked: non-canonical agent name '${rawAlias}'. Use '${canonical}' exactly from KilnSpawnMap. ${msg}`),
      ),
    );
    return;
  }

  // Reject unknown alias/subagent_type within Kiln projects to prevent guess-spawning.
  if (alias && MAP[alias] === undefined && !INTERNAL_TO_ALIAS[alias]) {
    const msg = `TEAMLEAD_ALERT|agent=Kiln|issue=unknown_alias|provided=${alias}|action=halted`;
    log({ level: "DENY", cwd, alias, subagentType, reason: msg });
    console.log(
      JSON.stringify(
        deny(`Kiln spawn blocked: unknown agent alias '${alias}'. Use exact names from KilnSpawnMap.`),
      ),
    );
    return;
  }
  if (subagentType && !INTERNAL_TO_ALIAS[subagentType]) {
    const msg = `TEAMLEAD_ALERT|agent=Kiln|issue=unknown_subagent_type|provided=${subagentType}|action=halted`;
    log({ level: "DENY", cwd, alias, subagentType, reason: msg });
    console.log(
      JSON.stringify(
        deny(`Kiln spawn blocked: unknown subagent_type '${subagentType}'. Use exact internal names from KilnSpawnMap.`),
      ),
    );
    return;
  }

  // Alias accidentally used as subagent_type.
  if (subagentType && MAP[subagentType] !== undefined) {
    const expected = MAP[subagentType];
    const msg = `TEAMLEAD_ALERT|agent=Kiln|issue=invalid_subagent_type_alias|provided=${subagentType}|expected=${expected || "orchestrator-only"}|action=halted`;
    log({ level: "DENY", cwd, alias, subagentType, reason: msg });
    console.log(
      JSON.stringify(
        deny(`Kiln spawn blocked: subagent_type must be internal name, not alias. ${msg}`),
      ),
    );
    return;
  }

  // Known alias -> exact internal name required.
  if (alias && MAP[alias] !== undefined) {
    const expected = MAP[alias];
    if (!expected) {
      const msg = `TEAMLEAD_ALERT|agent=Kiln|issue=invalid_target_orchestrator|provided_name=${alias}|action=halted`;
      log({ level: "DENY", cwd, alias, subagentType, reason: msg });
      console.log(
        JSON.stringify(
          deny(`Kiln spawn blocked: '${alias}' is orchestrator-only and must not be spawned as sub-agent. ${msg}`),
        ),
      );
      return;
    }
    if (subagentType !== expected) {
      const msg = `TEAMLEAD_ALERT|agent=${alias}|invoked_as=${subagentType || "missing"}|expected=${expected}|issue=spawn_map_mismatch|action=halted`;
      log({ level: "DENY", cwd, alias, subagentType, expected, reason: msg });
      console.log(
        JSON.stringify(
          deny(`Kiln spawn blocked: name/subagent_type mismatch for '${alias}'. Expected subagent_type='${expected}'. ${msg}`),
        ),
      );
      return;
    }
  }

  // Known internal name -> exact alias required.
  if (subagentType && INTERNAL_TO_ALIAS[subagentType]) {
    const expectedAlias = INTERNAL_TO_ALIAS[subagentType];
    if (alias !== expectedAlias) {
      const msg = `TEAMLEAD_ALERT|agent=${alias || "missing"}|invoked_as=${subagentType}|expected_alias=${expectedAlias}|issue=spawn_map_mismatch|action=halted`;
      log({ level: "DENY", cwd, alias, subagentType, expectedAlias, reason: msg });
      console.log(
        JSON.stringify(
          deny(`Kiln spawn blocked: internal name '${subagentType}' requires name='${expectedAlias}'. ${msg}`),
        ),
      );
      return;
    }
  }

  // Authorization gate: planner/debate/synthesis/validation workers are orchestration-only.
  // They must be spawned by Aristotle and include auth token in Task prompt.
  const orchestrationWorkers = new Set([
    "Confucius",
    "Sun Tzu",
    "Socrates",
    "Plato",
    "Athena",
  ]);
  const authToken = "KILN_SPAWN_AUTH=Aristotle";
  if (alias && orchestrationWorkers.has(alias)) {
    const hasAuthToken = includesAny(prompt, [authToken]);
    const callerLooksLikeAristotle = includesAny(callerHints, [
      "Aristotle",
      "kiln-planning-coordinator",
    ]);
    if (!callerLooksLikeAristotle && !hasAuthToken) {
      const msg = `TEAMLEAD_ALERT|agent=${alias}|issue=unauthorized_spawner|required=Aristotle|required_token=${authToken}|action=halted`;
      log({
        level: "DENY",
        cwd,
        alias,
        subagentType,
        reason: msg,
        callerHints,
      });
      console.log(
        JSON.stringify(
          deny(
            `Kiln spawn blocked: '${alias}' can only be spawned by Aristotle with auth token. ${msg}`,
          ),
        ),
      );
      return;
    }
  }

  // Maestro execution pipeline gate: Scheherazade must run before Codex.
  const callerLooksLikeMaestro = includesAny(callerHints, [
    "Maestro",
    "kiln-phase-executor",
  ]);
  if (callerLooksLikeMaestro) {
    const allowedTargets = new Set([
      "Scheherazade",
      "Codex",
      "Sphinx",
      "Argus",
      "Sherlock",
      "Mnemosyne",
    ]);

    if (alias && !allowedTargets.has(alias)) {
      const msg = `TEAMLEAD_ALERT|agent=Maestro|issue=invalid_worker_for_execution_pipeline|target=${alias}|action=halted`;
      log({ level: "DENY", cwd, alias, subagentType, reason: msg });
      console.log(
        JSON.stringify(
          deny(`Kiln spawn blocked: Maestro may only spawn execution workers. ${msg}`),
        ),
      );
      return;
    }

    const state = readState();
    const key = runKey(data, cwd);
    const run = state[key] || {};

    if (alias === "Scheherazade") {
      run.sharpenerReady = true;
      run.sharpenerAt = Date.now();
      state[key] = run;
      writeState(state);
    }

    if (alias === "Codex") {
      if (!run.sharpenerReady) {
        const msg = "TEAMLEAD_ALERT|agent=Maestro|issue=executor_spawn_before_sharpener|required=Scheherazade_first|action=halted";
        log({ level: "DENY", cwd, alias, subagentType, reason: msg, key });
        console.log(
          JSON.stringify(
            deny(`Kiln spawn blocked: Maestro must spawn Scheherazade before Codex in this run. ${msg}`),
          ),
        );
        return;
      }

      // Consume readiness so each Codex spawn needs a fresh sharpening pass.
      run.sharpenerReady = false;
      run.codexAt = Date.now();
      state[key] = run;
      writeState(state);
    }
  }

  // Duplicate throttle: block obvious multi-spawn storms in a single prompt payload.
  const duplicateHints = [alias, subagentType].filter(Boolean);
  if (duplicateHints.length > 0) {
    const duplicatedInPrompt = duplicateHints.some((h) => {
      const p = lc(prompt);
      const k = lc(h);
      if (!k) return false;
      const first = p.indexOf(k);
      if (first === -1) return false;
      return p.indexOf(k, first + k.length) !== -1;
    });
    if (duplicatedInPrompt) {
      const msg = `TEAMLEAD_ALERT|agent=${alias || subagentType}|issue=possible_duplicate_spawn_storm|action=halted`;
      log({
        level: "DENY",
        cwd,
        alias,
        subagentType,
        reason: msg,
      });
      console.log(
        JSON.stringify(
          deny(
            `Kiln spawn blocked: duplicate spawn intent detected in Task payload. ${msg}`,
          ),
        ),
      );
      return;
    }
  }

  console.log("{}");
}

main().catch((err) => {
  log({ level: "ERROR", error: String(err && err.message ? err.message : err) });
  console.log("{}");
});
