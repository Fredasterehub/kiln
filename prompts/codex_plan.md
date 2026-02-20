## 1. **Executive Summary**
- Kiln v3 keeps the same 5-stage user experience (Brainstorm → Plan → Execute → Validate → Deliver) but upgrades **Stage 3** from strictly sequential phases to an optional **DAG-driven wave-parallel executor**.
- v3 introduces **contract-first orchestration** via a new **Hammurabi (Lawgiver)** agent that materializes and freezes interfaces (OpenAPI/JSON Schema/TS) before parallel work begins.
- v3 adds a **walking skeleton “Phase 0”** (thin E2E) as the root of the DAG in wave-parallel mode to de-risk integration before widening in parallel.
- v3 preserves a hard guarantee: **simple projects stay exactly as simple as v0.2.1** via an explicit sequential fallback decision boundary (≤3 phases OR dependency density >70% OR operator chooses sequential), with **zero new v3 artifacts** created in sequential mode.
- v3 becomes **reactive/event-driven**: phases emit structured events; waves advance only on merge-quality gates; failures halt the wave with deterministic recovery on `/kiln:resume`.

---

## 2. **Execution Model**

### 2.1 Pipeline (5 stages; what changes)
**Stage 1 — Initialization & Brainstorm (UNCHANGED)**  
- Da Vinci produces `vision.md` (same structure as v0.2.1).
- Operator selects brainstorm depth + debate mode.

**Stage 2 — Planning (MODIFIED; parallel planning + synthesis + optional DAG + contracts)**
1) Confucius + Sun Tzu plan in parallel (same as v0.2.1).  
2) Socrates debates disagreements (same).  
3) Plato synthesizes `master-plan.md` (same file) **and** (only if wave-parallel is selected/eligible) embeds a `kiln-dag-v1` block.  
4) **NEW (wave-parallel only): Hammurabi materializes contracts** into `$KILN_DIR/contracts/` and freezes them with `$KILN_DIR/contracts/LOCK.json`.

**Stage 3 — Execution (MODIFIED; sequential OR wave-parallel)**
- Sequential path: identical to v0.2.1 Maestro phase loop; no wave artifacts.
- Wave-parallel path: compute waves from DAG; execute each wave as a set of isolated phase branches/worktrees; merge in dependency order with wave-level integration gates.

**Stage 4 — Validation (MODIFIED; wave-aware)**
- Argus runs end-to-end validation as before, plus (wave-parallel only) per-wave integration reports.

**Stage 5 — Delivery (UNCHANGED)**
- Final operator review and summary.

---

### 2.2 DAG YAML format in `master-plan.md` (exact schema)

When wave-parallel is active, Plato MUST include exactly one fenced YAML block labeled `kiln-dag-v1`:

```yaml
```kiln-dag-v1
version: 1
generated_at: "2026-02-19T00:00:00Z"        # ISO-8601
project_slug: "<string>"
planning_mode: "standard|deep|light"
nodes:
  - id: "P0"                                 # unique; "P0" reserved for walking skeleton
    title: "Walking Skeleton"
    goal: "<one paragraph>"
    estimate_hours: 2.0
    kind: "skeleton|feature|infra|refactor|test|docs"
    entrypoints: ["<paths or identifiers>"]  # optional; e.g., src/server, packages/api
    outputs:
      - type: "code|doc|config|schema"
        path: "<repo-relative path>"
        description: "<string>"
    contracts:
      consumes: ["<contract_id>"]            # e.g. api.public.v1, db.schema.v1
      produces: ["<contract_id>"]
    locks:
      - "db:migrations"                      # global shared resources
      - "path:src/server/**"                 # glob-like lock
      - "contract:api.public.v1"
    qa:
      reviewer: "Sphinx"
      rounds_cap: 3
      required_checks: ["unit", "lint"]      # symbolic; resolved by Argus policy
    merge:
      strategy: "ff|squash|merge"
      order_hint: 10                         # lower merges earlier inside same wave
  - id: "P1"
    title: "<string>"
    goal: "<string>"
    estimate_hours: 6.0
    kind: "feature"
    entrypoints: []
    outputs: []
    contracts: { consumes: [], produces: [] }
    locks: []
    qa: { reviewer: "Sphinx", rounds_cap: 3, required_checks: [] }
    merge: { strategy: "squash", order_hint: 20 }

edges:
  # dependency_type governs speculation + gating semantics
  - from: "P0"
    to: "P1"
    dependency_type: "code|contract|both"
  - from: "P1"
    to: "P2"
    dependency_type: "both"

