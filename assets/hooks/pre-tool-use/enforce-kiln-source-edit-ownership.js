#!/usr/bin/env node
/**
 * Enforce source edit ownership in Kiln workflows.
 * Only Codex (kiln-implementer) may modify project source files.
 * Orchestrators may still write orchestration artifacts under .kiln/.claude memory paths.
 */

const fs = require("fs");
const path = require("path");

function lc(v) {
  return (v || "").toString().toLowerCase();
}

function deny(reason) {
  return {
    permissionDecision: "deny",
    reason,
  };
}

function policyPresent(cwd) {
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

function isCodexContext(data) {
  const ti = data.tool_input || {};
  const hints = [
    data.agent_name,
    data.agent,
    data.subagent_name,
    data.caller_name,
    data.parent_agent_name,
    ti.name,
    ti.prompt,
    ti.description,
  ]
    .filter(Boolean)
    .join(" | ")
    .toLowerCase();
  return hints.includes("codex") || hints.includes("kiln-implementer");
}

function isAllowedNonSourcePath(filePath) {
  const p = lc(filePath);
  return (
    p.includes("\\.kiln\\") ||
    p.includes("/.kiln/") ||
    p.includes("\\.claude\\") ||
    p.includes("/.claude/") ||
    p.endsWith("\\memory.md") ||
    p.endsWith("/memory.md")
  );
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

  const toolName = data.tool_name || "";
  if (toolName !== "Write" && toolName !== "Edit" && toolName !== "MultiEdit") {
    console.log("{}");
    return;
  }

  const cwd = data.cwd || "";
  if (!policyPresent(cwd)) {
    console.log("{}");
    return;
  }

  const ti = data.tool_input || {};
  const targetPath = ti.file_path || ti.path || "";
  if (!targetPath) {
    console.log("{}");
    return;
  }

  if (isAllowedNonSourcePath(targetPath)) {
    console.log("{}");
    return;
  }

  if (!isCodexContext(data)) {
    console.log(
      JSON.stringify(
        deny(
          "Kiln source-edit ownership: blocked. Only Codex (kiln-implementer) may edit project source files. TEAMLEAD_ALERT|issue=source_edit_by_non_codex|action=halted",
        ),
      ),
    );
    return;
  }

  console.log("{}");
}

main().catch(() => {
  console.log("{}");
});

