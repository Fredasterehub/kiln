---
name: kiln-codex-invoke
description: "Shared Codex CLI invocation contract — prompt lifecycle, error handling, output normalization"
---
# Kiln Codex Invoke

## Purpose

Shared invocation contract for shell agents that call Codex CLI (`gpt-5.2` or `gpt-5.3-codex-sparks`).
Reference this skill rather than repeating the invocation pattern in each agent.

## Invocation Pattern

Save the prompt to a temp file, invoke Codex, capture output:

**Step 1: Save prompt**

Write the constructed prompt to the role-specific temp file (see § Temp File Convention).

**Step 2: Invoke Codex (primary)**

```bash
codex exec \
  -m <model> \
  -c 'model_reasoning_effort="high"' \
  "$(cat /tmp/kiln-<role>-prompt.md)"
```

**Step 3: Stdin fallback** — if primary fails or the prompt is too large for a CLI argument:

```bash
cat /tmp/kiln-<role>-prompt.md | codex exec \
  -m <model> \
  -c 'model_reasoning_effort="high"' \
  --stdin
```

**Step 4: Cleanup**

```bash
rm -f /tmp/kiln-<role>-prompt.md
```

Supported models:
- `gpt-5.2` — planner and sharpener roles
- `gpt-5.3-codex-sparks` — reviewer role

## Error Handling Protocol

1. **CLI not found:** Write error to output file: `ERROR: Codex CLI not available. This agent should only run in multi-model mode.` Send failure `SendMessage`. Shut down.
2. **First invocation fails:** Retry once with identical prompt and flags.
3. **Second failure:** Write actionable error content (exit code, stderr snippet) to output file. Continue so downstream can handle gracefully.
4. **Malformed or truncated output:** Keep content, prepend a clear `<!-- WARNING: output may be truncated or malformed -->` header. Do minimal normalization for schema compatibility.

## Output Normalization Checklist

After receiving Codex output, verify before writing the output file:
- File begins with the required generated-by header comment (role determines exact text).
- Main title is present and correctly formatted.
- Every task or finding has all mandatory fields.
- IDs follow the expected naming convention.
- Wave Summary or equivalent closing structure exists.
- If any check fails, apply minimal fixup — do not discard valid content.

## Temp File Convention

| Role      | Temp file path                  |
|-----------|---------------------------------|
| Planner   | `/tmp/kiln-plan-prompt.md`      |
| Reviewer  | `/tmp/kiln-review-prompt.md`    |
| Sharpener | `/tmp/kiln-sharpen-prompt.md`   |

Always clean up temp files at end of invocation regardless of success or failure.