policy:
  max_parallel_phases: 3                     # operator override allowed
  lock_conflict_mode: "prevent"              # prevent = never co-schedule overlapping locks
  sequential_fallback:
    phases_leq: 3
    density_gt: 0.70
```
```

**Interpretation rules**
- `nodes[].locks` is a **set of exclusive resources**. Two phases cannot run concurrently if their lock sets intersect (even if DAG would allow).
- `dependency_type`:
  - `contract`: downstream can start after **contract freeze**, even if upstream code isn’t merged (eligible for speculation).
  - `code`: downstream must wait for upstream **merge**.
  - `both`: must wait for upstream **merge**; contract freeze alone is insufficient.

---

### 2.3 Kahn-style wave computation (with lock constraints)

**Definitions**
- `N` = number of phases (DAG nodes excluding optional docs-only nodes if Plato chooses to mark them `kind: docs` and `estimate_hours: 0.5`, still included).
- `E` = number of edges.
- Max directed edges in a DAG on `N` nodes is `N*(N-1)/2`.

**Dependency density**
```text
density = E / (N*(N-1)/2)
```

**Wave computation pseudocode (Kahn BFS + lock packing)**
```pseudo
function computeWaves(dag):
  indegree = map(node_id -> 0)
  adj = map(node_id -> list of node_id)
  for edge in dag.edges:
    indegree[edge.to] += 1
    adj[edge.from].append(edge.to)

  ready = queue of node_ids where indegree[id] == 0
  waves = []
  scheduled = set()

  while ready not empty:
    # Build one wave from currently-ready nodes, respecting locks + max_parallel
    wave = []
    usedLocks = set()
    # determinism: sort ready by (merge.order_hint ASC, estimate_hours DESC, id ASC)
    candidates = sort(ready, key=deterministicKey)

    for id in candidates:
      if id in scheduled: continue
      nodeLocks = set(dag.nodes[id].locks)
      if intersects(nodeLocks, usedLocks): continue
      wave.append(id)
      usedLocks = usedLocks ∪ nodeLocks
      scheduled.add(id)
      if wave.size == dag.policy.max_parallel_phases: break

    if wave is empty:
      # Deadlock by locks: fall back to 1 phase to guarantee progress
      id = candidates[0]
      wave = [id]
      scheduled.add(id)

    waves.append(wave)

    # Remove wave nodes from graph
    for id in wave:
      for nxt in adj[id]:
        indegree[nxt] -= 1
        if indegree[nxt] == 0:
          ready.push(nxt)
      ready.remove(id)

  if scheduled.size != number_of_nodes:
    raise "DAG_INVALID_OR_CYCLIC"

  return waves
```

**Output of wave computation**
- `waves = [[P0], [P1,P2], [P3], ...]`  
- Persisted only in wave-parallel mode as `$KILN_DIR/waves/wave_<NN>.md` manifests (see §5).

---

### 2.4 How waves map to Maestro spawning

**Key principle:** parallel phases must not share a mutable working directory.

**Wave-parallel execution model**
- For each phase `Pi` in a wave:
  - Create an isolated git branch and git worktree.
  - Run prompt → implementation → review → fixes inside that worktree only.
  - Merge only after QA approval and merge-conflict prediction.

**Worktree layout (wave-parallel only)**
- `$PROJECT/.kiln/worktrees/wave_<NN>/phase_<PHASE_ID>/` (a git worktree)
- Phase branch naming:
  - Non-speculative: `kiln/wave-<NN>/phase-<PHASE_ID>`
  - Speculative: `kiln/spec/wave-<NN>/phase-<PHASE_ID>`

**Spawn pattern per phase**
- Maestro spawns, per phase:
  1) Scheherazade: generate the task prompts + acceptance criteria
  2) Codex: implement in the phase worktree
  3) Sphinx: review against contracts + plan + diff
  4) (optional) Codex fix tasks, up to 3 QA rounds total

Maestro can run these per-phase pipelines concurrently across phases in the same wave because they operate in separate worktrees.

---

### 2.5 Lock constraints beyond the DAG
Even if the DAG permits concurrency, **locks prevent it**. v3 standard lock namespaces:

- `db:migrations` — exclusive; only one phase may touch migrations concurrently
- `path:<glob>` — exclusive; prevents parallel edits to overlapping subsystems
- `contract:<contract_id>` — exclusive for any phase that produces or mutates that contract
- `tooling:ci`, `tooling:lint`, `tooling:build` — optional; used when toolchain churn is high
- `release:versioning` — exclusive

**Rule:** overlap in any lock string ⇒ cannot be in same wave execution slot.

