#!/usr/bin/env node
/**
 * Enforce Kiln Spawn Map Hook (Fail-Closed)
 *
 * Controls:
 * 1) Allowlist-only Task spawns: exact (name, subagent_type) pairs only.
 * 2) Mandatory stage token chain: signed internal stage tokens gate Maestro pipeline.
 * 3) Session-level violation breaker: repeated denials trip breaker until TeamLead reset token is provided.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const LOG_DIR = path.join(os.homedir(), ".claude", "hooks-logs");
const LOG_FILE = path.join(LOG_DIR, "enforce-kiln-spawn-map.log");
const STATE_DIR = path.join(os.homedir(), ".claude", "hooks-state");
const STATE_FILE = path.join(STATE_DIR, "kiln-spawn-state.json");

const BREAKER_THRESHOLD = 3;
const BREAKER_RESET_PREFIX = "KILN_BREAKER_RESET=";

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

const NONCANONICAL_ALIAS_HINTS = {
  Executor: "Maestro",
  "Phase Executor": "Maestro",
  "Phase-Executor": "Maestro",
  Planner: "Aristotle",
  Implementer: "Codex",
  Reviewer: "Sphinx",
  Validator: "Argus",
};

function lc(value) {
  return (value || "").toString().toLowerCase();
}

function includesAny(haystack, needles) {
  const h = lc(haystack);
  return needles.some((n) => h.includes(lc(n)));
}

function log(payload) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${JSON.stringify(payload)}\n`);
  } catch {}
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

function readState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return null;
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return null;
  }
}

function initialState() {
  return {
    version: 3,
    signingSecret: crypto.randomBytes(24).toString("hex"),
    runs: {},
  };
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

function orchestratorContext(callerHints) {
  return includesAny(callerHints, [
    "Kiln",
    "Aristotle",
    "Maestro",
    "kiln-planning-coordinator",
    "kiln-phase-executor",
  ]);
}

function tokenSig(secret, key, stage, nonce) {
  return crypto
    .createHmac("sha256", secret)
    .update(`${key}|${stage}|${nonce}`)
    .digest("hex");
}

function issueStageToken(state, key, run, stage) {
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const sig = tokenSig(state.signingSecret, key, stage, nonce);
  if (!run.tokens || typeof run.tokens !== "object") run.tokens = {};
  run.tokens[stage] = {
    nonce,
    sig,
    issuedAt: Date.now(),
    consumed: false,
  };
}

function consumeStageToken(state, key, run, stage) {
  const token = run.tokens && run.tokens[stage];
  if (!token || token.consumed) return false;
  const expected = tokenSig(state.signingSecret, key, stage, token.nonce);
  if (expected !== token.sig) return false;
  token.consumed = true;
  return true;
}

function parseResetToken(prompt) {
  const m = String(prompt || "").match(/KILN_BREAKER_RESET=([A-Za-z0-9_-]+)/);
  return m ? m[1] : "";
}

function maybeApplyBreakerReset(run, prompt) {
  if (!run.breaker || !run.breaker.active) return false;
  const got = parseResetToken(prompt);
  if (!got) return false;
  if (got !== run.breaker.resetToken) return false;
  run.breaker.active = false;
  run.breaker.clearedAt = Date.now();
  run.denials = 0;
  return true;
}

function breakerMessage(run) {
  return `TEAMLEAD_ALERT|agent=Kiln|issue=violation_breaker_tripped|required_reset=${BREAKER_RESET_PREFIX}${run.breaker.resetToken}|action=halted`;
}

function registerViolation(run, baseMsg) {
  run.denials = (run.denials || 0) + 1;
  if (!run.breaker) run.breaker = { active: false, resetToken: "" };
  if (!run.breaker.active && run.denials >= BREAKER_THRESHOLD) {
    run.breaker.active = true;
    run.breaker.resetToken = crypto.randomBytes(8).toString("hex");
    run.breaker.trippedAt = Date.now();
    return `${baseMsg} ${breakerMessage(run)}`;
  }
  return baseMsg;
}

function deny(reason) {
  return {
    permissionDecision: "deny",
    reason,
  };
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

  const state = readState() || initialState();

  const ti = data.tool_input || {};
  const rawAlias = (ti.name || "").trim();
  const alias = rawAlias;
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
  const key = runKey(data, cwd);
  const run = state.runs[key] || { denials: 0, breaker: { active: false, resetToken: "" }, tokens: {} };
  state.runs[key] = run;

  const isOrchestrator = orchestratorContext(callerHints);

  // Session-level breaker: once tripped, orchestrator Task spawns are blocked until reset token appears.
  if (isOrchestrator && run.breaker && run.breaker.active) {
    const resetApplied = maybeApplyBreakerReset(run, prompt);
    if (!resetApplied) {
      const msg = breakerMessage(run);
      log({ level: "DENY", cwd, alias, subagentType, reason: msg, key });
      writeState(state);
      console.log(
        JSON.stringify(
          deny(`Kiln spawn blocked: violation breaker active. Provide TeamLead reset token. ${msg}`),
        ),
      );
      return;
    }
  }

  // Allowlist-only exact pair: no missing values, no unknowns, no fallback/synonyms.
  if (!alias || !subagentType) {
    const msg = registerViolation(
      run,
      "TEAMLEAD_ALERT|agent=Kiln|issue=missing_spawn_fields|required=name_and_subagent_type|action=halted",
    );
    log({ level: "DENY", cwd, alias, subagentType, reason: msg, key });
    writeState(state);
    console.log(
      JSON.stringify(
        deny(`Kiln spawn blocked: Task spawn must include exact name and subagent_type. ${msg}`),
      ),
    );
    return;
  }

  if (NONCANONICAL_ALIAS_HINTS[rawAlias]) {
    const canonical = NONCANONICAL_ALIAS_HINTS[rawAlias];
    const msg = registerViolation(
      run,
      `TEAMLEAD_ALERT|agent=Kiln|issue=noncanonical_alias|provided=${rawAlias}|canonical=${canonical}|action=halted`,
    );
    log({ level: "DENY", cwd, alias: rawAlias, subagentType, canonical, reason: msg, key });
    writeState(state);
    console.log(
      JSON.stringify(
        deny(`Kiln spawn blocked: non-canonical agent name '${rawAlias}'. Use '${canonical}' exactly.`),
      ),
    );
    return;
  }

  if (MAP[alias] === undefined) {
    const msg = registerViolation(
      run,
      `TEAMLEAD_ALERT|agent=Kiln|issue=unknown_alias|provided=${alias}|action=halted`,
    );
    log({ level: "DENY", cwd, alias, subagentType, reason: msg, key });
    writeState(state);
    console.log(
      JSON.stringify(
        deny(`Kiln spawn blocked: unknown agent alias '${alias}'. Use exact names from KilnSpawnMap.`),
      ),
    );
    return;
  }

  const expectedInternal = MAP[alias];
  if (!expectedInternal) {
    const msg = registerViolation(
      run,
      `TEAMLEAD_ALERT|agent=Kiln|issue=invalid_target_orchestrator|provided_name=${alias}|action=halted`,
    );
    log({ level: "DENY", cwd, alias, subagentType, reason: msg, key });
    writeState(state);
    console.log(
      JSON.stringify(
        deny(`Kiln spawn blocked: '${alias}' is orchestrator-only and must not be spawned as sub-agent. ${msg}`),
      ),
    );
    return;
  }

  if (!INTERNAL_TO_ALIAS[subagentType]) {
    const msg = registerViolation(
      run,
      `TEAMLEAD_ALERT|agent=Kiln|issue=unknown_subagent_type|provided=${subagentType}|action=halted`,
    );
    log({ level: "DENY", cwd, alias, subagentType, reason: msg, key });
    writeState(state);
    console.log(
      JSON.stringify(
        deny(`Kiln spawn blocked: unknown subagent_type '${subagentType}'. Use exact internal names from KilnSpawnMap.`),
      ),
    );
    return;
  }

  if (subagentType !== expectedInternal) {
    const msg = registerViolation(
      run,
      `TEAMLEAD_ALERT|agent=${alias}|invoked_as=${subagentType}|expected=${expectedInternal}|issue=spawn_map_mismatch|action=halted`,
    );
    log({ level: "DENY", cwd, alias, subagentType, expectedInternal, reason: msg, key });
    writeState(state);
    console.log(
      JSON.stringify(
        deny(`Kiln spawn blocked: name/subagent_type mismatch for '${alias}'. Expected '${expectedInternal}'. ${msg}`),
      ),
    );
    return;
  }

  // Aristotle authorization gate for planning workers.
  const orchestrationWorkers = new Set(["Confucius", "Sun Tzu", "Socrates", "Plato", "Athena"]);
  const authToken = "KILN_SPAWN_AUTH=Aristotle";
  if (orchestrationWorkers.has(alias)) {
    const hasAuthToken = includesAny(prompt, [authToken]);
    const callerLooksLikeAristotle = includesAny(callerHints, ["Aristotle", "kiln-planning-coordinator"]);
    if (!callerLooksLikeAristotle || !hasAuthToken) {
      const msg = registerViolation(
        run,
        `TEAMLEAD_ALERT|agent=${alias}|issue=unauthorized_spawner|required=Aristotle|required_token=${authToken}|action=halted`,
      );
      log({ level: "DENY", cwd, alias, subagentType, reason: msg, key, callerHints });
      writeState(state);
      console.log(
        JSON.stringify(
          deny(`Kiln spawn blocked: '${alias}' can only be spawned by Aristotle with auth token. ${msg}`),
        ),
      );
      return;
    }
  }

  // Maestro execution pipeline gate + mandatory signed stage token chain.
  const callerLooksLikeMaestro = includesAny(callerHints, ["Maestro", "kiln-phase-executor"]);
  if (callerLooksLikeMaestro) {
    const allowedTargets = new Set(["Scheherazade", "Codex", "Sphinx", "Argus", "Sherlock", "Mnemosyne"]);
    if (!allowedTargets.has(alias)) {
      const msg = registerViolation(
        run,
        `TEAMLEAD_ALERT|agent=Maestro|issue=invalid_worker_for_execution_pipeline|target=${alias}|action=halted`,
      );
      log({ level: "DENY", cwd, alias, subagentType, reason: msg, key });
      writeState(state);
      console.log(
        JSON.stringify(
          deny(`Kiln spawn blocked: Maestro may only spawn execution workers. ${msg}`),
        ),
      );
      return;
    }

    // Stage token chain:
    // Scheherazade emits SHARPEN_DONE -> Codex consumes SHARPEN_DONE and emits CODEX_DONE
    // -> Sphinx consumes CODEX_DONE and emits REVIEW_DONE -> Argus consumes REVIEW_DONE.
    if (alias === "Scheherazade") {
      issueStageToken(state, key, run, "SHARPEN_DONE");
    } else if (alias === "Codex") {
      if (!consumeStageToken(state, key, run, "SHARPEN_DONE")) {
        const msg = registerViolation(
          run,
          "TEAMLEAD_ALERT|agent=Maestro|issue=missing_or_invalid_stage_token|required=SHARPEN_DONE|action=halted",
        );
        log({ level: "DENY", cwd, alias, subagentType, reason: msg, key });
        writeState(state);
        console.log(
          JSON.stringify(
            deny(`Kiln spawn blocked: Codex requires prior signed SHARPEN_DONE stage token.`),
          ),
        );
        return;
      }
      issueStageToken(state, key, run, "CODEX_DONE");
    } else if (alias === "Sphinx") {
      if (!consumeStageToken(state, key, run, "CODEX_DONE")) {
        const msg = registerViolation(
          run,
          "TEAMLEAD_ALERT|agent=Maestro|issue=missing_or_invalid_stage_token|required=CODEX_DONE|action=halted",
        );
        log({ level: "DENY", cwd, alias, subagentType, reason: msg, key });
        writeState(state);
        console.log(
          JSON.stringify(
            deny(`Kiln spawn blocked: Sphinx requires prior signed CODEX_DONE stage token.`),
          ),
        );
        return;
      }
      issueStageToken(state, key, run, "REVIEW_DONE");
    } else if (alias === "Argus") {
      if (!consumeStageToken(state, key, run, "REVIEW_DONE")) {
        const msg = registerViolation(
          run,
          "TEAMLEAD_ALERT|agent=Maestro|issue=missing_or_invalid_stage_token|required=REVIEW_DONE|action=halted",
        );
        log({ level: "DENY", cwd, alias, subagentType, reason: msg, key });
        writeState(state);
        console.log(
          JSON.stringify(
            deny(`Kiln spawn blocked: Argus requires prior signed REVIEW_DONE stage token.`),
          ),
        );
        return;
      }
      issueStageToken(state, key, run, "VALIDATION_READY");
    }
  }

  writeState(state);
  console.log("{}");
}

main().catch((err) => {
  log({ level: "ERROR", error: String(err && err.message ? err.message : err) });
  console.log("{}");
});

