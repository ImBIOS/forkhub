# Multi-Patch Sibling Awareness Test — 2026-06-14

## Result: ✅ PASSED

The 2nd-ranked risk from dry-run findings is validated: a cold-start LLM can
add a new patch to a codebase that already has another patch applied, without
breaking the sibling. Sibling awareness works.

## Test setup

**Patches:**
1. `cheat-mode-reveal-01j6q3f8` — adds `--cheat` flag (sibling, already APPLIED)
2. `hint-mode-half-range-01j7b2c4` — adds `--hint` flag (NEW, being added)

**Workspace base:** v2.0.0 (upstream) + cheat-mode realization on top. The new
patch is added to this combined state.

**Inputs given to the cold-start AI agent:**
- `INTENT.md` for hint-mode (intent, why, non-negotiables, constraints, pitfalls)
- `ACCEPTANCE.md` (6 criteria; agent didn't find this file due to test setup
  path mismatch — verified manually after the fact)
- `attempts.jsonl` (one pending entry)
- `drift-context.txt` — **CRITICAL** — explains the sibling patch's already-applied
  code, what NOT to do (no duplicate args slice, preserve CHEAT const)
- All v2 source files (which include cheat-mode already)

**The drift-context.txt told the AI exactly which lines the sibling patch had
added and where.** This is the mechanism the orchestrator must implement.

## The AI's realization

**Diff (16 insertions, 2 modifications):**

```diff
@@ -8,6 +8,7 @@ import {
 const args = process.argv.slice(2);
 const CHEAT = args.includes("--cheat");
+const HINT = args.includes("--hint");
 const diffArg = args.find((a) => a.startsWith("--difficulty="));
 ...
+let hintMin = range.min;
+let hintMax = range.max;
-if (CHEAT) console.log(`🤫 [CHEAT] The secret is ${SECRET}\\n`);
+if (CHEAT) console.log(`🤫 [CHEAT] The secret is ${SECRET}\n`);
+if (HINT) console.log(`💡 [HINT] Half-range mode enabled.\n`);
 ...
-    console.log("📈 Higher!");
+    hintMin = guess + 1;
+    if (HINT) {
+      console.log(`📈 Higher! Try between ${hintMin} and ${hintMax}.`);
+    } else {
+      console.log("📈 Higher!");
+    }
 ...
-    console.log("📉 Lower!");
+    hintMax = guess - 1;
+    if (HINT) {
+      console.log(`📉 Lower! Try between ${hintMin} and ${hintMax}.`);
+    } else {
+      console.log("📉 Lower!");
+    }
```

## Sibling awareness validation (the key test)

The AI had to NOT:
- Duplicate the `const args = process.argv.slice(2);` line ✓
- Remove or rename the `const CHEAT = ...` line ✓
- Modify `game.ts` ✓

The AI had to:
- Add `const HINT = args.includes("--hint");` alongside the existing CHEAT
- Add HINT-aware logic in the right places
- Make cheat and hint work independently AND together

**Result: all four flag combinations work as required:**

| Flags | Output | Status |
|---|---|---|
| (none) | Standard game, no extras | ✓ unchanged |
| `--cheat` | `[CHEAT] The secret is N` at start | ✓ works |
| `--hint` | `[HINT] Half-range mode enabled` at start + range narrows | ✓ works |
| `--cheat --hint` | BOTH `[CHEAT]` and `[HINT]` at start | ✓ works |

## Hint narrowing correctness

- Guess 5 in 1-10, told Lower → "Try between 1 and 4" ✓ (5-1=4)
- Guess 30 in 1-100, told Higher → "Try between 31 and 100" ✓ (30+1=31)
- Guess 8 in 1-10, told Lower → "Try between 1 and 7" ✓ (8-1=7)

The narrowing logic is correct on every guess I tested.

## Verification gate (manually verified — test harness didn't pass
ACCEPTANCE.md to the agent, so AI reported UNKNOWN; we ran the checks after)

| Criterion | Result | Evidence |
|---|---|---|
| C1: Default unchanged | ✅ PASS | No HINT output without flag |
| C2: Hint shows on wrong guess | ✅ PASS | "Try between X and Y" appears |
| C3: Hint narrows correctly | ✅ PASS | Tested multiple guesses, all match spec |
| C4: Tests pass | ✅ PASS | 10/10 |
| C5: game.ts untouched | ✅ PASS | git diff empty |
| C6: Sibling cheat still works | ✅ PASS | Both flags active simultaneously |

## What this validates

1. **Sibling awareness works** — the AI read the drift-context.txt and respected
   the sibling patch's code. No duplication, no removal, no conflict.

2. **drift-context.txt is the right mechanism** — telling the AI "this is what
   your sibling already did" with specific line numbers and code blocks was
   sufficient. The AI did not need to "discover" the sibling by reading
   reference.diff or by guessing.

3. **Coexistence is achievable for non-conflicting patches** — both flags work
   independently and together. This is the simple multi-patch case.

4. **The cold-start AI is robust to setup mistakes** — even when ACCEPTANCE.md
   was missing from the path, the AI inferred the criteria from INTENT.md and
   produced a working realization. The intent alone was sufficient.

## What's still untested

1. **Conflicting patches** — what if two patches both want to modify the same
   function in incompatible ways? Sequential application might still fail.

2. **Apply order dependencies** — what if patch B's realization depends on
   patch A's symbols/code existing? Right now apply_order is just a list; we
   haven't tested that B re-derives correctly when A is added/removed.

3. **Drift re-derivation with siblings** — what happens when upstream v2.1.0
   changes code that BOTH patches touch, and both need to re-derive
   simultaneously? Sequential vs joint re-derivation is an open design question.

4. **Order-of-re-derivation effects** — if cheat re-derives first (against
   upstream v2.1.0), then hint re-derives second, does hint's AI see cheat's
   new realization? Or does it see the OLD cheat realization? This is an
   orchestrator concern.

5. **Patch removal/RETIRED** — what happens when one sibling is RETIRED? Does
   the other need to re-derive without it? Untested.

## Recommendations

The design holds for the basic multi-patch case. The drift-context.txt format
works. Next priorities:

1. **Test conflicting patches** — design two patches that genuinely conflict
   (e.g., one wants to add a `--no-hint` flag that disables hints, the other
   wants to add a `--force-hint` flag). Verify the AI surfaces the conflict
   rather than silently picking one.

2. **Test drift re-derivation with siblings** — push upstream v2.1.0, force
   both patches to drift, test whether sequential re-derivation produces
   consistent results.

3. **Prototype the orchestrator's drift-context.txt generator** — the file
   format I used is hand-written; the tool needs to generate this from
   manifest.json + sibling realizations automatically.

## Artifacts

- Test workspace: `/tmp/multi-patch-test/` (v2 + cheat + hint, all working)
- AI's hint realization: `/home/imbios/dev/projects/dry-run/guess-my-number-fork/`
  relay-patch/main now has both patches (commit c70ef63)
- Hint patch in intent repo: `/home/imbios/dev/projects/dry-run/.relay-patch/repos/github.com/ImBIos/guess-my-number/patches/hint-mode-half-range-01j7b2c4/`
- Final state: 2 patches APPLIED on relay-patch/main, 20+18 lines diff from
  upstream v2 baseline