---

### 2.6 Reactive/event-driven layer

**Event source of truth (wave-parallel only)**
- `$KILN_DIR/events/events.jsonl` — append-only JSON Lines
- `$KILN_DIR/plans/phase_<ID>_state.md` — existing phase state file (still written; human readable)

**Event schema**
```json
{
  "id": "evt_00001234",
  "ts": "2026-02-19T12:34:56Z",
  "stage": 3,
  "execution_model": "wave_parallel",
  "wave": 2,
  "phase": "P3",
  "type": "task_start|task_success|review_rejected|merge|wave_complete|error|halt|...",
  "actor": "Maestro|Codex|Sphinx|Argus|Hammurabi|Kiln",
  "payload": { "branch": "...", "worktree": "...", "details": "..." }
}
```

**Propagation**
- Phase pipeline steps append events.
- Maestro tails events (or reads the phase state files) and updates:
  - `$KILN_DIR/waves/wave_<NN>.md` status
  - `MEMORY.md` wave cursor fields (see §5)

**Wave completion trigger**
- A wave is complete only when **all phases in the wave are merged** (not merely “review approved”).
- On `wave_complete`, Maestro triggers:
  1) Argus wave integration suite
  2) Merge-conflict prediction for next wave’s phases (early warning)
  3) `wave_start` for next wave (unless halted)

**Error propagation**
- If any phase enters `task_fail` after retries OR exceeds QA cap, Maestro emits:
  - `wave_halt` + `halt` and stops scheduling new phases.
- Other phases in the same wave may continue only if already running; merging is blocked until operator decision (rule in §7).

---

### 2.7 Speculative execution

**Goal:** overlap idle time where upstream is in review but downstream work is mostly independent.

**Eligibility (must all hold)**
1) Downstream phase has all dependencies satisfied **except** one or more edges of `dependency_type: contract` or `dependency_type: both` where upstream is in `review_start` (not failed).
2) Downstream phase locks do not conflict with upstream phase locks.
3) Downstream phase is labeled low-risk by Plato or Maestro heuristic:
   - `kind in {docs, test, refactor}` OR `estimate_hours <= 3` OR `locks` includes no `db:migrations`.

**Cost/benefit threshold**
- Start speculation only if:
```text
expected_saved_hours >= 0.75
and estimated_discard_probability <= 0.25
```
- `estimated_discard_probability` is a simple rule-based score (e.g., review round count already at 2/3 ⇒ high risk).

**Branching model**
- Speculative work is done on `kiln/spec/...` branches in isolated worktrees.
- Speculative branches are never merged directly.
- When upstream merges successfully:
  - Maestro rebases the speculative branch onto the merged base and converts it to a normal phase branch (`kiln/wave-.../phase-...`), then triggers Sphinx review again (fast path).
- If upstream fails review and requires redesign:
  - Speculative branch is discarded (worktree removed, branch deleted) and an event `spec_discarded` is emitted.

---

### 2.8 Sequential fallback with ZERO overhead guarantee

#### Decision boundary (exact)
```js
function shouldUseSequential(dag, phases, operator_chose_sequential) {
  if (operator_chose_sequential) return true
  if (phases.length <= 3) return true
  if (computeDependencyDensity(dag) > 0.70) return true
  return false
}
```

#### “Zero overhead” definition
If `execution_model = sequential` then:
- No DAG is computed or persisted.
- No wave manifests exist.
- No contract directory exists.
- No worktrees directory exists.
- No v3-only event log exists.
- Maestro runs the v0.2.1 loop: phase-by-phase in the main working directory with the existing artifacts only.

#### Proof sketch (behavioral equivalence to v0.2.1)
- The sequential executor is literally the v0.2.1 code path:
  - same phase sizing rules
  - same QA loop cap (3)
  - same branch discipline (`kiln/phase-NN`)
  - same state files (`phase_<N>_state.md`) and memory files
- All v3 additions are gated behind `execution_model == wave_parallel`.
- Therefore sequential mode produces **no additional filesystem artifacts** and triggers **no additional agents** (notably, Hammurabi is not spawned).

---

## 3. **Agent Roster v3**

### 3.1 Table (new/modified/unchanged)

