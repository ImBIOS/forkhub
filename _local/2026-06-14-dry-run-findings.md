# Dry-Run Findings — 2026-06-14

## Scenario

Walked the full Scenario 2 (PR rejected → drift → re-derivation) against a real
GitHub repo: [ImBIos/guess-my-number](https://github.com/ImBIos/guess-my-number).

- **Upstream v1.0.0**: number guessing game (1-100)
- **Patch**: `cheat-mode-reveal-01j6q3f8` — add `--cheat` flag to reveal secret
- **Upstream v2.0.0**: added difficulty levels (easy/medium/hard) — changed
  `index.ts` substantially (imports, arg parsing, initialization, banner)
- **Drift**: reference.diff confirmed stale; AI re-derived successfully

Full lifecycle exercised: DRAFTING → APPLIED → PR rejected → DRIFTED →
RE-DERIVING → APPLIED (re-derived).

---

## What worked (design validated)

### 1. Intent-as-truth philosophy holds

The INTENT.md was sufficient to re-derive the patch against v2 without any
information from the stale reference.diff. The intent specified:
- What: `--cheat` flag, print secret before banner
- What NOT to touch: `game.ts`
- How (previous approach): parse args, conditional print

The re-derivation adapted intelligently: v2 already had `const args = process.argv.slice(2)`,
so the AI piggybacked on it instead of duplicating. The v2 realization was
3 lines vs the v1 realization's 5 lines — **cleaner than the original**.

### 2. target_area skip is effective

`git log e93f0b1..cccad13 -- index.ts` returned non-empty → correctly triggered
re-derivation. If upstream had only changed `README.md`, zero tokens would be spent.

### 3. Verification gate structure is sound

Four criteria, all checkable:
- game.ts untouched (`git diff` empty)
- tests pass (10/10)
- cheat works (behavioral check)
- default unchanged (behavioral check)

All green on re-derivation. The gate would have caught: game.ts modification,
test failures, broken cheat mode, broken default behavior.

### 4. Branch model separation is correct

`*` (add-cheat-mode) and `relay-patch/cheat-mode-reveal-01j6q3f8` served
different purposes. The `*` branch was the PR candidate (clean upstream + one
patch). The relay-patch branch was the re-derivation workspace (upstream v2 +
re-derived patch). Different bases, different audiences.

### 5. Force-push rebuild model works

`relay-patch/main` was rebuilt via `git reset --hard` to the new realization.
Tagged as `v2.0.0-rp1`. Clean, no merge conflicts, no history accumulation.

### 6. Repo layout and naming conventions are clean

```
.relay-patch/repos/github.com/ImBIos/guess-my-number/patches/cheat-mode-reveal-01j6q3f8/
```

Readable, unambiguous, no collisions. The ULID8 suffix future-proofs against
same-name patches from different authors.

---

## What broke / exposed holes

### HOLE 1: No real AI ran (biggest untested assumption)

I was the AI. The re-derivation was obvious to me as the code author. The
critical unknown: **can a cold-start LLM reading only INTENT.md produce a correct
realization?** The intent was detailed, but we don't know if it's detailed enough
for zero-context re-derivation.

**Impact**: If cold-start LLM re-derivation is unreliable, the entire tool fails.
This is the #1 risk.

**Mitigation**: Write the actual OpenCode skill re-derivation prompt and test
with a real LLM before building anything else. The prompt needs to include:
INTENT.md, reference.diff, the drift diff (`git log baseline..upstream -- target_area`),
and sibling context.

### HOLE 2: ACCEPTANCE.md criteria are not machine-runnable

Current format is prose + shell commands in code blocks. The verification gate
needs a script that:
- Runs each criterion independently
- Returns structured pass/fail per criterion
- Handles "unknown" state (criterion can't be checked)

**Impact**: Can't automate promotion to APPLIED. Every gate run is manual.

**Fix**: ACCEPTANCE.md should include a `verify.ts` script or structured criteria:

```yaml
criteria:
  - id: default-unchanged
    check: "bash -c 'echo \"\" | bun run index.ts 2>&1 | grep -v CHEAT'"
    expect: exit_0
  - id: cheat-reveals-secret
    check: "bash -c 'echo \"\" | bun run index.ts --cheat 2>&1 | grep CHEAT'"
    expect: exit_0
  - id: tests-pass
    check: "bun test"
    expect: exit_0
  - id: game-ts-untouched
    check: "git diff --quiet upstream/main -- game.ts"
    expect: exit_0
```

### HOLE 3: target_area is file-level only — too coarse

`[index.ts]` catches ANY change to that file, including comments, whitespace, or
unrelated features. This causes false-positive drift detection → unnecessary
token spend.

**Impact**: Cost. With many patches on large files, most re-derivation triggers
would be false positives.

**Fix options** (in order of difficulty):
1. **Diff heuristic**: only trigger if the diff is "substantial" (>N lines changed
   in target_area, excluding comments/whitespace). Cheap, imprecise.
2. **Function/section markers**: `target_area: [index.ts:generateSecret, index.ts:banner]`.
   Requires parsing, but precise.
3. **AI pre-check**: cheap LLM call to classify "did the relevant area change?"
   Costs a small fixed amount, high accuracy.

v1 should ship option 1 (line-count heuristic). Option 3 is the long-term answer
and is cheap relative to full re-derivation.

### HOLE 4: reference.diff must be machine-generated, never hand-written

My initial hand-written reference.diff was malformed (missing context lines for
`git apply`). The tool MUST generate reference.diff via `git diff` and store the
complete patch.

**Impact**: If reference.diff is malformed, the AI gets bad evidence. At best
useless; at worst misleading.

**Fix**: Tool handles this automatically. Users never write reference.diff by
hand. Document explicitly.

### HOLE 5: Multi-patch interaction completely untested

Only one patch was exercised. The design's hardest problems — sequential
application, sibling awareness, apply-order dependencies, conflicting
target_areas — were not tested.

**Impact**: Unknown. The design might break with 2+ patches.

**Fix**: Add a second patch to the dry-run that touches the same file:
- e.g., `hint-mode-01j7b2c4` — add `--hint` flag that narrows the range by 50%
- Both cheat-mode and hint-mode modify `index.ts` arg parsing + add behavior
- Test: can they coexist? Does apply order matter? Does re-derivation know about
  siblings?

### HOLE 6: INTENT.md "Implementation notes" section is load-bearing

The notes said "No changes needed to game.ts" and "Parse process.argv at top of
index.ts." Without these, a cold-start AI might modify `game.ts` to add a cheat
parameter or take a fundamentally different approach. The non-negotiables +
implementation notes are what make the intent deterministic.

**Impact**: Vague intents → non-deterministic re-derivations → idempotency
check fails → endless NEEDS_HUMAN.

**Fix**: The `/relay-patch satisfied` flow should REQUIRE the user (or AI) to
fill in implementation constraints before committing the intent. Add a template
section:

```markdown
## Implementation constraints (REQUIRED)
- DO NOT modify: game.ts
- MUST piggyback on: existing arg parsing in index.ts
- INSERT POINT: after SECRET generation, before banner
```

### HOLE 7: Consumer `relay-patch update` was not implemented

The update flow (fetch tag, stash, checkout, rebuild) was described but not
tested. This is the user-facing UX and determines whether the force-push model
is tolerable.

**Fix**: Prototype as a shell script:
```bash
relay-patch update:
  1. git fetch --tags
  2. LATEST_TAG=$(git tag --sort=-v:refname | head -1)
  3. git stash (if dirty)
  4. git checkout $LATEST_TAG
  5. git stash pop (if stashed)
  6. bun install / build
```

### HOLE 8: Drift report from AI was not structured

The plan calls for a "drift report" output from the AI (what changed, did
approach diverge). This was not exercised. Without structured drift reports,
the `.relay-patch` history can't track how realizations evolved.

**Fix**: Define a JSON schema for drift reports and store them alongside
reference.diff:
```json
{
  "upstream_sha": "cccad13",
  "approach_diverged": false,
  "changes": [
    "upstream added difficulty parsing — piggybacked on existing args",
    "import line changed — no impact on cheat logic"
  ],
  "lines_added": 3,
  "lines_removed": 0
}
```

---

## Summary verdict

**The design holds for the single-patch case.** The state machine, branch model,
intent-as-truth philosophy, verification gate, and force-push rebuild all work
as specified in v2. No fundamental flaws found.

**The biggest risk is untested**: cold-start LLM re-derivation quality. Everything
else is engineering — automatable, fixable, incrementally improvable. But if an
LLM reading INTENT.md cold can't produce a correct realization, the project's
core premise fails.

## Recommended next steps (priority order)

1. **Test cold-start LLM re-derivation** — Write the OpenCode skill re-derivation
   prompt. Give INTENT.md + reference.diff + drift diff to an LLM with zero
   context about the project. See if it produces the correct 3-line diff. This
   is go/no-go for the entire project.

2. **Add a second conflicting patch** — `hint-mode` that also modifies index.ts.
   Test multi-patch interaction, apply order, sibling awareness.

3. **Automate the verification gate** — Convert ACCEPTANCE.md criteria to
   runnable checks. This unblocks automated promotion.

4. **Prototype `relay-patch update`** — Shell script proving the consumer UX.

5. **Build the orchestrator** — The scheduler that runs target_area checks,
   triggers re-derivation, manages token budgets.

## Artifacts created

- **Upstream repo**: https://github.com/ImBIos/guess-my-number (v1.0.0 + v2.0.0)
- **Fork simulation**: `/home/imbios/dev/projects/dry-run/guess-my-number-fork/`
  - Branches: `main`, `add-cheat-mode` (*), `relay-patch/main`, `relay-patch/cheat-mode-reveal-01j6q3f8`
  - Tags: `v2.0.0-rp1`
- **Intent repo**: `/home/imbios/dev/projects/dry-run/.relay-patch/`
  - Patches: `cheat-mode-reveal-01j6q3f8` (status: applied, realized against cccad13)
