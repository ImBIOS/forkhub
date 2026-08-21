# Blog draft: the state machine behind relay-patch

**Audience:** engineers who want to understand the system's design before using it.
**Tone:** technical, architecture-first.
**Length target:** ~1200 words.
**Hero asset:** ASCII state diagram.

---

## Why a state machine

Most dev tools have implicit states — "did you init yet?", "are you in the middle of a PR?" — and they leak through UX. relay-patch is a long-running tool that has to handle drift, re-derivation, AI failure, and human intervention over weeks. Implicit states can't survive that. So the design has one explicit state machine per patch, with explicit transitions, and a verification gate at the dangerous edge.

The machine has 7 states and 9 transitions. This post walks through each.

---

## The states

```
                            /relay-patch INTENT
                                     │
                                     ▼
                              ┌─────────────┐
                              │   DRAFTING  │◄────┐
                              │ (branch: *) │     │ /relay-patch INTENT
                              │ AI implements│    │ (iterate)
                              │ user tries  │     │
                              └─────┬───────┘     │
                          satisfied?├──no─────────┘
                                    │ yes
                                    ▼
                              ┌─────────────┐
                              │   APPLIED   │
                              │ realization │
                              │ in relay-   │
                              │ patch/main  │
                              └─────┬───────┘
                                    │ upstream drift
                                    │ detected
                                    ▼
                              ┌─────────────┐
                              │   DRIFTED   │
                              │ intent ok,  │
                              │ realization │
                              │  stale      │
                              └─────┬───────┘
                                    │ scheduled
                                    ▼
                              ┌─────────────┐
                              │ RE-DERIVING │
                              │ AI in       │
                              │ relay-patch/*│
                              └─────┬───────┘
                                    │
                          verify gate
                                    │
                ┌───────────────────┼───────────────────┐
                ▼                   ▼                   ▼
          ┌──────────┐       ┌─────────────┐       ┌──────────┐
          │ APPLIED  │       │ NEEDS_HUMAN │       │UPSTREAMED│
          │ (re-     │       │ (blocked)   │       │ (done)   │
          │  applied)│       └──────┬──────┘       └────┬─────┘
          └──────────┘              │ user fixes       │
                                    └──────────────────┼──────►
                                                       ▼
                                                 ┌──────────┐
                                                 │ RETIRED  │
                                                 │ (intent  │
                                                 │ kept for │
                                                 │ history) │
                                                 └──────────┘
```

### DRAFTING

User runs `/relay-patch "add dark mode"` in OpenCode. A fresh `*` branch is created. The slash command skill guides the AI to implement the intent. User tries the build. If it works, run `/relay-patch satisfied`. If not, run `/relay-patch INTENT` again with refined intent.

**Loop is infinite by design.** The patch is not "done" until the user says so. The AI gets multiple attempts with the user's corrections as feedback. This produces better INTENT.md files (the user learns to write intent that survives re-derivation).

### APPLIED

User said satisfied. AI:
1. Finalizes INTENT.md (frozen — becomes the truth).
2. Captures `reference.diff` (the realization that worked — becomes evidence).
3. Generates `verify.sh` (or pulls from ACCEPTANCE.md).
4. Ports the diff to `relay-patch/main`.
5. Records `last_realized_against_commit` = current upstream SHA.
6. Tags `relay-patch/main` as `v<upstream_version>-rp<N>`.

This is the *steady state* for a patch. Most patches sit here for weeks/months.

### DRIFTED

Periodic upstream poll (every 5 min by default, configurable) detects `upstream/main` SHA ≠ recorded `last_realized_against_commit`. The patch's target_area is checked — if upstream changes didn't touch the target area, drift is **skipped** (this is the cost optimization: 80% of upstream releases don't touch your patch's area).

If they did, the patch goes DRIFTED. This is a *flag*, not a failure. Most drift is harmless; the realization might still apply.

### RE-DERIVING

Scheduled tick triggers re-derivation for drifted patches. Orchestrator:
1. Creates `relay-patch/<patch-id>` branch from current `relay-patch/main`.
2. Generates a context bundle (INTENT.md, drift summary, sibling patches, source code).
3. Spawns AI to produce a new realization.
4. Runs verification gate.

