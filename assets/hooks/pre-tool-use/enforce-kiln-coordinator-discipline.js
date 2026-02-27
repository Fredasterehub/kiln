#!/usr/bin/env node
/**
 * Enforce coordinator discipline for Aristotle (kiln-planning-coordinator).
 * Blocks role-simulation behavior such as direct planner artifact generation
 * or direct codex CLI execution by the coordinator.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const LOG_DIR = path.join(os.homedir(), ".claude", "hooks-logs");
const LOG_FILE = path.join(LOG_DIR, "enforce-kiln-coordinator-discipline.log");

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

function isAristotleContext(data) {
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
  return hints.includes("aristotle") || hints.includes("kiln-planning-coordinator");
}

function hasKilnPolicy(cwd) {
  if (!cwd) return false;
  let dir = path.resolve(cwd);
  for (let i = 0; i < 10; i += 1) {
    if (fs.existsSync(path.join(dir, ".agent", "policy", "KilnProtocol.md"))) return true;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return false;
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

  if (!isAristotleContext(data)) {
    console.log("{}");
    return;
  }

  const toolName = data.tool_name || "";
  const ti = data.tool_input || {};

  // Coordinator must not run codex CLI directly.
  if (toolName === "Bash") {
    const cmd = lc(ti.command);
    if (cmd.includes("codex exec")) {
      const msg =
        "TEAMLEAD_ALERT|agent=Aristotle|issue=direct_codex_cli_by_coordinator|expected=delegate_to_sun_tzu_via_task|action=halted";
      log({ level: "DENY", toolName, command: ti.command, reason: msg });
      console.log(
        JSON.stringify(
          deny(
            `Kiln coordinator blocked: Aristotle must not run codex CLI directly. Delegate via Task to Sun Tzu. ${msg}`,
          ),
        ),
      );
      return;
    }
  }

  // Coordinator must not directly write planner/debate/synthesis/validation artifacts.
  if (toolName === "Write" || toolName === "Edit") {
    const p = lc(ti.file_path || ti.path || "");
    const blockedTargets = [
      "/plans/claude_plan.md",
      "\\plans\\claude_plan.md",
      "/plans/codex_plan.md",
      "\\plans\\codex_plan.md",
      "/plans/debate_resolution.md",
      "\\plans\\debate_resolution.md",
      "/memory/master-plan.md",
      "\\memory\\master-plan.md",
      "/plans/plan_validation.md",
      "\\plans\\plan_validation.md",
    ];
    if (blockedTargets.some((t) => p.endsWith(t) || p.includes(t))) {
      const msg =
        "TEAMLEAD_ALERT|agent=Aristotle|issue=direct_artifact_authoring_by_coordinator|expected=delegate_via_task_to_leaf_agents|action=halted";
      log({ level: "DENY", toolName, filePath: ti.file_path || ti.path, reason: msg });
      console.log(
        JSON.stringify(
          deny(
            `Kiln coordinator blocked: Aristotle must orchestrate, not directly author planner artifacts. ${msg}`,
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

