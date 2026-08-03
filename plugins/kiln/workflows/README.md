# The workflows

A workflow script is the ORDER of a phase. It decides nothing about what should
happen — `machine/src/spine.js` does that — and it holds no state between calls.
It asks what the next transition is, performs exactly that one transition, records
it durably, and returns.

Seven phases, seven scripts. Only `implementation.js` exists today; the rest land
with the slices that own them, against this same contract.

| script | phase | status |
| --- | --- | --- |
| `implementation.js` | implementation | executable; walked end to end by the suite, not yet by the real runtime |
| `research.js` | research | not yet written |
| `architecture.js` | architecture | not yet written |
| `plan-gate.js` | plan gate | not yet written |
| `verification.js` | verification | not yet written |
| `delivery.js` | delivery | not yet written |
| `brainstorm-close.js` | brainstorm close | not yet written |

**What "executable" claims, and what it does not.** `machine/test/implementation-workflow.test.js`
loads `implementation.js` off disk and runs it — its real form, its real payloads, against a
real repository, through the real machine facade, including a kill-and-rerun at every rung.
That is what the table above means. It is a faithful stand-in for the Workflow runtime and
not the runtime itself: that the real runtime accepts this file, that `agentType` resolves
these seats with their fences intact, and that `schema` shapes a real model's reply are
established for two seats by the S0 spike and otherwise wait on the live run. The header of
that test file states the split in full.

## The runtime contract

**One durable transition per invocation.** A script performs a single transition
and returns. It does not loop, does not wait, and does not perform "just the next
one too" because the next one is obvious. The fire's rhythm — call, read the
return, say a line, call again — is the engine's normal operation, and it is also
where operator steering and consults get their seam. A script that ran two
transitions would close that seam for the second one.

**No filesystem.** The Workflow runtime cannot read or write files. Every machine
operation goes through the `workflow-hands` agent, which calls
`machine/src/workflow.js#invoke` with one op name and its arguments. That facade's
op table is the complete list of what a workflow can reach; a machine function
that is not in it is out of reach by construction, not by convention.

**No policy.** If a script needs a branch that the resolver could have decided,
the branch belongs in the resolver — `machine/src/spine.js` for implementation.
What a script may branch on is which transition it was handed; that is a
dispatch table, not a decision.

**Every agent step is a dispatch.** A seat is never simply called. The C1 native
pair opens a dispatch receipt, the step runs, and a terminal closes it — which is
what makes an interrupted step recoverable, and what gives the transition a
durable ref inside the receipt grammar. Steps are bound to their seat with
`agentType`, so the seat's own tool fences travel with them, and carry a `schema`,
so what comes back is structurally guaranteed rather than hoped for.

**Arguments arrive as a string.** The Workflow tool passes its argument payload as
text; a script parses it once, at the top, and works with the parsed object after.

**Forbidden mechanisms.** No `SendMessage`, no `TaskStop`, no `pgrep`, no `ps`, no
sentinel files, no polling loop, no `codex ... resume`. A workflow that needs to
know whether something finished reads the durable record that says so. These are
greppable absences, checked by the suite, because "we don't do that here" is worth
nothing if only prose says it.

**Every durable transition is followed by `views.regenerate`.** Views are derived
and idempotent, so a crash between the transition and the regeneration costs
nothing: the next invocation regenerates before it resolves, and the views
converge on what the streams already say.

**The consult contract.** A worker's question reaches this workflow as a staged
consult request; the resolver derives a pending consult from that request and
the absence of its promoted answer, and nothing else is part of the contract.
Every seat this phase dispatches now instructs exactly that shape — the five
that can ask (both implementers, both chunk reviewers, and the milestone
reviewer) write `staging/consult-request/<milestone-id>/<consult-id>.json` and
end their step; the designer answers as its own later step. Nothing waits and
nothing is delivered, which is what lets the seam survive a session that dies
between the question and the answer.

## The return enums

Every invocation returns one of five values, and each one carries a `record_ref`
that RESOLVES — `ledger:<seq>` or `envelope:<phase>/<id>`, the only two forms the
receipt grammar has. That is enforced rather than promised: the invocation's own
`workflow-return` record is refused if its ref resolves to nothing. A transition
whose result is a canonical artifact and a git commit rather than a ledger record
— opening a milestone, closing one — writes an envelope and cites that; a stop
with no record of its own raises a hold and cites that. The fire narrates from
the record, never from the script's own account of itself.

| return | means | the fire's next move |
| --- | --- | --- |
| `beat` | one transition landed; there is more to do | say the beat, call again |
| `phase_complete` | the phase's work is finished | advance |
| `operator_needed` | a decision belongs to the operator | put the question to them |
| `needs_consult` | a worker asked its designer something, and this invocation answered it | say the beat, call again — the asking work resumes with the answer on disk |
| `blocked` | a gate or a refusal stops progress here | say what blocked it, and why |

`blocked` is not an error. It is the machine reporting, with a record ref, that
the next thing cannot lawfully happen yet — a red preflight, a red regression
floor, a refusal from a transaction. An error is a script that threw.
