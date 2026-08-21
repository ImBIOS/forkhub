# Remotion Demo Script: relay-patch

**Target runtime:** 30 seconds.
**Format:** 1920x1080, 30fps.
**Output:** MP4, H.264, ~5 MB.
**Use cases:** HN submission hero image, README GIF, Twitter embed, blog header.

---

## Composition tree

```
<relay-patch-demo>
  <Scene0_Intro>           frames 0-45    (1.5s)   — logo + tagline
  <Scene1_Problem>         frames 45-120  (2.5s)   — fork-freeze diagram
  <Scene2_Init>            frames 120-195 (2.5s)   — terminal: relay-patch init
  <Scene3_DraftAI>         frames 195-300 (3.5s)   — terminal: AI implements
  <Scene4_Satisfied>       frames 300-360 (2.0s)   — terminal: relay-patch satisfied
  <Scene5_Drift>           frames 360-450 (3.0s)   — upstream release notification
  <Scene6_Rederive>        frames 450-630 (6.0s)   — terminal: AI re-derives
  <Scene7_Update>          frames 630-720 (3.0s)   — terminal: relay-patch update
  <Scene8_Result>          frames 720-810 (3.0s)   — split screen: upstream + patch
  <Scene9_CTA>             frames 810-900 (3.0s)   — npm install + GitHub URL
```

Total: 900 frames @ 30fps = 30.0 seconds.

---

## Scene scripts

### Scene 0 — Intro (frames 0-45, 1.5s)

**Visual:**
- Background: pure black `#000000`
- Logo: "relay-patch" centered, 144px, monospace, color `#7FDBFF` (electric cyan)
- Below logo: "Keep up-to-date upstream + your custom patches." fade-in @ frame 15, 36px, white

**Animation:**
- Logo types in character by character (60ms per char, 13 chars = 780ms)
- Tagline fades in over 30 frames (1s)

**Transition:** hard cut to Scene 1.

---

### Scene 1 — Problem (frames 45-120, 2.5s)

**Visual:**
- Two parallel horizontal timelines (top: upstream, bottom: your fork).
- Upstream timeline shows 4 dots labeled `v1.0.0 v1.1.0 v2.0.0 v2.1.0`, animated left-to-right.
- Your fork timeline shows 1 dot labeled `v2.0.0 + patch`, frozen.
- Big red X between them at frame 90, with text "GAP" in red.
- Text fade-in at frame 90: "Choose: upstream OR your patch. Not both."

**Animation:**
- Upstream dots appear sequentially (15 frames apart, 1s total)
- Your fork dot stays static
- Red X slides in from right at frame 90, settles at center, "GAP" text fades

**Transition:** 15-frame crossfade to Scene 2.

---

### Scene 2 — Init (frames 120-195, 2.5s)

**Visual:**
- Terminal window mockup (rounded rect, dark `#0d1117` bg, `#c9d1d9` text, 28px monospace)
- Terminal title: `~/projects/my-fork — zsh`
- Animated typing: `$ relay-patch init`
- Output appears: green checkmarks for each step
  - `✓ Created .relay-patch repo`
  - `✓ Configured upstream github.com/owner/repo`
  - `✓ Linked patch intent repo`

**Animation:**
- Cursor blink at `$` position (frames 120-140)
- Command types in 100ms/char
- Each output line appears 200ms apart, with green ✓ drawing in via SVG path animation

**Transition:** hard cut to Scene 3.

---

### Scene 3 — Draft AI (frames 195-300, 3.5s)

**Visual:**
- Same terminal window, now in OpenCode context
- Title: `OpenCode — my-fork`
- Prompt: `/relay-patch "add --cheat flag to reveal the secret number"`
- AI response streams in:
  - Branch created: `* → draft-cheat-01j6q3f8`
  - `✓ Read INTENT.md`
  - `✓ Edited index.ts (+12 -1)`
  - `✓ Ran tests`
  - `→ Ready to test`

**Animation:**
- Prompt types in 80ms/char
- AI response streams character by character (30ms/char) for natural feel
- Code edit visualized as diff: red lines removed, green lines added (slide in from left)
- Terminal cursor stays at end of last AI line

