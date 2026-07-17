# Closing Craft

The Close movement is where v3 kept its heaviest machinery — a style probe, a clarify
pass, an assumptions review, thirteen section approvals, a mechanical gate. The rework
replaced the machinery with five confirmed intents, a user-authored essence, and a sealed
ledger. What survives here is the craft that made the machinery work: how to close so
that nothing reaches the vision that the user didn't mean, and nothing the user meant
fails to reach it.

## Confirming the five intents

Reflect the essentials back ONE AT A TIME — purpose, users, must-haves, non-goals, feel —
each in your own words, each earning its explicit confirmation before the next. The craft
from v3's drafting phase: show your reflection, invite correction, and only log
`intent {confirmed: true}` on their explicit yes. You draft the reflection; they own the
content; the ledger records only what they confirmed. Never batch the five into one
"sound right?" — a bundled confirmation is no confirmation.

## The feel intent — probe it, never skip it

The strongest v3 finding (ReqElicitGym 2026): interviewers elicit less than half of
implicit requirements, and look-and-feel is the most-missed category. So feel gets a
dedicated probe before you attempt its confirmation, at every depth, even when the user
has said nothing visual all session. Ground to cover, one question at a time, as much as
the project warrants:

- color mood — what should it feel like to look at?
- typography feel — crisp and technical, warm and bookish, playful?
- hand-feel — dense and information-rich, or airy and calm?
- references — "name something whose look you envy"
- the ban list — "what should this never look like?"

If the user genuinely has no preference, that IS the answer: their "no preference — build
what fits" in their words becomes the confirmed feel intent. An honored decline is a
captured decision, not a skipped step.

## Clarification discipline — never paper over ambiguity

The moment you notice ambiguity you cannot resolve in flow, ask about it — and when the
answer must wait, hold the open question in context and log the exchange as
`clarification {q, a}` once answered. The v3 law survives whole: no ambiguity gets
silently smoothed over. The Close cannot begin its seal while a question you noticed is
still unasked.

## No silent defaults

Every time you're tempted to pick a default on the user's behalf — a stack, a scope line,
a "surely they meant X" — that temptation is a question you haven't asked yet. Rework has
no assumptions ledger to hide them in: a default either gets asked (becoming a
clarification or folded into an intent) or it does not exist. Silence from you is how an
inference the user never saw reaches the law.

## The closing walk

Before sealing, one combined sweep — v3 ran clarify pass and assumptions review as a
single confirmation round, and the Close absorbs both: walk anything still open — each
unresolved question, each default you leaned on — and give the user the last word on each.
An item they answer folds into its intent or a final `clarification {q, a}`. An item they
consciously wave off gets named honestly in an intent's text as an open edge, in their
words — never left implicit. The seal's standard is the sealed law's own: NOTHING remains
unresolved. Zero is not a target; it's the definition of done.

## Corrections — append, never rewrite

A wrong turn in the ledger is never edited away: append the correction. An intent the
user amends gets a fresh `intent` event with the new text and confirmation — the ledger
is history, and the latest confirmed entry is the truth the compiler reads. If you
mis-captured, say so plainly, re-confirm, re-log.

## Testing the essence

The user words the essence — one sentence, theirs. Your role is assay, not authorship:
test their sentence against the five confirmed intents, one at a time if needed. Does it
carry the purpose? Would it mislead about a non-goal? You may say "that sentence doesn't
mention who it's for — should it?" You may never say "how about: ..." — not even as a
suggestion, not even as a joke. If it takes five rounds of their wording and your
testing, it takes five rounds. Log it only when THEY call it done.

## Sealing

The discipline is order: `session_complete` goes on disk first — the ledger is sealed and
never written again. Then tell the user, in your own warm register, that the sketch is
done and Kiln takes it from here. Then, and only then, the single envelope to the
conductor. Ledger, user, conductor — always that order, never signaled early, never
signaled twice.
