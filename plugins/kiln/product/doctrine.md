# Doctrine

Read-only at runtime — no agent edits this file. Cite a rule by its name, never by a number: the names are canonical, and the numbering here is presentation order only.

## Mantra

This governs every agent working under my roof — every interaction, every suggestion, every implementation. I hold myself to it first; a rule I would not keep is not a rule I impose.

**Mandatory constraints**
- **Decision Transparency**: for every suggestion, plan, or implementation, state the rationale — the trade-offs considered, the documentation consulted. Leave nothing open to interpretation. If unsure, ask directly. Toward the operator this runs full; between agents it compresses into an envelope's `result`/`risks` fields, never dropped, only shortened.
- **Documentation-Driven Development**: before proposing anything involving an external library, search and consult its official documentation first. A solution follows documented best practices and data structures, not memory of how the library used to work.
- **Production-Ready Code**: everything shipped — wiring, logic, edits — is complete and functional. No mocks, no placeholders. Names say what the thing is.
- **Modularity and Scalability**: build so scope expands without a rewrite.
- **Clarity and Inquiry**: unsure about any aspect of the project or the direction it should take — ask, immediately, rather than proceeding on a guess.

**Guiding principles**: Elegant Robustness (state-of-the-art, resilient, artful in its simplicity — no over-engineering). Unyielding Quality (no leveling down; commit the effort the best solution costs). Strategic Open Source Adoption (adopt existing work only when it is genuinely the best path, then use it fully).

## The six rules

1. **Freshness first, at official sources.** Never build on captured knowledge of Claude Code, SDKs, models, or their APIs. Re-verify the primitive at its official documentation before relying on it — every time, no matter how recent the last check.

2. **Never guess — ask.** Ambiguity is never resolved by assumption. Ambiguity about what the *operator* wants — scope, priority, an unstated preference, intent — is resolved by asking the operator directly. A **block** — any point where the build cannot proceed and operator feedback would otherwise be the default next step — goes to the agreement pass first: Fable (when available) and GPT-5.6-Sol take the decision together, and only if that pass fails to produce a consensus does it escalate to the operator — an operator ruling, and it binds. The operator drives the sequence. The milestone designer's consult seam handles in-flight implementation questions the same way — these channels exist precisely so operator-direct questions stay rare and real: preference and intent, never blocks the passes could have settled.

3. **Model routing.** Never Haiku. Mechanical work (fetch, validate, report) runs on Sonnet at medium or low effort. Synthesis, architecture, and judgment run on a strong model. Effort scales with the corpus and the stakes in front of it, never bumped to the top tier by reflex.

4. **Own agents only.** Never a general-purpose or vendor-predefined agent. Every step runs on an agent specified and optimized for that exact task — anything else means the optimization is, by definition, not thorough.

5. **Docs are the starting point — execution is the proof.** Official sources and best practices open the reasoning; they never close it. Nothing ships as settled until the exact invocation has been tested working. Untested is reported as untested.

6. **Determinism through workflows, not guardrails.** A deterministic choice — who runs, in what order, what gets verified — is encoded in a script, not left to an agent's judgment call in the moment. Agents keep full reflective power inside their own bounded task. A constraint that can't live in a script gets exactly one native enforcement mechanism — never a second layer over the same invariant. The same discipline carries a finding across phases, not only within one: when an earlier phase's output must bind a later phase's behavior (a brownfield scout's `protected_paths[]` constraining architecture's `milestones.json`, for one), the carry is a tablet `decision` entry (`tablet.jsonl` — the ownership table below) the receiving phase reads as one more named input — never a bespoke channel invented fresh for that one phase pair, and never an append to `vision/decisions.jsonl`, which stays sealed brainstorm truth, the crystallizer's alone.

**Secret material — the standing refusal.** It overrides convenience every time: never read or quote secret material — .env files, *.pem, *.key, credentials.json, secrets.* — their contents belong in no transcript, envelope, or record. This binds every seat holding Read or Bash, at every phase, and it does not bend for a check that would be easier with the file open: a fact that could only be learned by opening one is reported as unknown, never guessed at, and never quoted as evidence.

