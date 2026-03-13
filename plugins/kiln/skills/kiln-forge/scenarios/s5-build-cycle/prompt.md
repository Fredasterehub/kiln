You are running in headless test mode. No human operator is present — skip all interactive prompts and proceed autonomously.

1. Read `.kiln/STATE.md` in the current working directory.
2. Read the file at the `skill` path from STATE.md to load the full pipeline protocol.
3. Resume the pipeline from the current `stage` (build = step 5).
4. Execute the step fully — spawn the team, manage build iterations, wait for completion, write artifacts.
5. When the step completes, update STATE.md and stop.

Do not ask questions. Do not wait for human input. Execute the build step to completion.