| Alias | Internal Name | Model | Tools | v3 Role |
|---|---|---:|---|---|
| Kiln | orchestrator | Opus 4.6 | (none) | Top-level protocol coordinator, operator I/O |
| Da Vinci | kiln-brainstormer | Opus 4.6 | (none) | Vision/ideation (unchanged) |
| Mnemosyne | kiln-mapper | Opus 4.6 | (none) | Brownfield mapping (unchanged) |
| Confucius | kiln-planner-claude | Opus 4.6 | (none) | Plan draft (unchanged) |
| Sun Tzu | kiln-planner-codex | Sonnet→GPT-5.2 | (none) | Plan draft (unchanged) |
| Socrates | kiln-debater | Opus 4.6 | (none) | Resolve plan disagreements (unchanged) |
| Plato | kiln-synthesizer | Opus 4.6 | (none) | Produces `master-plan.md`; emits `kiln-dag-v1` in wave mode (modified) |
| **Hammurabi** | **kiln-lawgiver** | Opus 4.6 | (none) | **Contract materialization + freeze + mutation evaluation** (new) |
| Scheherazade | kiln-prompter | Sonnet→GPT-5.2 | (none) | Task prompt generation (unchanged) |
| Codex | kiln-implementer | GPT-5.3-codex | (shell) | Implements tasks in isolated worktrees (modified: worktree discipline) |
| Sphinx | kiln-reviewer | Opus 4.6 | (none) | QA gate; contract-aware diff review (modified) |
| Maestro v3 | kiln-phase-executor | Opus 4.6 | **Task** | Executes sequential phases OR wave-parallel waves; manages worktrees/merges (modified) |
| Argus | kiln-validator | Opus 4.6 | (shell) | E2E validation; wave integration testing (modified) |
| Sherlock | kiln-researcher | Sonnet 4.6 | (none) | Research support (unchanged) |

**Task access policy (v3)**
- **Only Maestro v3 has Task access** (same principle as v0.2.1) to preserve strict hierarchical delegation and predictable control flow.

---

### 3.2 New agent spec: Hammurabi (Lawgiver)

**Spawn timing**
- Stage 2, after Plato writes approved `master-plan.md` (and `kiln-dag-v1` if wave-parallel), before any execution begins.

**Inputs**
- `vision.md`
- `master-plan.md` (including DAG block when present)
- Any existing project schemas (if Mnemosyne mapped them)

**Outputs (all under `$KILN_DIR/contracts/`)**
- `openapi/public.v1.json` (OpenAPI 3.1)
- `schemas/*.schema.json` (JSON Schema 2020-12)
- `types/contracts.d.ts` (TypeScript type surface)
- `events/events.v1.json` (event catalog for kiln events + project domain events if needed)
- `LOCK.json` (freeze registry; exact schema in §4)

**Enforcement mechanism**
- Hammurabi writes `LOCK.json` with `status: frozen`.
- Sphinx rejects any phase PR that changes contract artifacts unless it includes an approved Contract Change Request (CCR) and updated `LOCK.json` version bump.

---

### 3.3 Maestro v3 changes (wave coordinator responsibilities)

**In sequential mode**
- Behaves identically to v0.2.1 Maestro.

**In wave-parallel mode**
- Computes (or reads) waves from `kiln-dag-v1`.
- Creates per-phase git branches + worktrees.
- Runs per-phase pipelines in parallel (prompt → implement → review → fix loops).
- Performs pre-merge conflict prediction (`git merge-tree`) before actually merging a phase branch.
- Enforces merge order:
  - dependency order first (topological)
  - then `merge.order_hint`
  - smallest diff first when ties

**No new “Wave Coordinator” agent**
- Maestro v3 is the wave coordinator to keep delegation simple: one Task-holder, one scheduler.

---

### 3.4 Delegation hierarchy (explicit)

```text
Kiln (orchestrator)
└─ Maestro v3 (Task)
   ├─ Da Vinci (Stage 1)
   ├─ Mnemosyne (optional mapping)
   ├─ Confucius + Sun Tzu (parallel planners)
   ├─ Socrates (debate)
   ├─ Plato (synthesis)
   ├─ Hammurabi (contracts; wave mode only)
   ├─ For each phase in execution:
   │   ├─ Scheherazade (prompt)
   │   ├─ Codex (implement in worktree)
   │   └─ Sphinx (review + gate)
   └─ Argus (validation; plus wave integration in wave mode)
```

**Rule:** no agent other than Maestro v3 may spawn sub-agents.

---

## 4. **Contract System**

### 4.1 Formats and locations
All contracts live under `$KILN_DIR/contracts/` (where `$KILN_DIR = $PROJECT/.kiln`):