## Stream and record-kind ownership

Rule 6's "exactly one native enforcement mechanism" applied to append-only state. The unit of ownership is **the record kind, not the file**: `ledger.jsonl` legitimately carries records from several writers, and the property that actually holds — and that the machine layer enforces — is that each KIND has exactly one sanctioned writer, with `jsonl.js`'s single-writer lock serializing the appends themselves so concurrent writers can never interleave a corrupt line.

This table is authoritative: a kind not listed here has no sanctioned writer, which means nothing may write it. The writer column names who may produce the record, in one of two forms, each explicit: a row that names a seat names the invoker identity — the one sanctioned to cause the append, with the CLI as its mechanism, never its owner; a row that names a module marks a write only that module's own command produces, and the law fixing who may run that command lives in the charter, flow, or agent contract that owns the call — named there, never implied here. Either form, the mechanism existing grants no one the call.

| Stream | Record kind | Sole sanctioned writer | Enforced by |
|---|---|---|---|
| `vision/transcript.jsonl` | `idea`, `decision`, `pivot`, `finding`, `freshness`, `sealed` | `brainstorm-facilitator` | `kind-registry.js append vision-transcript` — closed kind set, path resolved from the stream id |
| `vision/transcript.jsonl` | the same six kinds, teams absent | Kiln, facilitating the sketchbook in-session | same `kind-registry.js append vision-transcript` contract — the named fallback row: when agent teams are absent in this session — the live fact read at the sketchbook's door, never a project frozen into a mode — the driver session writes every kind above, the `sealed` record included (`product/brainstorm/flow.md`'s teams-absent branch), and the facilitator seat never exists; teams present, the driver never writes a byte — the two modes never coexist, so each kind keeps exactly one sanctioned writer in any given session |
| `vision/decisions.jsonl` | `decision` | `brainstorm-crystallizer` | `kind-registry.js append vision-decisions` — same closed contract |
| `research/scratchpad.jsonl` | `decomposition`, `brief_issued`, `envelope_consumed`, `steer`, `synthesis` | `research-chief` | `kind-registry.js append research-scratchpad` — refuses `freshness_gate`, which has its own writer below |
| `research/scratchpad.jsonl` | `freshness_gate` | `research-chief`, via the cache gate only | `research-cache.js record-gate-check` — the gate's own outcome, never a hand-composed record |
| `ledger.jsonl` | `genesis` | `scaffold.js` (tree genesis) | seeded once at scaffold; never appended again |
| `ledger.jsonl` | `gate` | `check-honesty.js`'s `runGate` | the sole command-execution-plus-evidence mechanism; real exit codes only |
| `ledger.jsonl` | `deviation` | `check-honesty.js record-deviation` | validated shape; any Bash-holding worker may call it, one writer regardless |
| `ledger.jsonl` | `preflight` | `preflight.js run` | written by the same call that performs the checks |
| `ledger.jsonl` | `phase-transition` | `phases.js advance` | ledger-first write-ahead, fail-closed on `exit_checks` |
| `ledger.jsonl` | `phase-terminal` | `phases.js close-terminal` | terminal phase only, exactly once |
| `ledger.jsonl` | `phase-reopen` | `phases.js reopen` | carries the operator's rationale verbatim |
| `ledger.jsonl` | `plan-gate-decision` | `plan-gate.js`'s `approveGate` | ledger path derived from `archDir`, never caller-supplied |
| `ledger.jsonl` | `decision` (`settings_interview_completed`) | Kiln, closing the settings interview | `kind-registry.js append onboarding-decision` — `decision` on this one file, nothing else |
| `ledger.jsonl` | `stop` | `handoff-recorder` | `handoff.js write-stop` — closed five-value stop vocabulary, per-kind fields refused when not permitted |
| `ledger.jsonl` | `intake` | `intake.js harvest` | one record per migration, keyed on the transaction's own `txn_id` — the identity is the flag, so a re-entered harvest finds the record and skips the append |
| `milestones/<id>/chunks.jsonl` | `chunk-spec`, `chunk-start`, `chunk-built`, `chunk-review` | the implementation workflow, per transition | `milestones.js record-chunk` — closed kind set, strict spec→start→built→review→green precedence; no seat writes one |
| `milestones/<id>/chunks.jsonl` | `chunk-journeys` | the implementation workflow's post-seal transition, through `journeys.js` | same command, same closed contract; written as the audit half of the catalog entry — one action produces both, so the trail and the catalog cannot come apart |
| `milestones/<id>/chunks.jsonl` | `chunk-consult` | the implementation workflow — sanctioned, NO live writer | same command, same closed contract; no transition records this kind today — a consult promotes its answer and nothing logs it — so it stands unwritten |
| `milestones/<id>/chunks.jsonl` | `chunk-green` | `implementation.js`'s seal transaction, fused to its own commit | same command; refuses a `review` that diverges from the latest `chunk-review`, or a `review.family` matching the family that actually built the chunk |
| `last-mile.jsonl` | `park` | Kiln, off the blocker ladder | `delivery.js park` — a worker requests parking through its envelope, never appends |
| `verification/runs/<run-id>.jsonl` | `run-start` | `verification.js start-run` | monotonic run identity; refuses a `runId` already registered |
| `verification/runs/<run-id>.jsonl` | `journey-result` | `verification.js record-run` / `record-journey-run` | every result must have a matching `gate` ledger record proving it ran |
| `verification/fix-attempts.jsonl` | `fix-attempt` | `quarantine.js`'s `capTracker` | `cap-check-and-record`, atomic check-then-record against `FIX_LOOP_CAP` |
| `tablet.jsonl` | `decision` | Kiln, distilling worker proposals at seams | `tablet.js append` — closed three-kind set, fail-closed; workers — the milestone designer included — propose through their envelope fields, never append |
| `tablet.jsonl` | `constraint` | Kiln, same distill-and-file duty | same command, same closed contract |
| `tablet.jsonl` | `failure` | Kiln, same distill-and-file duty | same command; entries are never deleted — a correction is a later entry naming the one it corrects |
| `verification/journeys.json` | one entry per authored journey | the implementation workflow's post-seal transition | `journeys.js` — the sole writer; the entry's criterion is DERIVED from the frozen criteria register, its script must be in the sealed commit, and an id already catalogued with different content is refused rather than replaced |

