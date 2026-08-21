# CLI Prototype — `relay-patch update` — 2026-06-14

## Result: ✅ PASSED

The consumer-side `relay-patch update` command works. Users can now safely
advance to the latest re-derivation without raw `git pull` breaking on
force-pushed `relay-patch/main`.

## What was built

```
src/
├── cli.ts       command routing (update, rollback, status, --help)
├── update.ts    git operations + update flow (fetch, stash, checkout, install)
└── rollback.ts  rollback to previous tag
```

Three commands implemented:
- `relay-patch update [--tag <tag>] [--dry-run] [--skip-install]`
- `relay-patch rollback [--skip-install]`
- `relay-patch status`

## Tests run (all passed)

| Test | Result |
|---|---|
| `status` from fork (shows current/latest tags) | ✅ |
| `status` outside git repo | ✅ (error message) |
| `status` with no tags | ✅ (error message) |
| `update --dry-run` | ✅ (no changes made) |
| `update` (v2.0.0-rp1 → v2.1.0-rp1) | ✅ |
| `update` (already at latest) | ✅ (no-op message) |
| `update` with dirty working tree (stash + restore) | ✅ |
| `update` with real `bun install` | ✅ |
| `rollback` (v2.1.0-rp1 → v2.0.0-rp1) | ✅ |
| `rollback` with dirty working tree | ✅ |
| `--help` | ✅ |
| TypeScript typecheck (`tsc --noEmit`) | ✅ (clean) |

## Design decisions validated

1. **Tag-based releases work.** Each re-derivation cuts a tag (`v<upstream>-rp<build>`).
   Consumers track tags, not branches. Force-push on `relay-patch/main` is invisible
   to them.

2. **Stash-based dirty-tree handling is sufficient.** For the fork consumer case,
   `git stash push -u` before checkout and `git stash pop` after covers the common
   "I have local config changes" scenario. Conflicts on pop are surfaced, not
   silently lost.

3. **`--skip-install` is essential for testing.** Without it, every test run
   triggers `bun install`, which is slow and may fail in sandboxed environments.

## Design holes found

### HOLE 1: No `relay-patch init` yet

The CLI assumes the user is already in a fork checkout with tags. There's no
`relay-patch init` to set up the initial fork, create `.relay-patch`, or configure
the upstream remote. This is the next command to build.

### HOLE 2: `bun install` is hardcoded

The install step assumes Bun. For non-Bun projects (Python, Go, Rust), this would
fail. The install command should be configurable per-target-repo in
`upstream.json`:

```json
{
  "install_command": "bun install",
  "build_command": "bun run build"
}
```

v1 ships Bun-only. v2 reads from config.

### HOLE 3: No conflict resolution on stash pop

If the user's local changes conflict with the new tag's code, `git stash pop`
fails and the changes stay stashed. The CLI warns but doesn't help resolve.
Future: offer a 3-way merge or prompt the user.

### HOLE 4: Tags are local-only in dry-run

In production, tags are pushed to the fork's GitHub origin. The CLI's
`git fetch --tags` fetches from origin. In the dry-run, tags are local (no
origin remote set up). The prototype works but the fetch is a no-op. Real
testing requires a GitHub-hosted fork.

### HOLE 5: No version pinning / lockfile

If a user wants to stay on v2.0.0-rp1 indefinitely (skip v2.1.0), there's no
mechanism for it. Future: `relay-patch pin v2.0.0-rp1` to hold at a version
until explicitly unpinned.

## What's implemented vs. designed

| Feature | Designed | Implemented |
|---|---|---|
| `relay-patch update` | ✅ | ✅ |
| `relay-patch rollback` | ✅ | ✅ |
| `relay-patch status` | ✅ | ✅ |
| `relay-patch init` | ✅ | ❌ |
| `relay-patch add` (create new patch) | ✅ | ❌ |
| `relay-patch satisfied` (finalize intent) | ✅ | ❌ |
| `relay-patch import` (import from other user) | ✅ | ❌ |
| `relay-patch drift-check` (dry-run re-derivation) | ✅ | ❌ |
| Orchestrator (scheduled re-derivation) | ✅ | ❌ |
| Verification gate automation | ✅ | ❌ |
| Agent adapter (OpenCode) | ✅ | ❌ |

The consumer side is done. The producer side (patch creation, drift detection,
re-derivation, intent management) is the remaining work.

## Summary

The CLI prototype proves the consumer-side flow works end-to-end:
- Users run `relay-patch update` from their fork checkout
- The CLI finds the latest tag, stashes local changes, checks out, installs
- Rollback works the same way in reverse
- Dirty working trees are handled safely

This closes the last open loop from the dry-run findings: "Consumer `relay-patch
update` was not implemented." It's now implemented and tested.
