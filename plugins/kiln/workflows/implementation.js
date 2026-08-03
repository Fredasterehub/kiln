// implementation.js — the implementation phase's order, and none of its
// judgment.
//
// THE RUNTIME FORM. This is a Workflow script, not a module: `meta` is
// exported, and everything below it executes at TOP LEVEL with `await`. There
// is no `run()` to call and nothing to require it — a script written as a
// CommonJS module is a file the runtime never executes, which is exactly how a
// green suite once coexisted with a phase that could not run at all.
//
// ONE DURABLE TRANSITION PER INVOCATION. The script asks
// `machine/src/spine.js` what that transition is, performs exactly that, and
// returns. Every branch below is a dispatch on the name the resolver already
// chose; there is no decision in this file, and if one ever appears here it
// belongs in the resolver instead.
//
// NO FILESYSTEM. The runtime cannot read or write files, so every machine
// operation goes through the `workflow-hands` seat, which runs one command
// against `machine/src/workflow.js` and reports what came back. The payload
// travels to that command on stdin through a quoted heredoc, so no canonical
// value is ever interpolated into shell quoting.
//
// EVERY AGENT STEP IS A DISPATCH. A seat is never simply called: the C1 pair
// opens a dispatch receipt, the step runs, and a terminal closes it. That is
// what makes an interrupted step recoverable, what gives every transition a
// durable ref inside the receipt grammar, and what lets a chunk's attempts be
// counted at all — the chunk lifecycle records one `chunk-start` and no more,
// so the attempts live on the ledger.

export const meta = {
  name: 'implementation',
  description:
    'One durable transition of the implementation phase: resolve what is next from disk, perform exactly that, record it, and hand back a beat.',
  phases: [{ title: 'Resolve' }, { title: 'Transition' }],
}

// The Workflow tool hands its argument payload over as text.
const A = typeof args === 'string' ? JSON.parse(args) : args
const treeRoot = A && A.treeRoot
if (!treeRoot) throw new Error('implementation: this workflow requires a treeRoot')

// What a machine operation answers with. Schema-bound, so a reply is
// structurally guaranteed rather than hoped for.
const HANDS = {
  type: 'object',
  properties: { ok: { type: 'boolean' }, result: {} },
  required: ['ok', 'result'],
}

// What an authoring seat answers with: where it wrote, and under which model.
// The model identity is what a native dispatch's terminal attests, and only
// the step that ran can say it.
const AUTHORED = {
  type: 'object',
  properties: {
    wrote: { type: 'boolean' },
    model_id: { type: 'string' },
    summary: { type: 'string' },
  },
  required: ['wrote', 'model_id', 'summary'],
}

// What a SOL-HOSTING seat answers with. `hosted_session` is REQUIRED, and that
// is the whole point: a schema that merely permitted it would leave the live
// seat free to omit what the receipt boundary needs, and the attestation would
// be contracted by whatever a test happened to inject rather than by the seat.
// A test may never supply what production must demand.
const HOSTED = {
  type: 'object',
  properties: {
    wrote: { type: 'boolean' },
    model_id: { type: 'string' },
    hosted_session: { type: 'string' },
    summary: { type: 'string' },
  },
  required: ['wrote', 'model_id', 'hosted_session', 'summary'],
}

// The seats that run their model through Codex inside their own turn. Kept
// here as the workflow's own view of the same fact `validators.js` holds, so
// the prompt and the schema agree with the receipt boundary about who can make
// a hosted claim.
const HOSTING_SEATS = ['implementer-sol', 'chunk-reviewer-sol', 'milestone-reviewer']

// Asked of every hosting seat, in the prompt as well as the schema. The
// machine cannot see inside your turn, so the session id of the Codex run you
// hosted is the only evidence that the work was gpt work — and the record that
// decides which family reviews you is written from it.
const HOSTED_ASK = `You run your model through the Codex CLI inside your own turn. Report, in addition to the fields above:
- \`hosted_session\` — the session identity of the Codex run you hosted, exactly as the CLI reported it (the 8-4-4-4-12 hex form).
- \`model_id\` — the model that did the work INSIDE that session, not the model you are dispatching from.

Nothing outside your turn can observe that run, so this is the only evidence it happened. The machine records the family of your work from it, and the cross-family review law is decided on that record. If you did not actually host a Codex run, say so rather than inventing an identity: a wrong session id is worse than an absent one.`

