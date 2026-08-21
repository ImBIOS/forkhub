# Producer-Side Commands Test — 2026-06-16

## Result: ✅ PASSED

The full producer→consumer flow works end-to-end. Users can now create patches
from scratch using `init` → `draft` → implement → `satisfied`, and consume them
via `update`.

## What was built

```
src/
├── cli.ts        updated: routes init, draft, satisfied (+ existing update/rollback/status)
├── git.ts        shared git utilities (extracted from update.ts)
├── patch-id.ts   slugify + ULID8 generation
├── init.ts       relay-patch init: set up .relay-patch repo + config
├── draft.ts      relay-patch draft: create * branch + draft INTENT.md
├── satisfied.ts  relay-patch satisfied: finalize intent, capture diff, port, tag
├── update.ts     (existing) relay-patch update
└── rollback.ts   (existing) relay-patch rollback
```

## Full flow tested

### Step 1: `init`
```bash
relay-patch init --target github.com/ImBIos/guess-my-number
```
- Detected `upstream` remote
- Created `../.relay-patch/` with correct structure
- Wrote `global.json`, `manifest.json`, `upstream.json`, `README.md`

### Step 2: `draft`
```bash
relay-patch draft "add color output to the game banner"
```
- Generated slug: `add-color-output-to-the-game-banner`
- Created branch off `main`
- Wrote `.relay-patch-draft.md` with frontmatter + intent template

### Step 3: Manual implementation
(simulated AI/user work — added ANSI color codes to banner)

### Step 4: `satisfied`
```bash
relay-patch satisfied
```
- Generated patch ID: `add-color-output-to-the-game-banner-bbg1v3qn`
- Captured diff from `upstream/main..HEAD`
- Wrote to `.relay-patch`:
  - `patches/<id>/INTENT.md` (with full frontmatter)
  - `patches/<id>/reference.diff`
  - `patches/<id>/attempts.jsonl` (first entry)
  - `patches/<id>/ACCEPTANCE.md` (template)
- Updated `manifest.json` (added patch, updated apply_order)
- Created `relay-patch/main` branch, cherry-picked the diff
- Tagged as `v2.1.0-rp1`
- Deleted draft file

### Step 5: Consumer flow (existing commands)
```bash
relay-patch status   → showed tag available
relay-patch update   → checked out v2.1.0-rp1
```
Game runs with color patch applied.

## Design holes found

### HOLE 1: Draft file leaks into git diff
`.relay-patch-draft.md` is in the working tree during implementation. If the
user does `git add -A` (as they naturally would), the draft file gets committed
and appears in the patch's `filesChanged` list and `reference.diff`.

**Fix:** `draft` command should add `.relay-patch-draft.md` to `.gitignore`
automatically. Or: store the draft outside the repo (e.g., in `~/.relay-patch/`).

### HOLE 2: `--target` required for local-path remotes
When the upstream remote is a local path (not a GitHub URL), `parseRemoteUrl`
returns null. The user must pass `--target github.com/owner/repo` explicitly.

**Fix:** For local development, try to read the target from the upstream repo's
own git config or `origin` remote. Or just document that `--target` is needed
for local-path upstreams.

### HOLE 3: INTENT.md sections are templates, not filled
The `satisfied` command writes INTENT.md with placeholder text for "Why",
"Non-negotiables", and "Implementation notes". In the real flow, the AI would
fill these during the DRAFTING iteration. For the CLI-only flow (no AI), the
user has to edit INTENT.md manually after `satisfied`.

**Fix:** The OpenCode skill should fill these during `/relay-patch INTENT`.
The CLI just creates the structure.

### HOLE 4: No `relay-patch drift-check` yet
The orchestrator's drift detection (target_area check, cost estimation) is not
implemented. This is the next major piece.

### HOLE 5: Cherry-pick conflicts not handled
If `relay-patch/main` already has patches that conflict with the new one,
cherry-pick fails and the error message tells the user to use `--skip-port`.
No automatic AI-assisted adaptation yet.

**Fix:** Future: when cherry-pick fails, trigger an AI re-derivation pass that
adapts the diff to the cumulative base (same as drift re-derivation, but for
initial port).

## Summary

The CLI now has both producer and consumer commands:

| Command | Status |
|---|---|
| `relay-patch init` | ✅ Working |
| `relay-patch draft` | ✅ Working |
| `relay-patch satisfied` | ✅ Working |
| `relay-patch update` | ✅ Working |
| `relay-patch rollback` | ✅ Working |
| `relay-patch status` | ✅ Working |

The tool is now usable end-to-end for the basic workflow. The remaining work is:
1. The OpenCode skill (interactive AI implementation during DRAFTING)
2. The orchestrator (drift detection + scheduled re-derivation)
3. `relay-patch drift-check` (cost estimation)
4. `relay-patch import` (Patch Directory)
5. Verification gate automation
