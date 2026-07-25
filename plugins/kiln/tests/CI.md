# The local floor — what to run, in what order, and what each gate proves

Kiln has no CI service and no pipeline file. This page is the whole contract: four commands you run
locally, in this order. Each one proves something the one before it cannot, which is why the order is
not arbitrary.

Run everything from the repository root.

## 1. The full floor

```
node --test plugins/kiln/tests/
```

Every unit and runtime test. Proves the shipped behaviour still holds — the verbs, the kernel
choreography, the ledgers, the cards and skill contracts, and the count-pins that ground the
exclusivity claims written beside the code. This is the gate you run most often; run it after every
edit, not at the end.

## 2. The floor again, with codex genuinely absent

```
env -i PATH="<a directory with no codex on it>" HOME="$HOME" TMPDIR=/tmp \
  node --test plugins/kiln/tests/
```

The same suite on a machine that has no second model family. Proves no test is secretly conditioned
on this box: the lock-minting verbs probe for `codex`, so a suite that inherits the developer's PATH
can pass here and fail for everyone else, or the reverse.

Building that PATH honestly takes a moment, because `codex` may sit in more than one directory —
check with `command -v codex` and `ls /usr/bin/codex`. A directory of symlinks to the usual binaries
with `codex` left out is the reliable way; trimming one entry off PATH is not, and has produced a
false green before.

## 3. The budget and machinery gates

```
bash scripts/dev/ceiling.sh
```

Prints `budget: PASS` or `budget: BREACH`. Proves the four machinery gates still hold — the `.kiln`
store set is closed, no new user-visible verbs beyond the ruled allowance, no new workflow file or
transport channel — and reports net production growth against the frozen baseline. A BREACH stops the
work for a ruling; it is never funded by trimming reasoning to fit.

## 4. The release gate

```
bash scripts/validate-release.sh
```

The shipping floor: manifests parse, versions agree across them, workflows pass `node --check`, data
files are present and valid, the zero-hooks invariant holds, no stale skill paths survive, the whole
harness is green, and the plugin manifest passes `claude plugin validate --strict`. It runs the floor
itself, so it is the slowest — run it last, and always before a release.

## The order, and why

1 catches almost everything and is fastest to interpret. 2 catches only what 1 cannot see, and only
matters because the availability probe made these operations depend on the host. 3 is about the shape
of the codebase rather than its behaviour, so it can pass while 1 fails and vice versa. 4 subsumes 1
but adds the packaging checks, so it belongs at the end where its cost is paid once.

## Also useful, not gates

```
node --check plugins/kiln/scripts/kiln-review
node --check plugins/kiln/workflows/kernel.js
git diff --check
```

Syntax and whitespace. `validate-release.sh` covers the workflows; `kiln-review` has no extension, so
its syntax check is worth running by hand after editing it.

## The scenario runners

`plugins/kiln/tests/scenarios/` holds five end-to-end runners that drive the real transport and, for
some, a real `claude` session. They are NOT part of the floor and are not run automatically: they cost
real model calls. Run one deliberately, from the repository root, when you want live evidence:

```
bash plugins/kiln/tests/scenarios/run-s3.sh
```

The gate-level runners (`run-s2`, `run-s3`) can be exercised without a model call by putting a stub
`codex` first on PATH that writes a canned verdict to its `-o` file — that proves the argv contract
end to end while leaving the reviewer's judgement untested.
