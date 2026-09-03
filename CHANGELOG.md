# Changelog

All notable changes to forkhub are documented here.

## [0.3.0] - 2026-09-03

First generally-available release. Install via `npm install -g forkhub`
(stable `latest` channel), Homebrew, or a standalone binary from GitHub Releases.

### Added

- `fh --version` / `fh -v` / `fh version` — print the installed version
- `fh link-pr <patch-id|branch> <pr-number|pr-url>` — link an existing
  upstream PR (opened via `gh pr create` or the web UI) to a patch so
  `fh publish` no longer blocks on it
- `bun test` suite in `packages/cli/tests` (17 tests: patch-id units,
  default-branch detection, init → draft → satisfied e2e on a
  `master`-default repo, link-pr, search retry) — wired into `test.yml`
  and as a gate in `publish.yml` (canary + stable)

### Fixed

- Upstream default-branch autodetection: `init` records the real default
  branch (`git ls-remote --symref`, `git remote show` fallback) instead of
  hardcoding `main`; `draft`, `pr`, and `satisfied` resolve it from the
  manifest with git fallbacks. `master`-default upstreams no longer need
  manual `manifest.json`/`upstream.json` edits
- `fh pr` uses `manifest.upstream_main_branch` for `--base` (was hardcoded
  `main`) and queries existing PRs via `gh` (was a broken `git pr` fallback)
- `fh search` retries transient GitHub failures (408/429/5xx, incl. 504s)
  with exponential backoff, honors `GH_TOKEN`/`GITHUB_TOKEN`, resolves the
  author's `.forkhub` default branch instead of assuming `main`
- `fh publish` auto-links open upstream PRs by branch name before blocking
  on missing issue+PR tracking

## [0.2.0] - [0.2.11] - 2026-06-19 – 2026-08-25

- `pr` — push branch + open upstream PR, track in manifest
- `publish` — push `.forkhub` intent repo (requires open issue+PR by default)
- `search` — find published patches by author or target repo
- `pr-status` / drift PR-state tracking (`open`/`merged`/`closed`, UPSTREAMED)
- Human-readable `drift-check` output
- Canary + stable release pipeline (npm Trusted Publisher, 4-platform
  binaries + SHA256SUMS, Homebrew formula, rolling `canary` GitHub Release)
- `forkhub-bot` PR preview comments with intent-patch reuse info

## [0.1.0] - 2026-06-18

### Added

- `init` — set up `.forkhub` repo and upstream config
- `draft "<intent>"` — create a draft branch with intent template
- `satisfied` — finalize intent, capture diff, port to `forkhub/main`, tag
- `import <github-url>` — import a patch from another user's `.forkhub`
- `re-derive <patch-id>` — generate re-derivation context bundle
- `apply <bundle-path>` — apply realization from bundle with verify gate
- `drift-check` — detect drift with target_area cost optimization
- `watch [--once] [--interval N]` — daemon: detect → bundle → apply loop
- `update [--tag]` — consumer: advance to latest tag
- `rollback` — consumer: roll back to previous tag
- `status` — show current state
- OpenCode skill at `.opencode/skills/forkhub/SKILL.md` for AI-assisted
  DRAFTING and RE-DERIVATION
- Docker-based orchestrator test in `Dockerfile` + `test-orchestrator.sh`

### Validated

5 cold-start LLM tests documented in `_local/`:

- Single-patch drift re-derivation
- Multi-patch sibling awareness
- Drift-with-siblings sequential re-derivation
- CLI consumer prototype
- Producer-side commands