This is where the AI does its work. Everything before is plumbing; everything after is gates.

### The verify gate (the heart of the system)

```
✓ Build succeeds
✓ Tests pass
✓ AI self-eval: every acceptance criterion = pass (no "unknown")
✓ Diff sanity: non-trivial, not catastrophically large
✓ Sibling patches still work
```

**All five must pass** for the patch to auto-promote. If any criterion is "unknown" or fails after 3 AI retries, the patch goes NEEDS_HUMAN. This is the discipline that prevents silent drift.

The 3-retry policy matters: it bounds token cost (3 attempts × ~$0.50 = $1.50 max per patch per drift cycle) and surfaces stubborn failures to humans.

### APPLIED (re-applied) — back to steady state

Verify gate green → orchestrator ports the new realization to `relay-patch/main`, updates `last_realized_against_commit`, tags new version. The patch is current.

### NEEDS_HUMAN

The AI tried 3 times and the gate stays red. Orchestrator **blocks** `relay-patch/main` from advancing (no broken derivation ships). Surfaces to the user via daily-updates status, GitHub Discussions notification, and the `watch` daemon's output.

User runs `/relay-patch <same-id>` to fix manually. This enters a new DRAFTING cycle, but with the AI's failed attempts in `attempts.jsonl` so it doesn't repeat the same mistakes.

### UPSTREAMED

The AI detects that upstream now natively satisfies the intent — either via PR merge or independent implementation. The patch becomes a no-op (the realization is empty, just the intent remains). After N stable releases, transitions to RETIRED.

This is the *happy* failure. The patch won.

### RETIRED

Kept in `.relay-patch` for history (the Patch Directory surfaces it as "this used to patch X"). No longer applied. Important for community: someone might still want to read how this was once done.

---

## The transitions table

| Transition | Trigger | Actor | Bound on cost |
|---|---|---|---|
| DRAFTING → DRAFTING | user `/relay-patch INTENT` again | User | Interactive (user-paced) |
| DRAFTING → APPLIED | user `/relay-patch satisfied` | User + AI (port) | One port, ~$0.10 |
| APPLIED → DRIFTED | scheduled poll detects upstream SHA change | System | Free (just `git ls-remote`) |
| DRIFTED → RE-DERIVING | scheduled tick | System | Free (orchestrator prep) |
| RE-DERIVING → APPLIED | verify gate green | AI | ≤ 3 attempts × ~$0.50 |
| RE-DERIVING → NEEDS_HUMAN | gate red after 3 retries | AI + System | ≤ 3 attempts × ~$0.50 |
| RE-DERIVING → UPSTREAMED | AI detects upstream satisfies intent | AI | ≤ 1 attempt (cheap heuristic check) |
| NEEDS_HUMAN → DRAFTING | user runs `/relay-patch <id>` | User | Interactive |
| UPSTREAMED → RETIRED | confirmed stable for N releases | System | Free |

The cost bound is important — it's what makes the `watch` daemon sustainable. Worst case per patch per drift cycle: $1.50. For 10 patches × 4 upstream releases/month: $60/month. Reasonable.

---

## Why explicit states

Two architectural payoffs:

**1. The state file IS the API.** Anyone (a CLI, a web UI, a different AI) can read `manifest.json` and know exactly where every patch is. No "is this thing initialized?" guessing.

**2. The verify gate is at the only dangerous edge.** APPLIED is the steady state; it's safe. The danger is *transitioning to APPLIED*. Putting the gate there means we never have to retroactively un-apply a bad realization — it never reached APPLIED in the first place.

Compare to tools that "auto-merge AI PRs." They auto-apply, then check. We check, then auto-apply. The difference is the difference between `git revert` (always expensive, always lossy) and "no commit was ever made" (free).

---

## The invariant

> **Intent is truth. Diffs are evidence. The verify gate is the only path to APPLIED.**

If you remember one thing about relay-patch's design, that's it. Everything else — the state machine, the orchestrator, the daemon, the homebrew formula — is in service of those three claims.

---

*Source for this post: [`_local/2026-06-14-v2.md`](https://github.com/ImBIOS/relay-patch/blob/main/_local/2026-06-14-v2.md). Code: [`ImBIOS/relay-patch`](https://github.com/ImBIOS/relay-patch).*
