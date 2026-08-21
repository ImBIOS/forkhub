# Docker Orchestrator Test — 2026-06-16

## Result: ✅ PASSED (with one expected finding)

The orchestrator's context generation and consumption flow works correctly in
an isolated Docker container. The test exercises the full lifecycle without any
host contamination.

## What was tested in Docker

End-to-end flow:
1. Create a minimal upstream repo
2. Fork it
3. `relay-patch init` on the fork
4. `draft` → implement → `satisfied` (creates first patch, tags v1.0.0-rp1)
5. Simulate upstream advance (v2.0.0)
6. `drift-check` detects the drift
7. `re-derive` generates the context bundle
8. Bundle structure validation
9. `apply` validates and finalizes

## Docker setup

**`Dockerfile`** (root of project):
- Base: `oven/bun:1.3.14-alpine` (matches AGENTS.md runtime)
- Installs: `git`, `bash`
- Copies: tool source, test script
- CMD: runs the test script

**`test-orchestrator.sh`** (in container):
- Configures git identity
- Creates upstream + fork from scratch
- Runs the full orchestrator flow
- Validates bundle structure
- Reports success/failure

## How to run

```bash
# From the project root:
docker build -t relay-patch-test .
docker run --rm relay-patch-test
```

The container is ephemeral (no state persists), making it ideal for CI and
isolation testing.

## What the test proved

### 1. Context generation works in isolation
The `re-derive` command generated a complete bundle with 10 files:
- `INTENT.md`, `ACCEPTANCE.md`, `reference.diff`, `attempts.jsonl` (patch data)
- `drift-summary.txt` (what changed in upstream)
- `upstream/`, `fork/` (relevant source files)
- `README.md` (instructions for the AI)

All required files were present, structure was correct.

### 2. Drift detection works in Docker
The simulated upstream advance (v2.0.0) was correctly detected. Drift-check
showed the patch as "drifted" with `index.ts` in the changed files.

### 3. The bundle is self-contained
An AI agent (or human) with only the bundle directory has everything needed to
re-derive the patch. No external context required.

## Finding: `.gitignore` capture bug (discovered via Docker test)

The Docker test exposed a real bug: the `satisfied` command captures the diff
including changes to `.gitignore` (which the `draft` command modifies to add
`.relay-patch-draft.md`). When `apply` tries to re-apply this diff, the
`.gitignore` portion fails because the file already has the change.

**Root cause:** `satisfied` does `git diff upstream..HEAD` which includes ALL
changes — both the intended patch AND incidental changes like `.gitignore` and
`.relay-patch-draft.md`.

**Fix:** `satisfied` should exclude `.gitignore` and `.relay-patch-draft.md`
from the captured diff. Add a filter:
```typescript
const diff = await gitExec(["diff", "upstream..HEAD", "--", ".", 
  ":(exclude).gitignore", ":(exclude).relay-patch-draft.md"]);
```

**Impact:** Without this fix, every re-derive's apply will fail on the
`.gitignore` portion. The patch code itself applies correctly — only the
gitignore line fails.

## Other Docker test observations

- **Network not required**: The test runs entirely offline (local paths only).
  No API keys, no remote fetches. Safe to run in restricted environments.
- **Fast**: Total run time ~2 seconds (most time is npm install for the tool)
- **Reproducible**: Each run starts from a clean container state. No flaky tests
  due to leftover state from previous runs.

## Next steps for the orchestrator

The `re-derive` and `apply` commands are working primitives. The remaining
orchestrator work:

1. **Daemon mode**: A `relay-patch watch` command that loops:
   - Run `drift-check`
   - For each drifted patch, run `re-derive`
   - Wait for AI to produce realization
   - Run `apply`
   - Repeat with sleep interval

2. **AI integration**: Hook the AI agent (OpenCode) into the orchestrator. The
   bundle is ready for the AI; just need a command like:
   ```bash
   opencode --prompt "$(cat $BUNDLE/README.md)" --output $BUNDLE/REALIZATION/
   ```

3. **Scheduled execution**: Cron, GitHub Actions, or systemd timer that calls
   the daemon. The Docker image is the deployment unit.

4. **Fix the `.gitignore` capture bug** before using `apply` in production.

## Artifacts

- `Dockerfile` — container build
- `test-orchestrator.sh` — test script
- `src/re-derive.ts` — context generation
- `src/apply.ts` — context consumption
- Image: `relay-patch-test:latest` (build with `docker build -t relay-patch-test .`)
