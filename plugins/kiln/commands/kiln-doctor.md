---
name: kiln-doctor
description: Check Kiln pipeline prerequisites and diagnose issues.
argument-hint: [no arguments needed]
allowed-tools: Read, Bash, Glob, Grep
---

# /kiln-doctor

Run diagnostics to verify the Kiln pipeline is ready to fire.

## Checks to Perform

Run all checks and present results as a checklist:

### 1. Codex CLI

```bash
which codex && codex --version
```
- Expected: codex-cli found on PATH
- If missing: "Install Codex CLI: npm install -g @openai/codex"

### 2. GPT-5.4 Model Access

```bash
echo "Reply with just OK" | timeout 30 codex exec -m gpt-5.4 --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check 2>&1
```
- Expected: successful response
- If fails: "GPT-5.4 model not accessible. Check your OpenAI API key and model access."

### 3. Kiln Agent Files

Check that all 29 Kiln agent files exist in the plugin:
```bash
ls -1 ${CLAUDE_PLUGIN_ROOT}/agents/*.md | wc -l
```
- Expected: 29 agent files
- List any missing agents if count is wrong.

### 4. Pipeline Skill

Check that SKILL.md and reference files exist:
- `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/SKILL.md`
- `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/step-definitions.md`
- `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/artifact-flow.md`
- `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/kill-streaks.md`

### 5. Existing Pipeline State

Check for `.kiln/STATE.md` in the current working directory:
- If found: display current stage, build_iteration, correction_cycle, run_id
- If not found: "No existing pipeline state. Ready for a fresh run."

### 6. Brainstorm Data

Check that brainstorm technique files exist:
- `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/data/brainstorming-techniques.json`
- `${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/data/elicitation-methods.json`
- If missing: "Brainstorm data files not found. Da Vinci will work without technique suggestions."

## Output Format

Present results as:
```
Kiln Doctor Report
==================
[PASS] Codex CLI: codex-cli found on PATH
[PASS] GPT-5.4: Model accessible
[PASS] Agent files: 29/29 present
[PASS] Pipeline skill: All files present
[INFO] Pipeline state: No existing run (ready for fresh start)
[WARN] Brainstorm data: elicitation-methods.json missing

Verdict: Ready to fire!
```

Use PASS/FAIL/WARN/INFO prefixes. End with a clear verdict.
