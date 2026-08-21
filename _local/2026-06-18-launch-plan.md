# Launch Plan: relay-patch v0.2.2

**Goal:** maximize GitHub stars + active users for `ImBIOS/relay-patch`.

**Horizon:** 30 / 60 / 90 days.

**Definition of success:**
- 30d: 1,000 stars, 100 weekly npm downloads, 10 forks with `.relay-patch`
- 60d: 3,000 stars, 500 weekly npm downloads, 50 forks with `.relay-patch`
- 90d: 5,000 stars, 1,500 weekly npm downloads, 150 forks with `.relay-patch`

---

## Why this can work (positioning)

The pain is universal, the audience is identifiable, and the "killer demo" is visual:

- **Pain:** every OSS user who's forked a project and lost upstream OR lost their patch.
- **Audience:** developers who maintain personal forks of OSS tools (huge — npm shows 100k+ projects with >1 fork).
- **Demo:** side-by-side terminal showing upstream release → AI re-derives patch → consumer `relay-patch update`. 30 seconds, visceral.
- **Category creator:** "intent-as-patch" / "AI patch manager." We get to name it.
- **Credibility:** validated by 5 cold-start LLM tests documented in `_local/`.

**Named competitors:** none. Closest comparisons are GitHub cherry-pick workflows, git rebases, and "AI code editors" — all much heavier or much shallower. No one owns "AI patches against your fork."

**Risk:** category education is expensive. Mitigated by 30-sec demo + shareable one-liner.

---

## Distribution channels (ranked by ROI)

### Tier 1 — Direct code-hunter communities (high-intent, technical)

| Channel | Asset | Owner | Timing |
|---|---|---|---|
| **Hacker News** (`Show HN`) | 30-sec terminal demo video + "Show HN: relay-patch — your fork + upstream, AI merges the diffs" | You | Day 1 |
| **r/Programming** (Reddit) | Same HN post adapted for Reddit format | You | Day 1 (after HN) |
| **r/commandline**, **r/git**, **r/node**, **r/programming** | Cross-post 24h later | You | Day 2 |
| **Lobsters** | Tagged `show`, `git`, `cli` | You | Day 1 |
| **Dev.to** | Long-form technical post: "Why your fork can't keep up with upstream (and how AI fixes it)" | You | Day 3 |
| **lobste.rs** c/w post | Same as HN | You | Day 3 |

**Goal:** 1 frontpage hit. A `Show HN` at top of /best = 500-2000 stars in 24h.

**Tactic:**
- Lead with the demo GIF/video — no walls of text.
- Title formula: "Show HN: relay-patch – X" where X is the punchline.
- One-paragraph "what" + bullet-list "why this is hard" + link.
- Reply to every comment in first 4 hours.
- Time HN submission for 8-9am ET Tuesday/Wednesday (peak).

### Tier 2 — Influencer / thought-leader amplification (high-reach)

| Person | Channel | Angle | Status |
|---|---|---|---|
| **@theo** (T3 Chat) | YouTube + Twitter/X | Project inspired by his video idea (link the video) | You tag him on launch tweet |
| **@mitchellh** (HashiCorp) | Twitter | Loves CLI tools, fork-and-maintain workflows | DMs likely ignored; tweet-tag |
| **@antirez** (Redis) | Twitter | Anti-cloud, pro-fork workflows | Likely no response but free reach |
| **@fabiospampinato** (Vite/Surreal) | Twitter | Bun ecosystem creator attention | Tag on launch |
| **@jarredsumner** (Bun) | Twitter | Built on Bun — Bun team loves to amplify | Tag explicitly |
| **@swyx** | Twitter + devrel community | DX/AI/devrel pipeline | Tweet-tag |
| **ThePrimeTime** / **@ThePrimeagen** | YouTube | Fork-merging is his bread and butter | DM for review |

**Critical tactic:** the user explicitly mentioned Theo as inspiration source. The launch tweet should literally say "Inspired by @theo's video on X — built it as a working tool." This earns both amplification + authentic framing.

**Goal:** 1 reshare from a 100k+ follower dev = 200-1000 stars in 24h.

### Tier 3 — Niche aggregators + AI tool directories

| Directory | URL | Auto-submit? |
|---|---|---|
| Product Hunt | producthunt.com | Manual — schedule for Tue/Wed 12:01am PT |
| awesome-coding-agents | github.com/ImBIOS/awesome-coding-agents (forked) | Add entry to README |
| awesome-bun | github.com/oven-sh/awesome-bun | PR |
| awesome-cli | various | PR to multiple |
| AI tool directories | theresanaiforthat.com, futuretools.io, aiagentslist.com | Submit forms |
| OpenAPI/CLI indexes | cli.rs, terminaltrove.com | Submit |
| npm trends | (organic — npm ranks by downloads) | Just keep downloads growing |

**Goal:** 5 directory listings = durable long-tail SEO.

### Tier 4 — Content + SEO (slow burn, compounding)