- `$KILN_DIR/contracts/openapi/*.json` — OpenAPI 3.1 (external/public APIs)
- `$KILN_DIR/contracts/schemas/*.schema.json` — JSON Schema 2020-12 (internal DTOs, config, persistence shapes)
- `$KILN_DIR/contracts/types/contracts.d.ts` — TS declarations derived from OpenAPI + JSON Schema
- `$KILN_DIR/contracts/events/events.v1.json` — canonical event catalog
- `$KILN_DIR/contracts/LOCK.json` — freeze registry
- `$KILN_DIR/contracts/requests/` — Contract Change Requests (CCR)

**Contract IDs**
- Dotted, stable identifiers: `api.public.v1`, `db.schema.v1`, `dto.user.v1`, `events.kiln.v3`
- IDs appear in DAG nodes (`contracts.consumes/produces`) and in `LOCK.json`.

---

### 4.2 `LOCK.json` schema (exact)

```json
{
  "version": 1,
  "status": "draft|frozen",
  "frozen_at": "2026-02-19T00:00:00Z",
  "frozen_by": "Hammurabi",
  "execution_model": "wave_parallel",
  "contracts": [
    {
      "id": "api.public.v1",
      "kind": "openapi|jsonschema|ts|events",
      "path": "openapi/public.v1.json",
      "sha256": "<hex>",
      "semver": "1.0.0",
      "owners": ["P0", "P2"],
      "dependents": ["P3", "P4"]
    }
  ],
  "change_control": {
    "ccr_required": true,
    "ccr_dir": "requests",
    "approved_ccrs": [
      {
        "ccr_id": "CCR-20260219-001-auth-refresh",
        "approved_at": "2026-02-19T12:00:00Z",
        "approved_by": "Kiln"
      }
    ]
  }
}
```

**Freeze semantics**
- When `status=frozen`, any change to files listed in `contracts[]` is forbidden unless:
  1) a CCR exists and is approved
  2) Hammurabi updates `LOCK.json` (new sha256 + semver bump)

---

### 4.3 Hammurabi workflow (step-by-step)
1) Read `vision.md` and `master-plan.md` (and DAG if present).
2) Identify contract surfaces implied by the plan:
   - external API endpoints
   - internal module boundaries
   - DB schema/migrations
   - event types
3) Emit initial contract artifacts into `$KILN_DIR/contracts/` (status `draft`).
4) Run self-consistency checks:
   - OpenAPI ↔ JSON Schema references valid
   - TS types generated/consistent
   - Contract IDs match DAG usage
5) Present operator preview summary (via Kiln/Maestro message).
6) On operator approval, write `LOCK.json` with `status=frozen` + checksums.
7) Emit event `contract_freeze_at`.

---

### 4.4 Contract mutation protocol (CCR)

**Request format**
- File: `$KILN_DIR/contracts/requests/CCR-<YYYYMMDD>-<NNN>-<slug>.md`
- Contents: markdown with a required YAML frontmatter:

```yaml
id: "CCR-20260219-001-auth-refresh"
requested_by: "Codex"
phase: "P3"
contracts:
  - id: "api.public.v1"
    change_type: "additive|breaking|clarification"
reason: "<why needed>"
impact:
  affected_phases: ["P4", "P5"]
  risk: "low|medium|high"
proposal:
  summary: "<what changes>"
```

**Evaluation + approval flow**
1) Implementer (Codex) opens CCR instead of changing contracts.
2) Maestro pauses the phase at a decision boundary and spawns Hammurabi to evaluate.
3) Hammurabi produces:
   - compatibility assessment (additive vs breaking)
   - required semver bump
   - dependent phases impact list
4) Kiln (operator-facing) requests approval:
   - approve / reject / defer to re-plan
5) If approved:
   - Hammurabi updates contract files + `LOCK.json` (new sha + semver bump)
   - Maestro re-schedules affected phases (may require wave recomputation if edges/locks change)
6) If rejected:
   - phase must refactor to comply with frozen contracts or escalate to full re-plan

**Propagation rule**
- Approved contract changes require:
  - updating DAG `contracts.consumes/produces` if new IDs are introduced
  - notifying dependent phases (their prompts must be regenerated)

---

### 4.5 Contract enforcement in QA (Sphinx)
Sphinx review checklist (wave mode):
- Verify no contract file drift unless CCR approved.
- Verify outputs conform to contracts (e.g., endpoint responses match OpenAPI).
- Verify migrations comply with `db.schema.v1` schema rules.
- Verify events emitted match `events.v1.json`.
- Reject if:
  - contract file changed without CCR
  - contract produced by phase differs from frozen hash without lock update

---

## 5. **Memory Schema v3**

### 5.1 `MEMORY.md` new fields (exact names/types/enums)

Kiln memory remains the single source of truth, but v3 adds a machine-readable YAML block near the top:

