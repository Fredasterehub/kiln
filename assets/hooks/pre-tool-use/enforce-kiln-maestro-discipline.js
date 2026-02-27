#!/usr/bin/env node
/**
 * Enforce discipline for Maestro (kiln-phase-executor).
 * Maestro must orchestrate through Task delegation, not execute work directly.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const LOG_DIR = path.join(os.homedir(), ".claude", "hooks-logs");
const LOG_FILE = path.join(LOG_DIR, "enforce-kiln-maestro-discipline.log");

function lc(v) {
  return (v || "").toString().toLowerCase();
}

function log(payload) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${JSON.stringify(payload)}\n`);
  } catch {}
}

function deny(reason) {
  return {
    permissionDecision: "deny",
    reason,
  };
}

function isMaestroContext(data) {
  const ti = data.tool_input || {};
  const hints = [
    data.agent_name,
    data.agent,
    data.subagent_name,
    data.caller_name,
    data.parent_agent_name,
    ti.name,
    data.cwd,
    data.transcript_path,
    ti.prompt,
    ti.description,
  ]
    .filter(Boolean)
    .join(" | ")
    .toLowerCase();
  return hints.includes("maestro") || hints.includes("kiln-phase-executor");
}

function hasKilnPolicy(cwd) {
  if (!cwd) return false;
  let dir = path.resolve(cwd);
  for (let i = 0; i < 10; i += 1) {
    const probes = [
      path.join(dir, ".agent", "policy", "KilnProtocol.md"),
      path.join(path.dirname(dir), ".agent", "policy", "KilnProtocol.md"),
    ];
    if (probes.some((p) => fs.existsSync(p))) return true;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return false;
}

function isReadOnlyBashCommand(cmd) {
  const c = lc(cmd).trim();
  if (!c) return true;

  const allowedPrefixes = [
    "git status",
    "git log",
    "git diff",
    "git show",
    "git branch",
    "git rev-parse",
    "ls",
    "dir",
    "pwd",
    "cat",
    "head",
    "tail",
    "wc",
    "rg ",
    "rg--",
    "grep ",
    "findstr ",
    "select-string",
    "echo ",
    "date",
    "where ",
    "which ",
  ];

  return allowedPrefixes.some((p) => c === p || c.startsWith(p));
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

  if (!hasKilnPolicy(data.cwd || "")) {
    console.log("{}");
    return;
  }

  if (!isMaestroContext(data)) {
    console.log("{}");
    return;
  }

  const toolName = data.tool_name || "";
  const ti = data.tool_input || {};

  if (toolName === "Write" || toolName === "Edit" || toolName === "MultiEdit") {
    const msg =
      "TEAMLEAD_ALERT|agent=Maestro|issue=direct_edit_by_orchestrator|expected=spawn_Scheherazade_then_Codex_then_Sphinx_or_Argus|action=halted";
    log({ level: "DENY", toolName, filePath: ti.file_path || ti.path, reason: msg });
    console.log(
      JSON.stringify(
        deny(
          `Kiln executor blocked: Maestro is orchestration-only and must not edit files directly. Delegate via Task pipeline. ${msg}`,
        ),
      ),
    );
    return;
  }

  if (toolName === "Bash") {
    const cmd = ti.command || "";
    if (!isReadOnlyBashCommand(cmd)) {
      const msg =
        "TEAMLEAD_ALERT|agent=Maestro|issue=direct_execution_by_orchestrator|expected=delegate_execution_to_Codex_and_validation_to_Argus|action=halted";
      log({ level: "DENY", toolName, command: cmd, reason: msg });
      console.log(
        JSON.stringify(
          deny(
            `Kiln executor blocked: Maestro may only run read-only inspection commands; execution/mutation must be delegated via Task. ${msg}`,
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