// ---------- the hands ----------

async function hands(op, opArgs, label) {
  const payload = JSON.stringify({ treeRoot, op, args: opArgs })
  const reply = await agent(
    `Run exactly one Kiln machine operation and report what it returned.

Run this command, exactly as written. The only thing you supply is the payload line, copied VERBATIM — character for character, on one line — from below:

\`\`\`bash
node "\${CLAUDE_PLUGIN_ROOT}/machine/src/workflow.js" <<'KILN_PAYLOAD'
${payload}
KILN_PAYLOAD
\`\`\`

Never rebuild that line, never reformat it, and never lift its values out into shell quotes — the quoted heredoc marker is what makes the whole block literal, so an apostrophe or a dollar sign inside it is carried through as the byte it is. The command has no argument form; the block is the only way in.

The command prints a single JSON object with \`ok\` and \`result\`. Report those two fields as they came out: \`result\` is the operation's return value when it succeeded, and the refusal's message verbatim when it did not. A refusal is a true answer, not a problem to work around — never retry, never adjust an argument, never summarise.`,
    {
      agentType: 'kiln:workflow-hands',
      model: 'sonnet',
      effort: 'low',
      label: label || op,
      schema: HANDS,
    }
  )
  if (!reply || reply.ok !== true) {
    throw new Error(`implementation: ${op} refused — ${reply ? reply.result : 'the hands returned nothing'}`)
  }
  return reply.result
}

// ---------- a seat, dispatched ----------

// The C1 native pair around one agent step. `dispatchNative` says whether to
// run it at all: an id a dead predecessor opened is closed as abandoned and
// spent, and the step must NOT be re-run under it, because whether it already
// ran is precisely what nobody can know.
async function dispatched(next, seatName, prompt, schema, resultRef, family) {
  const seat = seatName.startsWith('kiln:') ? seatName.slice('kiln:'.length) : seatName
  // WHICH MODE THIS RUN TAKES. A seat that can host is not a run that does:
  // `milestone-reviewer` is native Sonnet on a gpt-dominant milestone and
  // hosted Sol on a claude-dominant one, so the mode follows the family this
  // selection actually resolved to, and the dispatch declares it.
  const hosting = family === 'gpt' && HOSTING_SEATS.includes(seat)
  const executionMode = hosting ? 'hosted' : 'native'
  const opened = await hands(
    'dispatch.dispatchNative',
    [
      treeRoot,
      {
        dispatch_id: next.dispatch_id,
        seat,
        execution_mode: executionMode,
        task_class: next.task_class,
        payload_ref: next.scope_ref,
      },
    ],
    `open:${next.transition}`
  )
  if (opened.state !== 'opened') {
    return { launched: false, ok: false, ref: opened.ref }
  }

  let reply = null
  let failure = null
  try {
    reply = await agent(hosting ? `${prompt}\n\n${HOSTED_ASK}` : prompt, {
      agentType: seatName,
      label: `${next.transition}:${next.chunk_id || next.milestone_id}`,
      // A hosting seat is held to the HOSTED schema whatever the caller asked
      // for, so the live contract and the receipt boundary cannot disagree
      // about what evidence a hosted run owes.
      schema: hosting ? HOSTED : schema,
    })
  } catch (err) {
    failure = String(err)
  }

  // The evidence, or the reason there is none. A step that returned nothing
  // built nothing, whatever it said, and `completeNative` is where that is
  // decided — this only reports what came back.
  const evidence = { dispatch_id: next.dispatch_id }
  if (failure !== null) {
    evidence.reason = failure
  } else if (!reply || reply.wrote !== true) {
    evidence.reason = `the ${seat} step reported that it wrote nothing`
  } else {
    evidence.model_id = reply.model_id
    evidence.result_ref = resultRef
    // A seat that hosted a Sol run says so with the session identity, and the
    // terminal attests gpt on it. Without one the step is what it looks like:
    // a native Claude step.
    if (hosting) evidence.hosted_session = reply.hosted_session
  }

  // THE TERMINAL IS NOT WRITTEN HERE. It is the LAST durable act of a step, so
  // the caller performs its promotion or its export-and-apply first and then
  // calls `closeStep`. That ordering is the whole re-entry contract: a
  // terminal means "this step's output is durable", which is what every
  // downstream rung already assumes when it reads one. Written first, a crash
  // behind it left a completed build with nothing staged.
  return { launched: true, ok: failure === null && reply !== null && reply.wrote === true, evidence, reply }
}

