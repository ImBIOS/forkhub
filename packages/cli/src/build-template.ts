import { existsSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";

/**
 * Convention #2/#3 scaffolding: building the intent-patched repo and
 * consuming the built release.
 *
 * - The GitHub Actions workflow is HARD-CODED and reusable: one generic
 *   `forkhub-build.yml` handles every target under `repos/`. Agents and
 *   users never hand-write CI per repo; they only fill the per-target
 *   `build/` descriptors (BUILD.md / build.sh / CONSUME.md / triggers.md).
 * - Templates live here as string constants (not separate files) so the
 *   compiled `bun build --compile` binary carries them.
 * - Release tags are NAMESPACED per target (`<owner>-<repo>-<upstreamTag>-fhN`)
 *   because a single `.forkhub` repo hosts many targets; bare `v*-fh*`
 *   would collide.
 */

export function targetSlug(targetRepo: string): string {
  // "github.com/pingdotgg/t3code" -> "pingdotgg-t3code"
  const parts = targetRepo.split("/").filter(Boolean);
  const slug = parts
    .slice(-2)
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "unknown-target";
}

/** Namespaced release tag for `.forkhub` Releases. */
export function releaseTagFor(targetRepo: string, upstreamTag: string, n: number): string {
  const clean = upstreamTag.startsWith("v") ? upstreamTag : `v${upstreamTag}`;
  return `${targetSlug(targetRepo)}-${clean}-fh${n}`;
}

export function buildWorkflowYaml(): string {
  return `name: forkhub build

# Hard-coded reusable builder for ALL intent-patched targets in this .forkhub repo.
# Per-target customization lives in repos/<host>/<owner>/<repo>/build/ (BUILD.md,
# build.sh, CONSUME.md, triggers.md) — never in this file. Safe to leave as-is.
#
# Triggers: push to repos/**, daily schedule (upstream-release polling), manual.
# The per-target build/triggers.md records the USER-EXPLICIT trigger choice
# (an agent must ask the user; triggers affect token/compute spend). To change
# the poll cadence, edit the cron below.

on:
  push:
    paths:
      - "repos/**"
  schedule:
    - cron: "0 6 * * *"
  workflow_dispatch:
    inputs:
      target:
        description: "Only build this target, e.g. github.com/owner/repo (empty = all)"
        required: false
        default: ""

permissions:
  contents: write

jobs:
  discover:
    runs-on: ubuntu-latest
    outputs:
      targets: \${{ steps.list.outputs.targets }}
    steps:
      - uses: actions/checkout@v6
      - id: list
        run: |
          set -euo pipefail
          FILTER="\${{ inputs.target }}"
          TARGETS=$(for m in repos/*/*/*/manifest.json; do
            [ -f "$m" ] || continue
            t=$(dirname "$m" | sed 's|^repos/||')
            if [ -n "$FILTER" ] && [ "$t" != "$FILTER" ]; then continue; fi
            printf '%s\\n' "$t"
          done | jq -R . | jq -cs .)
          echo "targets=$TARGETS" >> "$GITHUB_OUTPUT"

  build:
    needs: [discover]
    if: needs.discover.outputs.targets != '[]'
    strategy:
      fail-fast: false
      matrix:
        target: \${{ fromJson(needs.discover.outputs.targets) }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          path: forkhub

      - name: Resolve upstream + patch stack
        id: ctx
        working-directory: forkhub
        run: |
          set -euo pipefail
          M="repos/\${{ matrix.target }}/manifest.json"
          U="repos/\${{ matrix.target }}/upstream.json"
          echo "upstream_url=$(jq -r .upstream_url "$U")" >> "$GITHUB_OUTPUT"
          echo "upstream_branch=$(jq -r .upstream_main_branch // "main" "$U")" >> "$GITHUB_OUTPUT"
          echo "order=$(jq -c .apply_order "$M")" >> "$GITHUB_OUTPUT"

      - name: "Clone upstream at latest tag (fallback: main branch)"
        run: |
          set -euo pipefail
          rm -rf build && mkdir -p build
          URL="\${{ steps.ctx.outputs.upstream_url }}"
          # Support only remote URLs here; file:// fixtures are for local tests.
          TAG=$(git ls-remote --tags --sort=-v:refname "$URL" \\
            | grep -o 'refs/tags/v[^^{}]*' | head -1 | cut -d/ -f3 || true)
          if [ -n "$TAG" ]; then
            git clone --depth 1 --branch "$TAG" "$URL" build
            echo "$TAG" > upstream_tag.txt
          else
            git clone --depth 1 --branch "\${{ steps.ctx.outputs.upstream_branch }}" "$URL" build
            echo "v0.0.0" > upstream_tag.txt
          fi
          echo "UPSTREAM_TAG=$(cat upstream_tag.txt)" >> "$GITHUB_ENV"

      - name: Apply intent stack in manifest order + verify gate
        working-directory: forkhub
        run: |
          set -euo pipefail
          for id in $(jq -r '.apply_order[]' "repos/\${{ matrix.target }}/manifest.json"); do
            p="repos/\${{ matrix.target }}/patches/$id"
            echo "→ $id"
            git -C ../build apply --check "$p/reference.diff"
            git -C ../build apply "$p/reference.diff"
            if [ -x "$p/verify.sh" ]; then
              (cd ../build && sh "../forkhub/$p/verify.sh")
            fi
          done

      - name: Repo-native build (or source tarball fallback)
        run: |
          set -euo pipefail
          mkdir -p dist
          if [ -x "forkhub/repos/\${{ matrix.target }}/build/build.sh" ]; then
            (cd build && sh "../forkhub/repos/\${{ matrix.target }}/build/build.sh")
          fi
          if [ -z "$(ls -A dist)" ]; then
            # Default supports ANY repo type: ship the verified patched source.
            # A placeholder build.sh is a deliberate no-op, so fresh scaffolds
            # stay green until the agent fills in the repo-native build.
            SLUG=$(echo "\${{ matrix.target }}" | awk -F/ '{print $(NF-1)"-"$NF}' | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9' '-')
            tar -czf "dist/$SLUG-patched-source.tar.gz" -C build .
          fi
          (cd dist && sha256sum * > SHA256SUMS || shasum -a 256 * > SHA256SUMS)

      - name: Publish namespaced release
        working-directory: forkhub
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: |
          set -euo pipefail
          SLUG=$(echo "\${{ matrix.target }}" | awk -F/ '{print $(NF-1)"-"$NF}' | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9' '-')
          UP="$UPSTREAM_TAG"
          N=1
          while gh release view "$SLUG-$UP-fh$N" --repo "$GITHUB_REPOSITORY" >/dev/null 2>&1; do N=$((N+1)); done
          TAG="$SLUG-$UP-fh$N"
          NOTES=$(mktemp)
          {
            echo "# $TAG"
            echo
            echo "Patched build of \`\${{ matrix.target }}\` @ \`$UP\` + intent stack."
            if [ -f "repos/\${{ matrix.target }}/build/CONSUME.md" ]; then
              echo
              cat "repos/\${{ matrix.target }}/build/CONSUME.md"
            fi
          } > "$NOTES"
          gh release create "$TAG" ../dist/* --repo "$GITHUB_REPOSITORY" --title "$TAG" --notes-file "$NOTES"
`;
}

export function buildMd(targetRepo: string): string {
  return `---
target_repo: ${targetRepo}
artifacts: [patched-source-tarball]
toolchain: ./build.sh (edit for your repo: bun build / npm pack / docker build / ...)
outputs: dist/*
---

## Build intent

How to turn upstream \`${targetRepo}\` + the intent stack in \`../patches/\`
(applied in \`manifest.json:apply_order\`) into a working release.

## How (agent: fill this in, ask the user first)

1. Confirm the trigger with the user and record it in \`triggers.md\`
   (triggers affect LLM token + CI spend — never assume).
2. Replace \`build.sh\` with the repo-native build
   (e.g. \`bun build --compile\`, \`npm pack\`, \`docker build\`).
   Until \`build.sh\` writes artifacts to \`dist/\`, CI ships the verified
   patched source as a tarball, which works for ANY OSS type:
   CLI, GUI, AppImage/dmg/exe, Next.js, etc.
3. Describe every install vector in \`CONSUME.md\` (binary, npm, docker, brew, source).

## Reuse

This file is discoverable via \`fh search --target ${targetRepo}\`
alongside the patch INTENTS. Import it with:

\`\`\`bash
fh import https://github.com/<user>/.forkhub/blob/main/repos/${targetRepo}/build/BUILD.md
\`\`\`
`;
}

export function buildSh(targetRepo: string): string {
  return `#!/bin/sh
# Repo-native build for ${targetRepo}.
# Runs with CWD = clean upstream checkout AFTER the intent stack was applied
# and every verify.sh passed. Place artifacts in ../dist/.
# Agent: replace the body with the upstream's own build. Examples:
#   bun build --compile --target=bun-linux-x64 --outfile=../dist/app ./src/main.ts
#   npm pack --pack-destination ../dist
#   docker build -t "app:$(cat ../upstream_tag.txt)" .
# Until then this is a deliberate no-op (exit 0, empty dist/) and CI falls
# back to shipping the verified patched source as a tarball.
set -eu
mkdir -p ../dist
echo "(build.sh placeholder for ${targetRepo} — fill in the repo-native build)" >&2
`;
}

export function consumeMd(targetRepo: string): string {
  const slug = targetSlug(targetRepo);
  return `---
target: ${targetRepo}
tag_pattern: ${slug}-<upstreamTag>-fh<N>
artifacts: [patched-source-tarball]
---

## Install

\`\`\`bash
TAG=${slug}-vX.Y.Z-fh1  # pick a tag from Releases
curl -fsSL "https://github.com/<user>/.forkhub/releases/download/$TAG/${slug}-patched-source.tar.gz" -o app.tar.gz
sha256sum -c SHA256SUMS  # from the same Release
tar -xzf app.tar.gz
\`\`\`

## Verify

Run the upstream's own checks plus each patch's \`verify.sh\` criteria
(see \`../patches/*/ACCEPTANCE.md\`).

## Run

Repo-specific — document the binary/container/page entrypoint here.
(Agent: fill this in when you write \`build.sh\`.)
`;
}

export function triggersMd(targetRepo: string): string {
  return `# Triggers — ${targetRepo}

> An agent MUST ask the user explicitly which triggers to enable.
> Triggers affect LLM token consumption and CI/compute spend — never assume.

- [ ] \`push\` (default ON): build on every push to \`repos/${targetRepo}/**\`
- [ ] \`schedule\` (default ON, daily \`0 6 * * *\`): poll upstream releases.
  Increase cadence only with user approval.
- [ ] \`workflow_dispatch\` (always ON): manual + \`fh\`-triggered rebuilds.

Decision log:

| date | who | decision | reason |
|---|---|---|---|
| | | | |

To change cadence/scope, edit \`.github/workflows/forkhub-build.yml\` (cron)
or pass \`target\` to manual dispatches. This file is the record of intent.
`;
}

export function scaffoldBuildFiles(
  forkhubDir: string,
  targetRepo: string,
): {
  workflow: string;
  buildDir: string;
  created: string[];
} {
  const created: string[] = [];

  const workflowPath = join(forkhubDir, ".github", "workflows", "forkhub-build.yml");
  if (!existsSync(workflowPath)) {
    mkdirSync(join(forkhubDir, ".github", "workflows"), { recursive: true });
    writeFileSync(workflowPath, buildWorkflowYaml());
    created.push(workflowPath);
  }

  const buildDir = join(forkhubDir, "repos", targetRepo, "build");
  const files: Array<[string, string, boolean]> = [
    [join(buildDir, "BUILD.md"), buildMd(targetRepo), false],
    [join(buildDir, "build.sh"), buildSh(targetRepo), true],
    [join(buildDir, "CONSUME.md"), consumeMd(targetRepo), false],
    [join(buildDir, "triggers.md"), triggersMd(targetRepo), false],
  ];
  for (const [path, content, executable] of files) {
    if (!existsSync(path)) {
      mkdirSync(buildDir, { recursive: true });
      writeFileSync(path, content);
      if (executable) {
        try {
          chmodSync(path, 0o755);
        } catch {}
      }
      created.push(path);
    }
  }

  return { workflow: workflowPath, buildDir, created };
}
