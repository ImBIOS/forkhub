# Drift Re-derivation with Siblings — 2026-06-14

## Result: ✅ PASSED

The orchestrator's most complex workflow works: when upstream advances and
multiple patches drift simultaneously, sequential re-derivation (one patch at
a time, in apply_order, with the new sibling state fed to the second) produces
working code.

This is the strongest test of the design so far. It exercises:
- Drift detection (both patches)
- Sequential re-derivation (one at a time)
- New-sibling-state visibility (second AI sees first's NEW realization)
- Coexistence with new upstream features (max-attempts)

## Test scenario

**Upstream v2.1.0** added `--max-attempts=N` flag. This affected BOTH patches:
- **cheat-mode**: args parsing area grew (2 new lines for maxAttempts parsing)
- **hint-mode**: while loop gained a new `if (attempts >= maxAttempts) break;` block
  between the `correct` check and the Higher!/Lower! branches

**Both patches were re-derived.** Sequential order: cheat first, then hint
(with the new cheat realization as sibling).

## Test 1: Cheat-mode cold-start re-derivation (no sibling)

**Workspace:** Clean v2.1.0 (`f0b06ea`). No patches applied.

**Inputs given to the AI:**
- INTENT.md, ACCEPTANCE.md, reference.diff (v2.0.0 realization, stale)
- attempts.jsonl
- drift-context.txt: explained v2.0.0 → v2.1.0 changes (max-attempts parsing, new
  game-over block, banner change)
- All v2.1.0 source files

**AI's realization:** 3 lines added, 0 removed. Same structural pattern as
v2.0.0 realization, but repositioned to account for the 2 new maxAttempts lines.

```diff
@@ -8,6 +8,7 @@ import {
 const args = process.argv.slice(2);
+const CHEAT = args.includes("--cheat");
 const diffArg = args.find((a) => a.startsWith("--difficulty="));
 ...
 const SECRET = generateSecret(range.min, range.max);
 let attempts = 0;
+if (CHEAT) console.log(`🤫 [CHEAT] The secret is ${SECRET}\n`);
+
 console.log("🎲 Guess My Number!");
```

**Verification:**
- ✓ 13/13 tests pass
- ✓ `--cheat` reveals secret
- ✓ `--max-attempts=2 --difficulty=easy` triggers game-over after 2 wrong guesses
- ✓ `--cheat --max-attempts=3 --difficulty=easy` — both work together
- ✓ game.ts untouched
- ✓ Default behavior unchanged

## Test 2: Hint-mode cold-start re-derivation (with NEW cheat as sibling)

**Workspace:** v2.1.0 + new cheat realization (from Test 1) at lines 11, 29.

**Inputs given to the AI:**
- INTENT.md, ACCEPTANCE.md, reference.diff (v2.0.0 realization, stale)
- attempts.jsonl
- drift-context.txt: **CRITICAL** — explained the v2.1.0 changes AND the sibling
  state (cheat-mode realization at specific line numbers and code blocks)
- All source files (with new cheat already applied)

**AI's realization:** 16 lines added, 2 modified.

```diff
 const args = process.argv.slice(2);
 const CHEAT = args.includes("--cheat");
+const HINT = args.includes("--hint");
 ...
+let hintMin = range.min;
+let hintMax = range.max;
 if (CHEAT) console.log(...);
+if (HINT) console.log(`💡 [HINT] Half-range mode enabled.\n`);
 ...
 if (result === "higher") {
-  console.log("📈 Higher!");
+  hintMin = guess + 1;
+  if (HINT) { console.log(`📈 Higher! Try between ${hintMin} and ${hintMax}.`); }
+  else { console.log("📈 Higher!"); }
 }
```

**Key design decision by the AI:** the hint Higher!/Lower! logic was placed
AFTER the new `if (attempts >= maxAttempts) break;` block. This means
max-attempts game-over takes precedence over hint output. The AI inferred this
from the v2.1.0 layout and made the correct decision without explicit instruction.

**Verification — all 5 scenarios:**

| Scenario | Result |
|---|---|
| Default (no flags) | ✓ unchanged |
| `--cheat` only | ✓ works |
| `--hint` only (verify narrowing: 5→6-10, 8→6-7) | ✓ works |
| `--cheat --hint` | ✓ both activate |
| `--hint --max-attempts=2` (hint + upstream's new feature) | ✓ coexist |
| `bun test` | ✓ 13/13 |
| game.ts untouched | ✓ |

## What this validates

1. **Sequential re-derivation works** — apply_order is followed, patches are
   re-derived one at a time.

2. **New-sibling-state visibility works** — the hint AI saw the new cheat
   realization (with the lines shifted for the new maxAttempts parsing) and
   positioned its HINT const correctly relative to the new layout.

3. **drift-context.txt is the right format** — telling the AI "your sibling
   has this code at this line" works better than telling it "read the sibling
   patch's reference.diff and figure it out."

4. **AI handles new upstream features** — the max-attempts feature was added
   between the AI's two passes. The hint AI saw it as a new block in the while
   loop and correctly placed hint logic AFTER it (not inside or before).

5. **AI can position patches relative to new code** — the hint const went at
   line 12 (right after the cheat const at line 11, which is itself after
   the new maxAttempts lines). The AI figured this out from drift context.

6. **Idempotency holds** — running the hint realization twice produces the
   same result (modulo the random SECRET).

## What's still untested

1. **Conflict resolution** — what if two patches want to modify the same line
   in incompatible ways? We tested coexistence, not conflict.

2. **Multi-patch simultaneous drift** — what if 5 patches all drift at once?
   Sequential is O(n) AI calls, but with n=2 the pattern is established.

3. **Order-of-re-derivation effects** — would the result be the same if we
   re-derived hint FIRST then cheat? Probably not — the second one would see
   different sibling state. Is the current order optimal?

4. **Patch removal (RETIRED)** — what if a sibling is removed? The remaining
   patches' re-derivations need to adapt.

5. **Cost explosion** — sequential re-derivation is n × (re-derive cost). For
   20 patches drifting, that's 20 AI calls. Joint re-derivation could be
   cheaper but harder to validate.

6. **`relay-patch update` consumer command** — the user-facing flow that
   consumes `relay-patch/main` after this whole process runs. Not tested.

## Recommendations

The orchestrator's core workflow is now validated for the realistic case:
- Upstream advances
- Multiple patches drift
- Sequential re-derivation with new-sibling-state
- Verification gate at each step
- Final `relay-patch/main` is consistent

Next priorities (in order):

1. **`relay-patch update` prototype** — the consumer-side command. Without
   this, users can't actually consume the rebuilt `relay-patch/main`.

2. **Conflicting patches test** — design two patches that genuinely conflict
   on the same code. Verify the orchestrator surfaces the conflict rather
   than silently picking one.

3. **Order-of-re-derivation** — verify that apply_order is well-defined
   (vs arbitrary). Test what happens if a patch depends on another's symbols.

4. **AGENTS.md and CLI scaffolding** — start turning this into a real
   tool, not just a documented design.

## Artifacts

- Test workspace (cheat): `/tmp/drift-test-cheat/` (v2.1.0 + cheat realization)
- Test workspace (hint): `/tmp/drift-test-hint/` (v2.1.0 + cheat + hint)
- Upstream: https://github.com/ImBIos/guess-my-number (v2.0.0 + v2.1.0)
- Dry-run fork: `relay-patch/main` now at v2.1.0 + 2 patches (commit c8c7202)
- Dry-run intent repo: both patches with v2.1.0 reference diffs (commit 15065f0)
