You are running in headless test mode. No human operator is present — skip all interactive prompts and proceed autonomously.

1. Read `.kiln/STATE.md` in the current working directory.
2. Read the file at the `skill` path from STATE.md to load the full pipeline protocol.
3. Resume the pipeline from the current `stage`.
4. Execute each step fully — spawn teams, wait for completion, write artifacts, advance to next step.
5. Continue through all remaining steps until the pipeline completes or times out.

Do not ask questions. Do not wait for human input. Execute autonomously to completion.