**Transition:** 15-frame crossfade.

---

### Scene 4 — Satisfied (frames 300-360, 2.0s)

**Visual:**
- Terminal: same window
- User types: `$ relay-patch satisfied`
- Output:
  - `✓ INTENT.md finalized`
  - `✓ Ported diff to relay-patch/main`
  - `✓ Tagged v2.0.0-rp1`
  - `→ Patch applied: dark-mode-toggle`

**Animation:**
- Command types 100ms/char
- Each ✓ checkmark draws in via SVG path
- Tag line flashes briefly with yellow highlight

**Transition:** hard cut.

---

### Scene 5 — Drift (frames 360-450, 3.0s)

**Visual:**
- Notification popup appears top-right: "upstream/main: new commit (v2.1.0)"
- Below notification: a small timeline animates, showing v2.0.0 → v2.1.0
- Text fade-in: "Upstream moved. Your patch needs re-derivation."

**Animation:**
- Notification slides in from right edge (ease-out, 20 frames)
- Timeline grows left-to-right
- Text types in

**Transition:** 10-frame crossfade.

---

### Scene 6 — Re-derive (frames 450-630, 6.0s, sped up)

**Visual:**
- Terminal: `$ relay-patch watch`
- Output streams in fast (8x speed):
  - `→ Drift detected: cheat-mode-reveal-01j6q3f8`
  - `→ Generating context bundle...`
  - `→ Bundle ready: .relay-patch/bundles/01j6q3f8/`
  - `[AI] Reading INTENT.md...`
  - `[AI] Reading drift-summary.txt...`
  - `[AI] Reading sibling patches...`
  - `[AI] Generating realization.diff...`
  - `[AI] Running verify.sh...`
  - `[AI] ✓ All criteria passed`
  - `→ Tagging v2.1.0-rp1`

**Animation:**
- Lines stream fast, ~5 frames per line
- AI section has subtle "thinking" pulse (background color slightly animates between `#0d1117` and `#161b22`)
- Verify gate has dramatic green glow on success

**Transition:** hard cut.

---

### Scene 7 — Update (frames 630-720, 3.0s)

**Visual:**
- Terminal: same
- `$ relay-patch update`
- Output:
  - `→ Found tag v2.1.0-rp1`
  - `→ Stashing local changes...`
  - `→ Checking out v2.1.0-rp1`
  - `→ Done. Run \`bun run index.ts\` to start.`

**Animation:**
- Command types 100ms/char
- Each step animates the stashed/checkout flow
- Final line glows green

**Transition:** 15-frame crossfade.

---

### Scene 8 — Result (frames 720-810, 3.0s)

**Visual:**
- Split screen:
  - Left half: terminal showing the game running with `--cheat` flag, "🎯 CHEAT MODE: the secret is 42"
  - Right half: terminal showing upstream version info `v2.1.0` with a green checkmark
- Header above split: "Both. Always."

**Animation:**
- Both terminals fade in simultaneously (15 frames)
- Green checkmark on right slides in
- Header fades in last

**Transition:** 15-frame crossfade.

---

### Scene 9 — CTA (frames 810-900, 3.0s)

**Visual:**
- Background: gradient from `#000000` to `#0a1929`
- Centered:
  - "relay-patch" logo (96px, cyan)
  - `$ npm i -g relay-patch` (48px, white)
  - `$ brew install ImBIOS/tap/relay-patch` (36px, gray)
  - `github.com/ImBIOS/relay-patch` (32px, cyan, fades in last)
- End card: small "Built with Bun 🧡" in bottom-right (24px, gray)

**Animation:**
- Logo stays static
- Each install command fades in sequentially (15 frames apart)
- GitHub URL fades in last with cyan glow
- "Built with Bun" fades in last 30 frames

**Transition:** none — ends on this scene.

---

## Assets needed

### Terminal recordings (record with asciinema + agg)

These will be exported as static frames (or slow-looped MP4s) and overlaid in Remotion.