| Asset | Where | Cadence |
|---|---|---|
| Long-form blog post | ImBIOS/blog-imbios-dev (multilang) | Day 1 |
| YouTube tutorial: "I forked X, maintainer rejected my PR, here's what I did" | YouTube | Day 7 |
| Twitter thread: "The 5 cold-start LLM tests that convinced me this works" | Twitter/X | Day 3 |
| TikTok/Shorts: 30-sec terminal demo with trending audio | TikTok, YouTube Shorts | Day 14 |
| Newsletter: bun.sh weekly + TLDR | Submit | Day 7 |
| Podcast: appearances on Changelog, JS Party, DevTools.fm | DMs | Day 30+ |
| Conference talks: AI engineer summit, bun.conf, GitHub universe | Submit CFPs | Day 60+ |

**Goal:** 1 piece of content per week for 12 weeks. Compounding traffic.

---

## Killer demo (the single most important asset)

A 30-second screen recording showing:

1. `relay-patch init` in a fork (3 sec)
2. `/relay-patch "add dark mode"` in OpenCode → AI implements on `*` branch (8 sec)
3. `relay-patch satisfied` → diff ported, intent saved (3 sec)
4. *(skip ahead)* upstream releases v2.0
5. `relay-patch watch` runs → AI re-derives the patch (8 sec, sped up)
6. `relay-patch update` in the consumer's working dir → fresh build with both upstream + patch (3 sec)
7. End card: "npm i -g relay-patch" + GitHub URL (3 sec)

**Distribution:** Twitter, HN submission, README hero image, blog header, TikTok.

**Tooling:** `asciinema` for terminal capture, `ffmpeg` for editing, `remotion` for the polished version.

---

## Week-by-week tactical plan

### Week 1 — Launch

| Day | Action |
|---|---|
| Mon | Record + edit killer demo video. Publish blog post (ImBIOS blog). |
| Tue 8am ET | Submit to HN (`Show HN`). Tweet-tag Theo, jarredsumner, swyx, mitchellh. |
| Tue | Submit to Product Hunt. Post to Reddit r/programming, r/git. |
| Wed | Submit to Lobsters, Dev.to, awesome-* lists. |
| Thu | Twitter thread: "5 cold-start LLM tests." |
| Fri | YouTube tutorial. DM ThePrimeagen, mitchellh for review. |
| Sat-Sun | Engage with every comment, every star-gazer, every fork. |

**Target:** 500-1500 stars. 50+ forks with `.relay-patch`.

### Week 2-4 — Sustain

- 1 piece of content per week (long-form blog, tweet thread, or video).
- Daily HN/Reddit/Twitter engagement with OSS fork-related discussions.
- Submit to 1 new directory per week.
- Respond to every issue within 24h.
- DM 1 podcaster/week for appearance.

**Target:** 1000-3000 stars. 500 weekly npm downloads.

### Week 5-12 — Compound

- Conference CFPs submitted (AI Engineer Summit, bun.conf, GitHub Universe).
- First podcast appearances go live.
- "Featured patch of the week" series on Twitter (showcases Patch Directory).
- Co-marketing with Bun team (jarred is amplifying-worthy).
- v0.3 with dogfooding findings ships (real patches from real forks = social proof).

**Target:** 3000-5000 stars. 1500 weekly npm downloads.

---

## Headline KPI dashboard

Track weekly:

| Metric | Tool | Target (90d) |
|---|---|---|
| GitHub stars | gh api | 5,000 |
| GitHub forks | gh api | 300 |
| npm weekly downloads | npmjs.com | 1,500 |
| `relay-patch search` calls | (instrument v0.3) | 500/mo |
| `.relay-patch` repos on GitHub | gh code search | 150 |
| Discord/Discussions active users | GitHub Discussions | 50 |

---

## Risks + mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| HN post flops (<100 points) | Medium | Medium | Re-submit 2 weeks later with different angle. Tweet-first to build momentum, then HN. |
| "Just use git rebase" / "AI can't do this" comments | High | Low | Reply with cold-start test results linked. Don't argue, point to evidence. |
| Critical bug found in first 100 users | Medium | High | Have v0.2.3 hotfix process ready. Respond in <4h. |
| A maintainer gets mad ("this encourages fork-drift") | Low | Medium | Frame as "fork-and-contribute-back" — patches are designed to be PR-able. |
| Imitator launches similar tool | Medium | Medium | Speed + community + cold-start validation. We have 5 tests documented publicly. |
| Token cost shock (watch daemon = AI costs) | Medium | High | Document `target_area` skip as default. Add dry-run `--plan-only`. |

---

## What I'm NOT doing (anti-patterns)

- ❌ Astroturfing / fake reviews
- ❌ Paid promotion before organic traction
- ❌ Excessive marketing copy in README (current README is honest, keep it)
- ❌ Discord-spam in unrelated servers
- ❌ "AI will replace maintainers" framing (hostile to OSS community)
- ❌ Promising things the tool can't do (the design is honest about limits)

---

## What success looks like at 90 days

- 5,000 stars
- 150+ `.relay-patch` repos in the wild (search returns real results)
- 5 podcast appearances
- 1 conference talk accepted
- v0.3 shipped based on dogfooding findings
- A "forking manifesto" blog post that gets shared independently

The end state: **"If you're forking an OSS project and don't use relay-patch, you're doing it wrong"** — a meme that's true.