// The last durable act. Everything this step produced is already on disk.
async function closeStep(next, outcome) {
  const terminal = await hands(
    'dispatch.completeNative',
    [treeRoot, outcome.evidence],
    `close:${next.transition}`
  )
  return terminal.ref
}

// Where a seat must write, asked of the module that will later read it. The
// two used to be invented separately and disagreed — a seat told an
// extensionless directory, and a promotion looking for a filename.
async function stagingFor(artifactClass, scope) {
  return await hands('promotion.stagedPathFor', [treeRoot, artifactClass, scope], `staging:${artifactClass}`)
}

// An authoring seat, then a promotion. The seat writes only into staging; the
// machine validates those bytes and moves them into place. That order is what
// keeps "no agent writes a canonical artifact" true by construction rather
// than by instruction.
async function authored(next, seatName, artifactClass, scope, instruction, family) {
  const staging = await stagingFor(artifactClass, scope)
  const outcome = await dispatched(
    next,
    seatName,
    `${instruction}

Write your finished artifact to exactly this path, and to nowhere else:

    ${staging.staged_path}

Nothing you write anywhere else is read by this build, and this file is the only thing that carries your work forward. When it is written, report \`wrote: true\`, the model id you are running as, and a one-sentence summary of what you produced.`,
    AUTHORED,
    staging.staged_ref,
    family
  )
  if (!outcome.launched) return { promoted: null, ref: outcome.ref, ran: false }
  if (!outcome.ok) {
    // The reason is already in hand. Promoting an artifact that was never
    // written would throw, and the dispatch would then be recovered as
    // "abandoned" — a known failure recorded as an unknown one.
    return { promoted: null, ref: await closeStep(next, outcome), ran: false }
  }
  const promoted = await hands('promotion.promoteArtifact', [treeRoot, artifactClass, scope], `promote:${artifactClass}`)
  return { promoted, outcome, ran: true }
}

// Some transitions land their whole result as a canonical artifact and a git
// commit — an index entry, a merge, a tag — and leave no ledger record behind.
// The return contract still needs a durable record to cite, and an envelope is
// exactly the record the machine already has for "one unit of work, and what
// came of it". Its ref resolves like any other, so a stop and a success cite
// the same grammar.
async function recordEnvelope(next, result, artifact) {
  const written = await hands('receipts.writeEnvelope', [
    treeRoot,
    'implementation',
    next.envelope_id,
    {
      state: 'done',
      result,
      evidence: next.reason,
      risks: 'none recorded by this transition',
      artifact,
      question: 'none',
    },
  ])
  return written.ref
}

// ---------- the transitions ----------