| Scene | Asset | Format | Source |
|---|---|---|---|
| 2 | `relay-patch init` output | text JSON | Run live, capture with `script` |
| 3 | OpenCode AI response | text JSON | Run live, capture |
| 4 | `relay-patch satisfied` output | text JSON | Run live |
| 6 | `relay-patch watch` output | text JSON | Run live |
| 7 | `relay-patch update` output | text JSON | Run live |

**Capture script** (`scripts/capture-demo.sh`):
```bash
#!/usr/bin/env bash
# Run each demo step with deterministic timing, capture output to JSON
set -e
mkdir -p assets/demo

asciinema rec --overwrite --cols 120 --rows 32 assets/demo/init.cast \
  -- bash -c "relay-patch init"
agg assets/demo/init.cast assets/demo/init.gif

# ... repeat for each scene
```

### Static assets

| Asset | Source |
|---|---|
| `relay-patch` wordmark | Generate with `figlet -f slant` or design in Figma |
| GitHub URL badge | Plain text |
| Terminal window mockup | Custom React component in Remotion |
| Diff visualization (Scene 3) | Generate from real `git diff` output |

---

## Remotion project structure

```
relay-patch-demo/                    # new repo: ImBIOS/relay-patch-demo
├── src/
│   ├── Root.tsx                     # main composition
│   ├── scenes/
│   │   ├── Intro.tsx
│   │   ├── Problem.tsx
│   │   ├── Init.tsx
│   │   ├── DraftAI.tsx
│   │   ├── Satisfied.tsx
│   │   ├── Drift.tsx
│   │   ├── Rederive.tsx
│   │   ├── Update.tsx
│   │   ├── Result.tsx
│   │   └── CTA.tsx
│   ├── components/
│   │   ├── Terminal.tsx             # reusable terminal window
│   │   ├── AnimatedText.tsx         # type-on effect
│   │   ├── Timeline.tsx             # upstream/fork diagram
│   │   └── Checkmark.tsx            # SVG ✓ with draw-in animation
│   └── assets/                      # imported as static files
│       ├── terminal-font/
│       └── bg-gradient.png
├── remotion.config.ts
├── package.json
└── README.md
```

---

## Build commands

```bash
# Install
bunx create-video@latest --template=blank relay-patch-demo
cd relay-patch-demo
bun install

# Develop (live preview)
bunx remotion studio src/Root.tsx

# Render
bunx remotion render src/Root.tsx relay-patch-demo out/demo.mp4 \
  --concurrency=4 \
  --codec=h264 \
  --crf=18

# Export GIF (for README, smaller)
bunx remotion render src/Root.tsx relay-patch-demo out/demo.gif \
  --codec=gif

# Export stills (for OG images, Twitter cards)
bunx remotion still src/Root.tsx relay-patch-demo out/og-image.png \
  --frame=450
```

---

## Distribution plan for the rendered video

| Surface | Format | Notes |
|---|---|---|
| `relay-patch` repo README hero | `<video>` tag or autoplay GIF | Primary CTA |
| HN submission | MP4 link in post body | Top-of-feed video increases dwell time |
| Twitter/X | MP4 upload (15s/30s supported) | Native upload beats link |
| ImBIOS/blog-imbios-dev blog post header | Auto-playing muted GIF | Hero image |
| LinkedIn | MP4 link in post | Different audience from HN |
| TikTok / YouTube Shorts | 9:16 crop variant | Reach non-devs |
| `docs.imbios.dev` (future) | MP4 + GIF fallback | Embedded in "What is relay-patch?" |

---

## Open follow-ups

- [ ] Set up the actual Remotion project repo (`ImBIOS/relay-patch-demo`).
- [ ] Capture terminal recordings (deterministic scripts).
- [ ] Iterate on Scene 3 (AI response) — needs to feel "AI thinking" not "AI done."
- [ ] Make a 9:16 vertical variant for TikTok/Shorts.
- [ ] Add captions (auto-generated, hand-edited) for accessibility + silent autoplay.

---

## Estimated effort

- Asset capture: 1 hour (live, in dry-run fork).
- Component build: 4-6 hours (10 scenes, shared components).
- Polish + audio (subtle, optional): 2 hours.
- Total: ~1 day to v1 of the video.

ROI: this single asset is the difference between "good HN submission" and "viral HN submission." Worth the day.
