// guards.mjs — prompt scope guards, inlined into workflows by scripts/bundle-workflows.mjs.
// Pure constants/functions only: no I/O, no Date.now/Math.random.

// The canonical no-wander scope line — ONE phrasing replacing v2's four drifted variants
// (build, architecture, validate, report). Workflows that must also read the built project
// compose an explicit exception clause around it; they do not re-drift the core sentence.
export const NO_WANDER = 'Read ONLY the files named in this brief (absolute paths). Do not search the filesystem or read other projects.'

// The builder's repo discipline line: sequential cumulative build, no worktrees, .gitignore hygiene.
export const repoRule = (projectPath) => `Project repo: ${projectPath}. Work and commit there directly — this is a sequential cumulative build; do NOT create a detached git worktree (later slices and milestones must see your commits). Maintain a .gitignore for the stack and NEVER commit generated artifacts (Python: __pycache__/, *.pyc, *.egg-info/, build/, dist/, .pytest_cache/) — add them to .gitignore and 'git rm --cached' any that slipped in.`