async function perform(next) {
  switch (next.transition) {
    case 'apply-steer': {
      const applied = await hands('receipts.writeSteerApply', [
        treeRoot,
        { steer_id: next.steer_id, exit: next.exit, resolution_ref: next.record_ref },
      ])
      return applied.ref
    }

    case 'recover-dispatch': {
      await hands('dispatch.recoverDispatches', [treeRoot])
      return next.record_ref
    }

    case 'open-milestone': {
      await hands('implementation.openMilestoneTxn', [
        treeRoot,
        {
          id: next.milestone_id,
          title: next.title,
          designer_family: next.designer_family,
          toolchain_profile: next.toolchain_profile,
        },
      ])
      return await recordEnvelope(next, `milestone ${next.milestone_id} is open on branch milestone/${next.milestone_id}`, 'milestones/index.json')
    }

    // Probe, scaffold what the probe found missing, then gate on the install
    // command the profile itself composes. The gate record IS the durable
    // result — green or red, the resolver reads the same record.
    // A SATISFIED PROBE INSTALLS NOTHING. Installing anyway was work nobody
    // asked for over a toolchain already present. An UNSATISFIED probe
    // scaffolds, installs, and is then RE-PROBED — and the re-probe is the gate
    // the resolver reads, so "the install exited zero" can never stand in for
    // "the toolchain is actually there". A toolchain still missing after its
    // own install leaves a red gate and blocks, which is the honest outcome.
    case 'toolchain-preflight': {
      const probe = await hands('toolchain.probeSatisfied', [treeRoot, next.profile_id])
      if (probe.satisfied !== true) {
        await hands('toolchain.scaffoldProfile', [treeRoot, next.profile_id])
        const install = await hands('toolchain.composeInstall', [treeRoot, next.profile_id])
        await hands('checkHonesty.runGate', [treeRoot, `toolchain-install:${next.milestone_id}`, install.cmd])
      }
      const gate = await hands('checkHonesty.runGate', [treeRoot, next.gate_id, probe.probe_cmd])
      return `ledger:${gate.seq}`
    }

    // The spec transition lands BOTH halves of the decomposition: the prose a
    // seat reads, and the chunk plan the machine walks. Without the second
    // there is no disk answer to "which chunks exist", and the resolver would
    // ask for the spec again forever. One step writes both, because they are
    // one decision in two forms and a milestone specced in prose alone is a
    // milestone this machine cannot build.
    case 'spec': {
      const scope = { milestone_id: next.milestone_id }
      const prose = await stagingFor('spec', scope)
      const plan = await stagingFor('chunk-plan', scope)
      const outcome = await dispatched(
        next,
        'kiln:milestone-designer',
        `Decompose milestone ${next.milestone_id} into chunks, in the Kiln tree at ${treeRoot}. Read its slice goal and criteria from the architecture first.

Write TWO files, and nothing anywhere else:

    ${prose.staged_path}
        The spec, as prose: what this slice is for, and per chunk WHAT to build
        and WHAT must be true of it — never HOW to build it.

    ${plan.staged_path}
        The same decision in the form the machine walks: an object with a
        "chunks" array, each entry carrying a unique "id" and a "title", in the
        order they are to be built.

The two must agree — the plan's chunk ids are the chunks the spec describes. When both are written, report \`wrote: true\`, the model id you are running as, and a one-sentence summary.`,
        AUTHORED,
        plan.staged_ref,
        'claude'
      )
      if (!outcome.launched) return outcome.ref
      if (!outcome.ok) return await closeStep(next, outcome)
      await hands('promotion.promoteArtifact', [treeRoot, 'spec', scope], 'promote:spec')
      await hands('promotion.promoteArtifact', [treeRoot, 'chunk-plan', scope], 'promote:chunk-plan')
      return await closeStep(next, outcome)
    }

    case 'next-chunk-brief': {
      const scope = { milestone_id: next.milestone_id, chunk_id: next.chunk_id }
      const brief = await authored(
        next,
        'kiln:milestone-designer',
        'brief',
        scope,
        `Write the brief for chunk ${next.chunk_id} of milestone ${next.milestone_id}. It is the eight-field brief this machine validates: outcome, scope, anchors, acceptance, freshness, tier, return_format and stop_condition. Say WHAT the chunk must build and WHAT must be true of it, never HOW to build it.`,
        'claude'
      )
      if (!brief.ran) return brief.ref
      await hands('milestones.recordChunk', [
        treeRoot,
        next.milestone_id,
        { kind: 'chunk-spec', chunk_id: next.chunk_id, brief_ref: brief.promoted.ref },
      ])
      return await closeStep(next, brief.outcome)
    }

    case 'dispatch-implementer':
    case 'revise': {
      // Intent first, and only once — the lifecycle allows a single
      // `chunk-start` per chunk, and every later attempt runs underneath it.
      if (next.needs_chunk_start) {
        await hands('milestones.recordChunk', [
          treeRoot,
          next.milestone_id,
          {
            kind: 'chunk-start',
            chunk_id: next.chunk_id,
            implementer_seat: next.implementer_seat,
            implementer_family: next.implementer_family,
          },
        ])
      }
      const capsule = await hands('capsule.openCapsule', [treeRoot, next.milestone_id, next.chunk_id])
      const outcome = await dispatched(
        next,
        `kiln:${next.implementer_seat}`,
        `${
          next.transition === 'revise'
            ? `Chunk ${next.chunk_id} of milestone ${next.milestone_id} came back from review asking for changes. This is attempt ${next.attempt}, and it is a REMEDIATION, not a fresh build.

Read the review that asked for them first — it is at ${next.review_ref} in the Kiln tree at ${treeRoot} — and address every finding it raises. Your capsule still holds the work it reviewed, so change what the review asked about and leave the rest alone; a rewrite that happens to pass is not a response to the findings.${
                next.prior_session
                  ? `\n\nThe work under review was built in Codex session ${next.prior_session}. Continue that session rather than starting a new one, so the context the review is about is still in front of you.`
                  : ''
              }

`
            : ''
        }Implement chunk ${next.chunk_id} of milestone ${next.milestone_id}, attempt ${next.attempt}.

Your brief is at milestones/${next.milestone_id}/briefs/${next.chunk_id}.json inside the Kiln tree at ${treeRoot}. Read it in full; it is your contract.

Work ONLY inside this capsule — a git worktree of the milestone branch, isolated from the project:

    ${capsule.capsuleDir}

Everything you change there is captured as a patch when you finish; nothing outside it travels. Work test-first, and leave the chunk's own suite green.

When you are done, write your report — what you built, what you tested, what you could not resolve — to this path inside the Kiln tree:

    ${treeRoot}/results/${next.dispatch_id}.md

Then report \`wrote: true\`, the model id you are running as, and a one-sentence summary.`,
        AUTHORED,
        `results/${next.dispatch_id}.md`,
        next.implementer_family
      )
      if (!outcome.launched) return outcome.ref
      // A launched step that failed is closed with the reason already in hand,
      // never left for recovery to record as a generic abandonment.
      if (!outcome.ok) return await closeStep(next, outcome)

      // The capsule's work becomes a patch, and the patch becomes the staged
      // diff. The approved diff IS the staged diff, so this is where the two
      // are bound: the artifact is digest-verified before it governs the index.
      const exported = await hands('capsule.exportDiff', [treeRoot, next.milestone_id, next.chunk_id])
      // Whatever is in the index belongs to an attempt that was abandoned or
      // rejected; neither is approved work, and `applyToStaging` refuses to
      // layer over it. Clearing first is what makes a re-attempt after a crash
      // reach the index at all.
      await hands('capsule.discardStaging', [treeRoot])
      await hands('capsule.applyToStaging', [
        treeRoot,
        next.milestone_id,
        next.chunk_id,
        exported.patch_digest,
      ])
      // The terminal last: it now means the patch is staged, which is exactly
      // what `record-built` assumes when it reads one.
      return await closeStep(next, outcome)
    }

    case 'record-built': {
      const built = await hands('familyEvidence.recordBuilt', [
        treeRoot,
        next.milestone_id,
        next.chunk_id,
        { dispatch_id: next.dispatch_id },
      ])
      return `ledger:${built.seq}`
    }

    // Which family reviews is decided by code from who actually built, and it
    // is evidenced by the record this transition writes. No model chooses its
    // own reviewer.
    case 'review': {
      const seat = await hands('familyEvidence.selectReviewer', [treeRoot, next.milestone_id, next.chunk_id])
      const scope = { milestone_id: next.milestone_id, chunk_id: next.chunk_id, round: next.review_round }
      const review = await authored(
        next,
        `kiln:${seat.seat}`,
        'review',
        scope,
        `Review chunk ${next.chunk_id} of milestone ${next.milestone_id} against its brief at milestones/${next.milestone_id}/briefs/${next.chunk_id}.json, in the Kiln tree at ${treeRoot}.

Your input is the staged diff in the project and the brief; you have read access and nothing more. Produce a verdict object carrying "verdict" (either "approve" or "revise"), "evidence" (what you actually checked, in enough detail that someone could repeat it), and "family" set to "${seat.family}".`,
        seat.family
      )
      if (!review.ran) return review.ref
      await hands('milestones.recordChunk', [
        treeRoot,
        next.milestone_id,
        {
          kind: 'chunk-review',
          chunk_id: next.chunk_id,
          review: { family: review.promoted.content.family, verdict: review.promoted.content.verdict, ref: review.promoted.ref },
        },
      ])
      return await closeStep(next, review.outcome)
    }

    case 'chunk-gate': {
      const suite = await hands('toolchain.composeSuite', [treeRoot, next.profile_id])
      const gate = await hands('checkHonesty.runGate', [treeRoot, next.gate_id, suite.cmd])
      return `ledger:${gate.seq}`
    }

    case 'seal': {
      // The digest is taken NOW, not carried down from the build record: a
      // revise stages new work, and a seal citing the older digest would be
      // sealing something nobody approved.
      const staged = await hands('implementation.stagedDiffDigest', [treeRoot])
      await hands('implementation.sealChunk', [
        treeRoot,
        next.milestone_id,
        next.chunk_id,
        { review_ref: next.review_ref, gate_ref: next.gate_ref, diff_digest: staged.diff_digest },
      ])
      // The worktree sync and the capsule close do NOT happen here. They are
      // the `post-seal` rung, because a crash between this commit and that
      // cleanup would otherwise leave the resolver seeing a sealed chunk and
      // skipping the repair forever.
      return next.gate_ref
    }

    case 'milestone-review': {
      const seat = await hands('familyEvidence.selectMilestoneReviewer', [treeRoot, next.milestone_id])
      const outcome = await authored(
        next,
        `kiln:${seat.seat}`,
        'milestone-review',
        { milestone_id: next.milestone_id },
        `Review milestone ${next.milestone_id} as a whole, in the Kiln tree at ${treeRoot}. Its chunks are each individually sealed; what you are judging is whether they compose into the slice goal the architecture named, which no chunk-scoped review can see. Include a short security paragraph.

Produce a verdict object carrying "verdict" (either "approve" or "revise"), "evidence", and "family" set to "${seat.review_family}".`,
        seat.review_family
      )
      return outcome.ran ? await closeStep(next, outcome.outcome) : outcome.ref
    }

    case 'regression-floor': {
      const suite = await hands('toolchain.composeSuite', [treeRoot, next.profile_id])
      const gate = await hands('checkHonesty.runGate', [treeRoot, next.gate_id, suite.cmd])
      return `ledger:${gate.seq}`
    }

    case 'close': {
      await hands('implementation.closeMilestoneTxn', [
        treeRoot,
        next.milestone_id,
        { tag: `${next.milestone_id}-green`, review_evidence: next.review_evidence },
      ])
      return await recordEnvelope(next, `milestone ${next.milestone_id} is closed, merged and tagged`, 'milestones/index.json')
    }

    case 'consult': {
      const scope = { milestone_id: next.milestone_id, consult_id: next.consult_id }
      const answer = await authored(
        next,
        'kiln:milestone-designer',
        'consult',
        scope,
        `Answer consult ${next.consult_id}, asked by the ${next.asker} working on chunk ${next.chunk_id} of milestone ${next.milestone_id}, in the Kiln tree at ${treeRoot}.

The question: ${next.question}

Answer it as a verdict plus a VERBATIM ANCHOR — the exact quote and its file:line — never a paraphrase. Produce an object carrying "consult_id" set to "${next.consult_id}", "asker", "question", "verdict", and "anchor".`,
        'claude'
      )
      return answer.ran ? await closeStep(next, answer.outcome) : answer.ref
    }

    case 'phase-advance': {
      const advanced = await hands('phases.advance', [treeRoot])
      return `ledger:${advanced.seq}`
    }

    // D4: the post-seal repair is its own resumable rung, not trailing work
    // inside the seal. A crash between the commit and the cleanup used to make
    // the resolver skip seal forever, leaving the inverse-dirty worktree that
    // blocks the close and leaking the capsule.
    case 'post-seal': {
      await hands('capsule.syncWorktreeToHead', [treeRoot])
      await hands('capsule.closeCapsule', [treeRoot, next.milestone_id, next.chunk_id])
      return await recordEnvelope(
        next,
        `chunk ${next.chunk_id} of milestone ${next.milestone_id} is sealed and its capsule is closed`,
        `milestones/${next.milestone_id}/chunks.jsonl`
      )
    }

    default:
      throw new Error(`implementation: the resolver named "${next.transition}", which this script has no step for`)
  }
}

