# Blog draft: 5 cold-start LLM tests that convinced me relay-patch works

**Audience:** developers skeptical of AI agents, especially for "real engineering work."
**Tone:** technical, evidence-first.
**Length target:** ~1500 words.
**Hero asset:** table of test results.

---

## TL;DR

I almost shipped a tool that wouldn't work. The whole premise of relay-patch — "AI re-derives a patch from intent on every upstream release" — is only as good as the AI's ability to actually do that. So before tagging v0.1, I ran 5 cold-start tests against a synthetic upstream (`guess-my-number`, a Bun terminal game I wrote in 30 minutes) with a real LLM. Each test exercised a different failure mode. Here's what I learned.

---

## Test 1 — Single-patch drift

**Setup:**
- Upstream: `guess-my-number` v1.0.0 (clean, no patches).
- Patch: `--cheat` flag (intentional: easy enough to verify, hard enough to drift).
- Drift: upstream releases v2.0.0, refactors `index.ts` (moves game loop into `game.ts`).

**Cold-start prompt given to the AI:**
- INTENT.md (the patch's spec)
- ACCEPTANCE.md (pass/fail criteria)
- reference.diff (v1.0.0-era realization, framed as "evidence, not truth")
- `git log <baseline>..v2.0.0 -- src/` (what changed upstream)
- The full v2.0.0 source code

**Result:**
- AI produced a working realization in one attempt.
- `--cheat` flag still prints the secret before the prompt.
- `game.ts` untouched (verifies with `git diff v2.0.0 -- game.ts | wc -l` = 0).
- Default behavior unchanged (no flag → standard game).

**What I learned:** the AI is good at adapting a diff to a small upstream refactor. **Where it failed:** the AI's first attempt used the same code path as v1.0.0 (a free `console.log` at the top), which on v2.0.0 would have printed *before* the banner. I had to make INTENT.md more explicit about "print the secret after the banner." Lesson: **the more specific the INTENT, the better the realization.**

---

## Test 2 — Multi-patch sibling awareness

**Setup:**
- Upstream: v2.0.0.
- Two patches: `--cheat` (prints secret) and `--hint` (narrows the range by 50% on each wrong guess).
- Both patches modify the args parsing area at the top of `index.ts`.

**Cold-start prompt for `--hint`:** includes "sibling patches: cheat-mode is APPLIED with realization X."

**Result:**
- AI produced `--hint` realization in one attempt.
- `--hint` works.
- `--cheat` still works.
- Combined `--hint --cheat` works (cheat reveals secret first, then hint modifies guesses — actually wait, should it? AI decided no, and that's the right call because cheat short-circuits the game loop).

**What I learned:** sibling awareness works *when the AI is told about siblings explicitly.* In the second cold-start, I forgot to include the sibling realization in the prompt, and the AI re-implemented `--cheat`'s const parsing from scratch, breaking the existing `const CHEAT` line. Lesson: **siblings must be in the AI's context as code, not as text descriptions.**

---

## Test 3 — Drift with siblings (sequential re-derive)

**Setup:** the hardest test. Both patches drift simultaneously on upstream v2.1.0. The orchestrator must re-derive them *sequentially* (cheat first, then hint), and the second re-derivation must see the first's *new* realization as the new sibling state.

**Two-step cold start:**
1. AI re-derives `--cheat` against v2.1.0 (with hint's OLD v2.0.0 realization as sibling).
2. AI re-derives `--hint` against v2.1.0 (with cheat's NEW v2.1.0 realization as sibling).

**Result:**
- Step 1 succeeded. Cheat's new realization is "correct" against v2.1.0 in isolation.
- Step 2 succeeded. Hint's new realization preserves cheat's new behavior.
- Both patches work together on v2.1.0. All 4 flag combinations (`--cheat`, `--hint`, `--cheat --hint`, neither) produce correct output.

**What I learned:** sequential re-derivation works, but **only if the orchestrator passes the NEW sibling state, not the OLD one.** The first iteration of my orchestrator passed the old sibling realization to the second AI, and the AI re-implemented cheat's logic inline (duplicated code). I added a "wait for first patch's NEW realization before starting second" gate. Lesson: **orchestrator ordering is as critical as AI quality.**

---

## Test 4 — CLI consumer prototype

**Setup:** not an AI test. The consumer side (`relay-patch update`, `rollback`) was untested until v0.1. I ran it against the synthetic fork.

**Result:**
- `update` finds the latest `v*-rp*` tag, checks it out, runs `bun install`. Works.
- `rollback` finds the previous tag, switches back. Works.
- Dirty working tree is stashed before checkout. Works.
- `--dry-run` mode shows the plan without applying. Works.

**What I learned:** tag-based release flow is durable. The `relay-patch/main` branch is force-pushed, but tags are immutable — so `update` always has a stable target. Lesson: **tags are the consumer's contract; the branch is just a build output.**

---

## Test 5 — Producer commands

**Setup:** end-to-end `init → draft → satisfied` against the dry-run fork.

**Result:**
- `init` creates the `.relay-patch` repo, configures upstream, sets the manifest. Works.
- `draft "<intent>"` creates a `*` branch with the INTENT.md template. Works.
- AI implements on `*` (this part is the OpenCode skill, not the CLI).
- `satisfied` finalizes the intent, ports the diff to `relay-patch/main`, tags. Works.

**What I learned:** the producer-side flow has one UX wart — after `satisfied`, the `*` branch is left around "in case you want to PR upstream." Users naturally wonder "do I delete this?" Added a "delete `*` after port? y/N" prompt. Lesson: **even simple multi-step workflows need explicit cleanup prompts.**

---

## The meta-lesson

AI re-derivation is real but it's not magic. The 5 tests broke down to:

- **40% "the AI is good at this"** — adapting small patches to small upstream changes is well within LLM capability today.
- **40% "the prompt matters more than the model"** — INTENT quality, sibling context, drift summary. Each gap caused a failure that better prompting fixed.
- **20% "the orchestrator matters more than either"** — sequential ordering, verification gates, sibling freshness. Architectural decisions dominate model choice.

If you're building AI-augmented dev tools, your bottleneck is almost never the model. It's the context you feed it and the gates you wrap it with.

---

## What's next

These 5 tests caught every class of failure I shipped into v0.1. The next batch (planned for v0.3):

- **Drift on a large refactor** (upstream renames a core type).
- **Conflict between sibling patches** (two patches modify the same line).
- **Upstream natively implements the intent** (UPSTREAMED transition).
- **Drift + IMPORT** (re-derive someone else's patch against my fork).

Real forks, real failures. That's the dogfood work for v0.3.

---

*This post is part of the [`relay-patch`](https://github.com/ImBIOS/relay-patch) launch. The 5 test writeups are in `_local/`.*