```yaml
kiln_memory_v3:
  session_id: "<uuid>"
  project_path: "<string>"
  stage: 1|2|3|4|5
  execution_model: "sequential"|"wave_parallel"

  # DAG / waves (wave mode only)
  dag_computed_at: "<ISO-8601>"|null
  dag_hash: "<sha256>"|null
  wave_number: <int>|null            # 1-based
  wave_total: <int>|null
  wave_status: "pending"|"running"|"halted"|"complete"|null
  wave_manifest_dir: ".kiln/waves"   # constant in wave mode
  worktrees_dir: ".kiln/worktrees"   # constant in wave mode

  # Contracts (wave mode only)
  contract_freeze_at: "<ISO-8601>"|null
  contract_lock_path: ".kiln/contracts/LOCK.json"|null

  # Resume cursors
  last_event_id: "<string>"|null
  last_successful_merge: "P3"|null
  completed_phases: ["P0","P1"]      # authoritative list
  in_progress_phases: ["P2"]
  failed_phases: ["P4"]

  # Operator choices
  operator_chose_sequential: <bool>
  speculation_enabled: <bool>
```

**Note:** in sequential mode, all wave/contract fields must remain `null` or empty.

---

### 5.2 Wave state storage (`$KILN_DIR/waves/`)
Wave manifests exist only in wave-parallel mode:

- `$KILN_DIR/waves/wave_01.md`
- `$KILN_DIR/waves/wave_02.md`
- `$KILN_DIR/waves/wave_<NN>_integration.md`

**Wave manifest format (exact)**
Each `wave_<NN>.md` begins with:

```yaml
wave_manifest_v1:
  wave: 1
  status: "pending"|"running"|"halted"|"complete"
  phases: ["P0","P1"]
  started_at: "<ISO-8601>"|null
  completed_at: "<ISO-8601>"|null
  locks_union: ["db:migrations", "path:.../**"]
  branches:
    P0: "kiln/wave-01/phase-P0"
    P1: "kiln/wave-01/phase-P1"
  worktrees:
    P0: ".kiln/worktrees/wave_01/phase_P0"
    P1: ".kiln/worktrees/wave_01/phase_P1"
  merge_order: ["P0","P1"]
  qa:
    rounds_cap: 3
  integration_report: "wave_01_integration.md"
```

---

### 5.3 Resume algorithm (mid-wave)
`/kiln:resume` does:

1) Read `MEMORY.md` YAML block.
2) If `execution_model=sequential`:
   - resume v0.2.1 phase loop from last phase state file.
3) If `execution_model=wave_parallel`:
   - load current `wave_<NN>.md`
   - scan per-phase state files for terminal events (`merge`, `halt`, `task_fail`)
   - recompute phase sets:
     - completed = merged phases
     - in-progress = phases with active worktrees/branches and no terminal event
     - failed = phases with `task_fail` or QA cap exceeded
4) Restart only:
   - failed phases (fresh worktree from their branch head or from base if corrupted)
   - in-progress phases only if they were interrupted (idempotent prompts; re-run review gate)
5) Never re-run merged phases; treat merges as authoritative.

**Avoiding re-runs**
- “Merged” is defined by the presence of a `merge` event plus branch merge metadata recorded in phase state; if missing, Maestro verifies via git history before deciding.

---

### 5.4 Archive structure (v3 changes)
Sequential mode: unchanged (`$KILN_DIR/archive/phase_<NN>/...`).

Wave mode adds grouping:
- `$KILN_DIR/archive/wave_<NN>/phase_<PHASE_ID>/`
  - `prompt.md`
  - `outputs/`
  - `reviews/review_round_1.md` …
  - `contracts_snapshot/LOCK.json`
  - `merge_meta.json`
- `$KILN_DIR/archive/wave_<NN>/integration.md`

Contract snapshots:
- On wave start and wave complete, copy `LOCK.json` + contract artifacts into the wave archive snapshot directory.

---

## 6. **Slash Commands v3**

### 6.1 `/kiln:start` (MODIFIED)
New operator decision points after master plan approval:

1) **DAG preview (wave mode only)**
- Kiln shows:
  - Mermaid DAG (rendered as text block)
  - ASCII wave breakdown, e.g.:
    - `Wave 1: P0`
    - `Wave 2: P1, P2 (parallel)`
    - `Wave 3: P3`
2) **Execution model confirmation**
- If eligibility says sequential fallback, Kiln shows:
  - “Auto-selected sequential (≤3 phases or density >70%). Override to wave-parallel? (y/N)”
