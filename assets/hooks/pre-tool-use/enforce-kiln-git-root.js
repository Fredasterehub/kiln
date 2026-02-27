#!/usr/bin/env node
/**
 * Enforce canonical git root usage for Kiln runs.
 * Blocks git commands when:
 * - `git -C <path>` points to missing/non-repo paths
 * - multiple different -C targets are used in one command
 * - git runs from a subdirectory instead of the canonical repo root
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

function lc(v) {
  return (v || "").toString().toLowerCase();
}

function deny(reason) {
  return {
    permissionDecision: "deny",
    reason,
  };
}

function existsKilnPolicy(cwd) {
  if (!cwd) return false;
  let dir = path.resolve(cwd);
  for (let i = 0; i < 8; i += 1) {
    const probe = path.join(dir, ".agent", "policy", "KilnProtocol.md");
    if (fs.existsSync(probe)) return true;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return false;
}

function canonicalGitRoot(cwd) {
  try {
    return execFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function isGitRepo(p) {
  try {
    execFileSync("git", ["-C", p, "rev-parse", "--is-inside-work-tree"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

function parseGitCPaths(command) {
  const hits = [];
  const re = /\bgit\s+-C\s+("([^"]+)"|'([^']+)'|([^\s;|&]+))/g;
  let m;
  while ((m = re.exec(command)) !== null) {
    const raw = m[2] || m[3] || m[4] || "";
    if (raw) hits.push(raw);
  }
  return hits;
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

  if (data.tool_name !== "Bash") {
    console.log("{}");
    return;
  }

  const cwd = data.cwd || process.cwd();
  if (!existsKilnPolicy(cwd)) {
    console.log("{}");
    return;
  }

  const cmd = String((data.tool_input || {}).command || "");
  if (!/\bgit\b/i.test(cmd)) {
    console.log("{}");
    return;
  }

  const root = canonicalGitRoot(cwd);
  if (!root) {
    // If we cannot resolve canonical root from cwd, do not block globally.
    console.log("{}");
    return;
  }

  const cPathsRaw = parseGitCPaths(cmd);
  const cPathsResolved = cPathsRaw.map((p) => {
    const resolved = path.isAbsolute(p) ? path.normalize(p) : path.normalize(path.resolve(cwd, p));
    return resolved;
  });

  for (let i = 0; i < cPathsResolved.length; i += 1) {
    const p = cPathsResolved[i];
    if (!fs.existsSync(p)) {
      console.log(
        JSON.stringify(
          deny(
            `Kiln git-root lock: blocked invalid git -C path '${cPathsRaw[i]}'. Path does not exist. TEAMLEAD_ALERT|issue=invalid_git_c_path|expected_root=${root}|action=halted`,
          ),
        ),
      );
      return;
    }
    if (!isGitRepo(p)) {
      console.log(
        JSON.stringify(
          deny(
            `Kiln git-root lock: blocked git -C path '${cPathsRaw[i]}'. Not a git repo. TEAMLEAD_ALERT|issue=non_repo_git_c_path|expected_root=${root}|action=halted`,
          ),
        ),
      );
      return;
    }
    if (path.resolve(p) !== path.resolve(root)) {
      console.log(
        JSON.stringify(
          deny(
            `Kiln git-root lock: blocked git -C '${cPathsRaw[i]}'. Git root locked to '${root}'. TEAMLEAD_ALERT|issue=git_root_mismatch|action=halted`,
          ),
        ),
      );
      return;
    }
  }

  if (cPathsResolved.length > 1) {
    const unique = [...new Set(cPathsResolved.map((p) => path.resolve(p)))];
    if (unique.length > 1) {
      console.log(
        JSON.stringify(
          deny(
            `Kiln git-root lock: multiple git -C targets detected in one command. Root locked to '${root}'. TEAMLEAD_ALERT|issue=multiple_git_c_targets|action=halted`,
          ),
        ),
      );
      return;
    }
  }

  // If no -C override, require command from canonical root (not a random subfolder).
  if (cPathsResolved.length === 0 && path.resolve(cwd) !== path.resolve(root)) {
    if (!lc(cmd).includes("git rev-parse --show-toplevel")) {
      console.log(
        JSON.stringify(
          deny(
            `Kiln git-root lock: run git from canonical root '${root}' (current cwd '${cwd}'). TEAMLEAD_ALERT|issue=git_from_non_root|action=halted`,
          ),
        ),
      );
      return;
    }
  }

  console.log("{}");
}

main().catch(() => {
  console.log("{}");
});