// ---------- the invocation ----------

// Views are regenerated BEFORE resolving, not only after acting: a crash
// between a previous transition and its regeneration leaves views behind the
// streams, and this is the invocation that catches them up. Derived and
// idempotent, so doing it twice costs nothing.
phase('Resolve')
await hands('views.regenerate', [treeRoot], 'regenerate:before')
const next = await hands('spine.nextTransition', [treeRoot], 'resolve')

phase('Transition')
let recordRef = null
if (next.transition === 'blocked' || next.transition === 'operator-needed') {
  // A stop is durable too. When the resolver had a record to cite — a red
  // gate, an unanswered steer — that record IS the evidence; when it had
  // none, the stop is raised as a hold, so every return this workflow makes
  // cites something a later reader can resolve rather than a path fragment
  // outside the receipt grammar.
  if (next.record_ref) {
    recordRef = next.record_ref
  } else if (next.degraded_route) {
    // A stop caused by a capability that is not there is a DEGRADED ROUTE, not
    // a hold: it belongs in the degraded-routes view the fire reads its one
    // spoken line from, where a hold would never appear. The record's identity
    // is the route id, so a relaunch that resolves to this same stop reuses the
    // record instead of adding a second one.
    const route = await hands('receipts.writeDegradedRoute', [treeRoot, next.degraded_route])
    recordRef = route.ref
  } else {
    const hold = await hands('receipts.writeHoldOpen', [
      treeRoot,
      {
        hold_id: next.block_id,
        severity: 'S2',
        summary: next.reason,
        origin_ref: next.milestone_id ? `milestones/${next.milestone_id}` : 'implementation',
      },
    ])
    recordRef = hold.ref
  }
} else {
  recordRef = await perform(next)
  await hands('views.regenerate', [treeRoot], 'regenerate:after')
}

// The invocation's own durable record. The run identity carries the record it
// cites, so the same milestone stopping twice on two different blockers is two
// records rather than one conflict — a deterministic identity built only from
// the transition and the milestone collides exactly there.
if (recordRef) {
  await hands(
    'receipts.writeWorkflowReturn',
    [
      treeRoot,
      {
        workflow: 'implementation',
        run_ref: `${next.transition}:${next.milestone_id || 'phase'}:${next.chunk_id || '-'}:${recordRef}`,
        return: next.return,
        record_ref: recordRef,
      },
    ],
    'return'
  )
  // The return is itself a durable record, so the views are brought level with
  // it rather than being left one record behind every invocation.
  await hands('views.regenerate', [treeRoot], 'regenerate:return')
}

return {
  return: next.return,
  transition: next.transition,
  record_ref: recordRef,
  reason: next.reason,
  milestone_id: next.milestone_id || null,
  chunk_id: next.chunk_id || null,
}
