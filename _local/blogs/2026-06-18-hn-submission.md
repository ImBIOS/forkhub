# Blog draft: HN submission (Show HN)

**URL:** https://news.ycombinator.com/show/new
**Title:** Show HN: relay-patch – AI-merges upstream into your OSS fork (intent, not diffs)
**Body:**

---

I built a CLI tool that solves the "fork-and-freeze" problem: you maintain an OSS fork with custom patches, the upstream maintainer rejected your PR, and you want both their fixes AND your feature. Today you pick one.

relay-patch treats your patch as **intent**, not a diff. You write an INTENT.md ("add --cheat flag, print before banner, don't touch game.ts"). An AI agent re-derives the patch from intent against every new upstream release. You run `relay-patch update` and get both.

What's in the box:

- 14 CLI commands (`init`, `draft`, `satisfied`, `import`, `search`, `re-derive`, `apply`, `drift-check`, `watch`, `update`, `rollback`, etc.)
- An OpenCode skill for the `/relay-patch` slash command
- A watch daemon that auto-detects drift and generates AI context bundles
- Standalone binaries for macOS + linux (x64 + arm64)
- Distributed via npm, Homebrew, GitHub Packages

The state machine per patch has 7 states (DRAFTING → APPLIED → DRIFTED → RE-DERIVING → APPLIED/NEEDS_HUMAN/UPSTREAMED/RETIRED) with one dangerous edge: the transition to APPLIED. Only an AI realization that passes a verify gate (build + tests + acceptance criteria + sibling checks + diff sanity) can promote. Anything that fails after 3 retries blocks `relay-patch/main` from advancing — no silent drift.

I validated the whole premise with 5 cold-start LLM tests before shipping v0.1: single-patch drift, multi-patch sibling awareness, drift-with-siblings sequential re-derive, CLI consumer prototype, and producer commands. All 5 writeups are in `_local/` with diffs, prompts, and verification output.

GitHub: https://github.com/ImBIOS/relay-patch
Inspired by @theo's video on patch-based workflows.

---

## Notes for posting

- **Title formula:** "Show HN: <project> – <punchline>"
- **Posting time:** Tuesday or Wednesday, 8-9am ET.
- **First 4 hours:** respond to every comment. Don't argue, point to evidence.
- **Re-submit policy:** if it flops, wait 2 weeks, re-submit with a different angle (e.g., focus on "AI-augmented dev tools" instead of "fork management").
- **Don't:** link to blog post (HN penalizes self-promotion). Just the GitHub link.
