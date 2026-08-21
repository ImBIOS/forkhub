# Blog draft: launch tweet / Twitter thread

**Use:** as the launch tweet + thread on launch day.
**Tone:** punchy, no-BS, links in last tweet.

---

## Tweet 1 (the hook)

```
i built a tool that lets you keep your custom OSS fork forever
and never miss an upstream release.

the trick: AI re-derives your patch from INTENT (not diff) every
time upstream moves.

state machine per patch. verify gate. zero silent drift.

open source today 🧵
```

## Tweet 2 (the problem)

```
the pain: you forked an OSS tool, maintainer rejected your PR,
you want their fixes AND your feature.

today: pick one.
- upstream: lose your patch
- your fork: lose upstream features

i hit this 3 times last quarter. so i built relay-patch.
```

## Tweet 3 (the insight)

```
the insight: a good patch description is a spec, not a diff.

"add --cheat flag, print before banner, don't touch game.ts"
is enough for a competent engineer to re-implement against
any version of the code.

so i built a tool that turns that description into a first-class object.
```

## Tweet 4 (the model)

```
USERNAME/.relay-patch/    # intent repo (truth)
└── patches/<id>/
    ├── INTENT.md         # natural language (the truth)
    ├── ACCEPTANCE.md     # pass/fail criteria
    ├── reference.diff    # last realization (evidence)
    └── verify.sh         # runnable gate

your fork
├── main                  # upstream
├── relay-patch/main      # built artifact, force-pushed
└── *                     # draft branches
```

## Tweet 5 (the state machine)

```
state machine per patch:

DRAFTING → APPLIED → DRIFTED → RE-DERIVING → APPLIED
              ↑                                │
              └────── NEEDS_HUMAN ←────────────┘ (3 retries max)

or happy path: RE-DERIVING → UPSTREAMED → RETIRED
(the AI detects upstream now natively satisfies the intent)
```

## Tweet 6 (the gate)

```
the only path to APPLIED: verification gate.

✓ build passes
✓ tests pass
✓ every acceptance criterion = pass (no "unknown")
✓ sibling patches still work
✓ diff sanity (not catastrophically large)

gate red after 3 retries → NEEDS_HUMAN → user fixes manually.

no silent drift. ever.
```

## Tweet 7 (the install)

```
install:

brew tap ImBIOS/tap && brew install relay-patch
# or
npm i -g relay-patch

ships with:
- 14 CLI commands
- OpenCode skill for /relay-patch slash command
- watch daemon (auto-detects drift)
- standalone binaries for macOS + linux (x64 + arm64)
- all 4 platforms via homebrew, npm, github packages
```

## Tweet 8 (the validation)

```
i didn't ship until 5 cold-start LLM tests passed:

1. single-patch drift (patch survives upstream release)
2. multi-patch sibling awareness
3. drift with siblings (sequential re-derive)
4. CLI consumer prototype (update + rollback)
5. producer commands (init + draft + satisfied)

all 5 documented in _local/. with diffs, prompts, output.
```

## Tweet 9 (the ask)

```
if you've ever:
- forked an OSS project
- had a PR rejected
- wanted both upstream + your patch

give it a try.

github: github.com/ImBIOS/relay-patch
npm: npmjs.com/package/relay-patch

inspired by @theo's video on patch-based workflows.
```

## Tweet 10 (the thanks)

```
built with 🧡 + Bun.

thanks to:
- @jarredsumner for Bun (this whole thing compiles to a 60MB binary)
- @theo for the original idea (his video cracked it open for me)
- the OSS projects i forked that made me need this in the first place

questions? roast the design in the replies. i'll be there.
```

---

## Image / video assets

Tweet 1: hero image (Remotion Scene 9 — the install commands).
Tweet 4: state machine ASCII art as image (clean monospace, dark bg).
Tweet 9: 30-sec terminal demo GIF (Remotion render).
Tweet 10: thank-you card.

## Hashtags (don't overdo it)

None. Twitter dev audience prefers no hashtags. If must: `#OpenSource` on Tweet 9 only.

## Tagging

Tweet 9 explicitly tags `@theo` per user's spec.
Tweet 10 tags `@jarredsumner` (Bun).
Optional: tag `@mitchellh` if he's actively forking things (check his recent tweets).