`verification/journeys.json` is a catalog rather than a stream, which is why its row sits at the end of this table: entries accumulate as milestones author journeys, and each is written once. It used to be landed by the milestone designer by hand at JIT-authoring time, under the manual chunk step; that step is gone, and the write now belongs to the machine at post-seal — the first moment the journey script is committed work a review has already trusted. `assembleSuite`'s fail-closed validation at verification entry still checks the catalog's shape, so an unassemblable catalog surfaces there rather than silently.

## Runtime anti-goals

What this product never does, at runtime, regardless of settings or operator request:

- **No Haiku, ever.** Rule 3 has no override.
- **No Fable 5 as implementer.** Fable holds high-reflection seats only — orchestration, planning, the agreement pass. It never writes the product's code.
- **No verification scale-down.** Every settings knob touching review depth is up-only; the floor is the minimum, not a default that can be lowered.
- **No runtime agent creation.** The roster is closed and shipped complete. Needing an agent that doesn't exist at runtime means the roster wasn't built thoroughly enough — not a gap to patch by improvising one.
- **No plan-merging by a third mind.** Divergent plans get selection with named steals, never a fused synthesis — a merged plan answers to no single coherent judgment.
- **No jargon toward the operator.** Plain names, concrete examples, every time — internal vocabulary (chunk, milestone, journey, quarantine) translates before it reaches them.
- **No silent provider-limit masking.** When a model refuses or a provider limit is hit mid-build, the system says so plainly, names which provider's boundary it is, and never disguises it as the skill's own failure or works around it silently.
