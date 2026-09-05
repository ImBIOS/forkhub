# forkhub (`fh`) — keep your fork's patches while staying up-to-date with upstream

[![Test](https://github.com/ImBIOS/forkhub/actions/workflows/test.yml/badge.svg)](https://github.com/ImBIOS/forkhub/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/runtime-Bun%20%E2%89%A51.3-f472b6)](https://bun.sh)

**forkhub** is an open-source CLI that maintains Git forks with custom patches **without freezing them**. Declare each local change once as an **intent** (a natural-language spec + acceptance criteria), and an AI coding agent re-derives it against every new upstream release. You get the maintainer's latest features _and_ your rejected-PR fixes — automatically.

> **Patches are intent, not diffs.** Diffs go stale on every upstream commit. Intent survives.

- 🔁 **Stay current**: `fh update` pulls the newest upstream release and re-applies your patches.
- 🤖 **AI re-derivation**: OpenCode, Claude Code, or any agent re-implements your intent against the new codebase — adapting, not blindly patching.
- 🧪 **Verify gate**: every patch carries a runnable `verify.sh`; failed tests = no auto-promote.
- 📦 **Shareable**: publish your `.forkhub` repo and anyone can import your patch intents with one command.
- 👀 **Drift detection is cheap**: per-patch `target_area` checks skip releases that don't touch your code.

## The problem forkhub solves

```
upstream/main    ─────●─────●─────●─────►  (v1.0.0, v1.1.0, v2.0.0, v2.1.0)
                               │
                               └─ your patch: --cheat flag (rejected PR)

your fork       ─────●─────●─────●─────►  (frozen at v2.0.0 + your patch)

gap: v2.1.0 features you don't have
```

**Without forkhub:** choose one — official release (lose your patch) or your frozen fork (lose upstream features). Every upstream release means manual rebasing, conflict-fixing, re-testing.

**With forkhub:** declare your patch as **intent** ("add --cheat flag, print before banner, don't touch game.ts"). An AI agent re-realizes that intent against every new upstream release. Run `forkhub update` and get both: your patch + the latest upstream.

## Quick start

```bash
# 0. Install (see Install below) → you get the `fh` command

# 1. From inside your fork's checkout
fh init

# 2. In OpenCode (or any AI agent), declare what you want:
/forkhub "add --cheat flag to reveal the secret number"

# 3. AI implements on a draft branch. Test it. When happy:
fh satisfied

# 4. When upstream releases a new version:
fh update    # consumer-side: advance to latest tag
fh watch     # daemon-side: auto-detect drift, generate bundles, apply
```

## Install

### Homebrew (macOS / Linux)

```bash
brew tap ImBIOS/tap https://github.com/ImBIOS/forkhub
brew install forkhub
```

### npm (stable / latest channel)

```bash
npm install -g forkhub
fh --version
```

### Canary channel (bleeding edge)

Canary builds are published automatically on every push to the `canary` branch:

```bash
# pnpm (recommended)
pnpm add -g "github:ImBIOS/forkhub#canary&path:packages/cli"
fh --help

# or via dlx without global install
pnpm dlx "github:ImBIOS/forkhub#canary&path:packages/cli" fh --help
bunx --bun "github:ImBIOS/forkhub#canary&path:packages/cli" fh --help
```

### Standalone binary

Grab a prebuilt binary from [GitHub Releases](https://github.com/ImBIOS/forkhub/releases/latest):

```bash
curl -fsSL https://github.com/ImBIOS/forkhub/releases/latest/download/forkhub-$(uname -s | tr A-Z a-z)-$(uname -m | sed 's/x86_64/x64/;s/aarch64/arm64/') -o fh
chmod +x fh && sudo mv fh /usr/local/bin/
```

Requires [Bun](https://bun.sh) ≥ 1.3 and `git`.

## Commands

| Command                                                     | Purpose                                                                                                 |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `init`                                                      | Set up `.forkhub` repo + config                                                                         |
| `draft "<intent>"`                                          | Create a `*` branch + draft INTENT.md                                                                   |
| `satisfied`                                                 | Finalize intent, capture diff, port to `forkhub/main`, tag                                              |
| `pr [--draft] [--base <branch>]`                            | Push branch to your fork + open PR upstream (defaults `--base` to the detected upstream default branch) |
| `link-pr <patch-id\|branch> <pr#\|url>`                     | Link an existing upstream PR to a patch (if you opened it outside `fh pr`)                              |
| `publish`                                                   | Push your `.forkhub` intent repo public so others can import                                            |
| `import <url>`                                              | Import a patch intent from another user's `.forkhub`                                                    |
| `reuse <url> [--agent <name>]`                              | Import + build re-derivation bundle in one step                                                         |
| `search [--target <repo>] [--author <user>] [--sort stars]` | Find published patches (★ = publisher repo stars)                                                       |
| `popular [--target <repo>]`                                 | Most-starred patches first (merge-priority signal)                                                      |
| `re-derive <patch-id>`                                      | Generate context bundle for AI re-derivation                                                            |
| `apply <bundle-path>`                                       | Apply realization from bundle (with verify gate)                                                        |
| `drift-check`                                               | Detect which patches drifted from upstream                                                              |
| `watch [--once] [--interval <sec>]`                         | Daemon: auto-detect drift + regenerate + apply                                                          |
| `update [--tag]`                                            | Consumer: advance to latest tag                                                                         |
| `rollback`                                                  | Consumer: roll back to previous tag                                                                     |
| `status`                                                    | Inspect current state                                                                                   |
| `--version` / `--help`                                      | Version / help                                                                                          |

## How it works

```
USERNAME/.forkhub/         # intent repository (intent = truth)
├── .github/workflows/forkhub-build.yml  # hard-coded reusable builder (all targets)
├── repos/
│   └── github.com/owner/repo/
│       ├── manifest.json
│       ├── build/              # convention #2: BUILD.md, build.sh, CONSUME.md, triggers.md
│       └── patches/
│           └── <patch-id>/
│               ├── INTENT.md         # natural-language spec (source of truth)
│               ├── ACCEPTANCE.md     # verification criteria
│               ├── reference.diff    # last successful realization (evidence only)
│               ├── verify.sh         # runnable verification script
│               └── attempts.jsonl    # history (learn from failures)
└── watch-state.json

USERNAME/repo/                 # your fork
├── main                       # tracks upstream
├── forkhub/main               # built artifact, force-pushed
└── *                          # draft branch (per patch)
```

The core invariant: **intent is truth, diffs are evidence.** When upstream releases v2.1.0, `reference.diff` goes stale. The AI re-reads `INTENT.md` and re-realizes against the new upstream. Same intent, fresh implementation.

## Building your fork release & consuming it

`fh init` scaffolds a hard-coded reusable workflow (`forkhub-build.yml`) that,
per target: clones upstream at the latest tag → applies `reference.diff` in
`manifest.json:apply_order` → runs each `verify.sh` → runs `build/build.sh`
(fallback: patched-source tarball, so any OSS type works) → publishes a
**namespaced** Release `<owner>-<repo>-<upstreamTag>-fhN` (+ `SHA256SUMS`,
`CONSUME.md` in notes). Triggers (push/schedule/manual) are the user's
explicit choice — agents must ask, since they cost tokens/compute.

Builds are discoverable like patches (`fh search` lists `BUILD.md`,
`fh import <BUILD.md url>` reuses them; `fh reuse` stays patch-only).
End users install artifacts per `CONSUME.md`, or track source via
`fh update --tag <owner>-<repo>-vX.Y.Z-fhN`.

## Why this works

- **Intent survives drift.** A good INTENT.md is a specification, not a diff. Re-deriving from intent gives the AI freedom to adapt to renamed files, refactors, and API changes.
- **Drift detection is cheap.** `git log <last_realized>..<upstream> -- <target_area>` tells you if the relevant area changed. Most releases touch nothing important.
- **Verification is mandatory.** Each patch has a runnable `verify.sh`. Failed verification = no auto-promote.
- **Sibling awareness.** When re-deriving patch B, the agent sees patch A's realization in the context bundle and preserves it.

## Real-world example

[forkhub issue #7754 on pingdotgg/t3code](https://github.com/pingdotgg/t3code/issues/7754): an OSC title-sequence leak polluted T3's OpenCode agent inventory (`Agent not found: "\u001b]0;...build"` → `UnknownError`). The fix was built as a forkhub intent-patch, shipped immediately via the patched fork, and opened upstream as [#7755](https://github.com/pingdotgg/t3code/pull/7755) — all tracked by `fh pr-status`, auto-reapplied by `fh watch` on future upstream releases until merged.

Anyone hitting the same bug can get the identical fix:

```bash
fh import https://github.com/ImBIOS/.forkhub/blob/main/repos/github.com/pingdotgg/t3code/patches/fix-t3code-strip-osc-ansi-escapes-from-opencode-cl-y7shx01y/INTENT.md
```

## Sharing & discovering patches

Publish your intents by making your `.forkhub` public (`fh publish`). Import someone else's:

```bash
fh search --target github.com/owner/repo    # find patches for a repo
fh search --author alice                    # browse one user's published patches
fh popular --target github.com/owner/repo   # most-starred first (what to merge upstream)
fh reuse https://github.com/ALICE/.forkhub/blob/main/repos/github.com/owner/repo/patches/<patch-id>/INTENT.md
#   ^ import + re-derivation bundle in one step. Then have your AI agent
#     implement it (/forkhub skill), and run:
fh apply <bundle-path>                      # verify gate + tag
fh update                                   # move your checkout to the new release
```

Imported patches keep author attribution. Re-derivation adapts them to your fork's state.
Search results show ★ stars (publisher-repo stars) as the popularity signal.

## FAQ

**What is forkhub?**
A CLI + workflow for maintaining Git forks that carry custom patches. Patches are stored as natural-language intents and re-derived by AI agents on every upstream release, so your fork never freezes.

**Who is forkhub for?**
Developers whose PR was rejected/stalled upstream but who still need upstream's ongoing fixes; teams running internal forks of OSS; anyone tired of manual rebasing onto new releases.

**How is forkhub different from `git rebase` or `patch-package`?**
Rebase replays stale diffs into conflicts; `patch-package` applies static diffs at install time and breaks when code moves. forkhub stores _what you want_ (intent + acceptance criteria), so an agent produces a fresh implementation each release.

**Does forkhub require an AI agent?**
Re-derivation needs one (OpenCode, Claude Code, Codex, …) via the `/forkhub` skill. Everything else — init, drift detection, tagging, update, rollback, publishing — is plain CLI.

**Are my patches public?**
Only if you publish them (`fh publish` pushes your `.forkhub` git repo to a GitHub repo you control). By default everything stays local.

## Development

```bash
pnpm install
pnpm run dev          # web + server
bun run packages/cli/src/cli.ts status
```

## License

MIT