- If eligibility says wave-parallel, Kiln shows:
  - “Wave-parallel recommended. Force sequential? (y/N)”
3) **Walking skeleton**
- In wave-parallel mode, Phase 0 is shown explicitly and must be approved as a concept before execution.
4) **Contract preview**
- Kiln shows which contracts Hammurabi will generate (IDs + short description) and asks for approval to freeze.

---

### 6.2 `/kiln:resume` (MODIFIED)
- Detects new states:
  - `mid-wave`: some phases merged, some running, some pending
  - `wave_halted`: at least one failed phase
- Displays:
  - current wave number/total
  - per-phase status (merged / in-progress / failed / pending)
- Offers operator actions:
  - “Restart failed phases”
  - “Disable speculation and resume”
  - “Escalate to re-plan” (returns to Stage 2)

---

### 6.3 `/kiln:reset` (MODIFIED)
Sequential reset: unchanged.

Wave mode reset additionally:
- Removes `$KILN_DIR/waves/`, `$KILN_DIR/contracts/`, `$KILN_DIR/worktrees/`, `$KILN_DIR/events/`
- Prunes `kiln/wave-*` and `kiln/spec/*` branches (with operator confirmation)
- Clears wave fields in `MEMORY.md`

---

## 7. **Protocol Rules v3** (numbered; tagged)

1. [UNCHANGED] No `/compact`; context managed via memory + resumes.  
2. [MODIFIED] Memory files remain source of truth; wave mode adds structured YAML in `MEMORY.md`.  
3. [UNCHANGED] Only Maestro may spawn sub-agents (Task tool access remains exclusive).  
4. [MODIFIED] Phase sizing remains 1–4 hours, but wave mode prefers smaller phases to maximize parallel value.  
5. [UNCHANGED] QA cap: max 3 review rounds per phase.  
6. [UNCHANGED] Debate mode default: Focused (mode 2).  
7. [MODIFIED] Git discipline:  
   - Sequential: `kiln/phase-NN` branches.  
   - Wave: `kiln/wave-NN/phase-Pi` + isolated worktrees; merge in dependency order; smallest diff first.  
8. [UNCHANGED] No judgment calls during automated execution—escalate to operator.  
9. [UNCHANGED] Agents terminate after completion.  
10. [UNCHANGED] Timeouts: minimum 600s for Codex CLI invocations.  
11. [NEW] Contract-first rule (wave mode): contracts freeze before Phase 0 starts; no contract drift without CCR + approval.  
12. [NEW] Wave scheduling rule: phases run in parallel iff DAG-ready **and** no lock conflicts.  
13. [NEW] Merge gating rule: review happens before merge; wave integration tests happen after all merges in wave.  
14. [NEW] Wave failure rule: if any phase fails, wave is halted; merges are paused pending operator decision (continue merges already approved vs stop).  
15. [NEW] Re-plan triggers: CCR rejected, breaking contract change needed, repeated wave halts, or DAG invalidation ⇒ return to Stage 2.  
16. [NEW] Speculation limits: at most 1 speculative phase per active wave; never speculate `db:migrations` phases.  

---

## 8. **Quality System v3**

### 8.1 Per-phase review
- QA cap stays at 3 rounds (unchanged).
- Sphinx becomes contract-aware (wave mode) and must validate:
  - contract compliance
  - CCR compliance for contract diffs
  - lock discipline (no cross-phase contamination)

### 8.2 Wave-level integration testing (new)
After all phases in a wave merge:
- Argus runs:
  1) smoke tests (fast)
  2) contract validation (hashes match LOCK; OpenAPI/Schema lint)
  3) targeted integration suite (project-defined)
- Output: `$KILN_DIR/waves/wave_<N>_integration.md`
- If integration fails:
  - wave status becomes `halted`
  - next wave does not start

### 8.3 Cross-wave regression detection
- After Wave N+1 completes integration, Argus re-runs Wave N’s “contract + smoke” subset.
- Report appended to Wave N+1 integration report with regression summary.

### 8.4 Speculative failure handling (rollback)
- Speculative work is isolated in:
  - speculative branch + speculative worktree
- On discard:
  - delete worktree directory
  - delete speculative branch
  - emit `spec_discarded` event
- If partial work is worth salvaging, operator may request “convert to proposal” (docs only) but it cannot merge without rebase + re-review.

---

## 9. **Walking Skeleton**

### 9.1 Should Phase 0 be formal?
**Yes (in wave-parallel mode).**  
Rationale: wave-parallel multiplies integration risk; a thin E2E spine gives immediate confidence and stabilizes contracts/tooling before parallel widening.

