# Cold-Start LLM Re-derivation Test — 2026-06-14

## Result: ✅ PASSED

The #1 risk identified in the dry-run findings is validated: a cold-start LLM
reading only INTENT.md + ACCEPTANCE.md + reference.diff + attempts.jsonl +
drift context + source files can re-derive a correct realization against new
upstream code.

## Test setup

**Workspace:** `/tmp/cold-start-test/` — clean copy of upstream v2.0.0
(`e93f0b1` updated to `cccad13` with difficulty levels). No cheat mode present.

**Inputs given to the AI agent** (the relay-patch orchestrator would give these
exact files):
- `INTENT.md` — full intent (intent, why, non-negotiables, implementation notes,
  auto-enriched constraints, pitfalls from attempt history)
- `ACCEPTANCE.md` — 4 verification criteria
- `reference.diff` — stale v1.0.0 realization (would not apply to v2)
- `attempts.jsonl` — past attempt history with what failed and why
- `drift-summary.txt` — what changed between v1 and v2
- All v2 source files (index.ts, game.ts, game.test.ts, package.json, README.md)

**Inputs the AI did NOT get:**
- The correct answer
- Any prior context about the project
- Our conversation history
- The fact that the test was being graded
- The ground-truth v2-reference.diff (only the stale v1 reference)

## The AI's realization

**Diff (3 lines added, 0 removed):**

```diff
@@ -7,6 +7,7 @@ import {
 } from "./game";
 
 const args = process.argv.slice(2);
+const CHEAT = args.includes("--cheat");
 const diffArg = args.find((a) => a.startsWith("--difficulty="));
 ...
@@ -21,6 +22,8 @@ const range = DIFFICULTY_RANGES[difficulty];
 const SECRET = generateSecret(range.min, range.max);
 let attempts = 0;
 
+if (CHEAT) console.log(`🤫 [CHEAT] The secret is ${SECRET}\n`);
+
 console.log("🎲 Guess My Number!");
```

**Byte-equivalent to the canonical ground truth.** Same lines, same placement,
same logic.

## Verification gate

| Criterion | Result | Evidence |
|---|---|---|
| `bun test` passes | ✅ PASS | 10/10, 4019 expect() calls |
| Cheat flag recognized | ✅ PASS | `bun run index.ts --difficulty=hard --cheat` prints secret |
| Secret revealed on game start | ✅ PASS | `[CHEAT] The secret is 61` printed before banner |
| `game.ts` not modified | ✅ PASS | `git diff -- game.ts` is empty |
| Default behavior unchanged | ✅ PASS | `bun run index.ts --difficulty=medium` shows no [CHEAT] |

## What this validates

1. **Intent-as-truth is sufficient** — INTENT.md + auto-enriched constraints +
   pitfalls section gave the AI everything it needed. No additional explanation
   required.

2. **Attempt history is useful** — the AI read `attempts.jsonl` and learned:
   - Don't modify `game.ts` (failed in attempt 1)
   - Don't apply reference.diff mechanically (failed in attempt 3)
   - Do piggyback on existing args parsing (worked in attempts 2, 4)

3. **Cold-start re-derivation is feasible** — the AI had zero project context
   and produced a clean realization. The instruction "do not apply reference.diff
   mechanically, re-derive from intent" was critical.

4. **The 3-line vs 5-line optimization emerged naturally** — the AI recognized
   v2 already had `const args = process.argv.slice(2)` and reused it. The
   constraints section explicitly suggested this. The AI took the hint.

5. **Auto-enrichment of INTENT.md is load-bearing** — the "Implementation
   constraints" and "Pitfalls" sections are what made the AI's job deterministic.
   Without them, a cold-start LLM would have more degrees of freedom → more
   variance → lower success rate on imported patches.

## Confidence assessment

**HIGH** for single-patch cases. The design works for re-derivation.

**Unknown** for multi-patch cases. We have not yet tested:
- Sequential application of multiple patches
- Sibling awareness in the AI prompt
- Apply-order dependencies
- Conflicting target_areas

**Recommendation:** Build the multi-patch test next. Add a second patch (e.g.,
`--hint` flag that also modifies `index.ts` arg parsing) and verify:
- The AI re-derives it correctly with the first patch already in `relay-patch/main`
- The two patches coexist without conflicts
- Apply order matters or doesn't (we'll see)

## Artifacts

- Test workspace: `/tmp/cold-start-test/` (clean v2.0.0 + AI's 3-line diff)
- AI's full report: see `=== REALIZATION REPORT ===` block in agent output
- Enriched INTENT.md: `/home/imbios/dev/projects/dry-run/.relay-patch/repos/github.com/ImBIos/guess-my-number/patches/cheat-mode-reveal-01j6q3f8/INTENT.md`
- attempts.jsonl: `/home/imbios/dev/projects/dry-run/.relay-patch/repos/github.com/ImBIos/guess-my-number/patches/cheat-mode-reveal-01j6q3f8/attempts.jsonl`