### 9.2 Placement in pipeline
- After Stage 2 approvals + contract freeze, before any other phase:
  - Phase 0 (`P0`) must be the unique root node (no incoming edges).

### 9.3 Skeleton scope (thin E2E)
Minimum, project-dependent but standardized targets:
- One runnable entrypoint (server/app/cli)
- One representative API endpoint or UI route
- One DB table/collection (if DB is in scope) + migration baseline
- CI config + lint/test harness
- One smoke test that exercises the full path

### 9.4 How Plato specifies it
Plato must include in `P0`:
- explicit outputs list (paths)
- locks: `tooling:ci`, `path:<entrypoint subtree>`, `db:migrations` if applicable
- contracts produced: at least `events.kiln.v3` and any public API contract if relevant

### 9.5 DAG integration
- `P0` is the root; all other phases must (directly or indirectly) depend on `P0` with `dependency_type: code|both` to ensure the skeleton actually exists before widening.

### 9.6 Operator approval
- `/kiln:start` presents P0 summary; operator can:
  - approve as-is
  - request modifications (returns to Stage 2 synthesis edit)
  - force sequential (disables P0 entirely)

---

## 10. **Simple Project Guarantee**

### 10.1 Exact sequential fallback algorithm
```js
function computeDependencyDensity(dag) {
  const N = dag.nodes.length
  const maxE = (N * (N - 1)) / 2
  if (maxE === 0) return 0
  return dag.edges.length / maxE
}

function shouldUseSequential(dag, phases, operator_chose_sequential) {
  if (phases.length <= 3) return true
  if (computeDependencyDensity(dag) > 0.70) return true
  if (operator_chose_sequential) return true
  return false
}
```

### 10.2 File audit: new v3 artifacts (and how sequential skips them)
New in wave-parallel only:
- `$KILN_DIR/contracts/` (Hammurabi outputs + `LOCK.json`)
- `$KILN_DIR/waves/` (wave manifests + integration reports)
- `$KILN_DIR/worktrees/` (git worktree directories)
- `$KILN_DIR/events/events.jsonl` (structured event log)
- `$KILN_DIR/archive/wave_<NN>/...` (wave grouping)

**Sequential mode gating**
- If `execution_model=sequential`, the orchestrator MUST NOT create any of the above paths.
- Maestro uses the v0.2.1 phase loop and writes only the v0.2.1 artifacts (memory files, `.kiln/plans/`, `.kiln/prompts/`, `.kiln/reviews/`, `.kiln/outputs/`, `.kiln/archive/phase_<NN>/`).

### 10.3 Operator experience when fallback triggers
- Not silent. Kiln prints a one-paragraph explanation including concrete values:
  - `phases = 3` OR `dependency_density = 0.82`
- Operator can override to wave-parallel, but must explicitly confirm:
  - “This adds wave/contracts/worktrees complexity. Proceed? (y/N)”

---

## 11. **Implementation Roadmap** (ship order)

1) **DAG embedding + parsing**
- Teach Plato synthesis step to optionally emit `kiln-dag-v1`.
- Add parser/validator for the DAG block (cycle check, missing nodes, lock format).

2) **Sequential fallback router (hard guarantee)**
- Implement `shouldUseSequential` and enforce artifact gating at the top of Stage 3.

3) **Hammurabi contracts MVP**
- Generate minimal OpenAPI/Schema/TS + `LOCK.json`.
- Integrate Sphinx contract-awareness checks (reject drift without CCR).

4) **Wave manifests + memory fields**
- Add `MEMORY.md` YAML block writer/reader.
- Add `$KILN_DIR/waves/wave_<NN>.md` generation from computed waves.

5) **Worktree-based parallel execution**
- Implement worktree creation per phase branch.
- Update Scheherazade/Codex prompts to constrain work strictly to the worktree path.
- Add merge conflict prediction (`git merge-tree`) before merges.

6) **Wave scheduler + event log**
- Implement event JSONL append + wave status transitions.
- Ensure `/kiln:resume` can reconstruct state from memory + manifests + phase states.

7) **Wave-level integration gates**
- Extend Argus to run wave integration checks and write `wave_<N>_integration.md`.

8) **Speculative execution (optional flag)**
- Implement eligibility checks, speculative branches, discard/convert logic.
- Default speculation OFF until stability proven.

9) **Hardening + operator UX**
- DAG preview (Mermaid + wave breakdown).
- Clear operator prompts for CCR approvals, wave halts, and resumes.

If you want, I can also provide a concrete “v3 state machine” diagram (states + transitions) that matches the event types and resume logic exactly.