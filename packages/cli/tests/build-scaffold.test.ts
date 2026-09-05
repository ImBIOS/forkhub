import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../src/init";
import { runImport } from "../src/import";
import { runReuse } from "../src/reuse";
import { targetSlug, releaseTagFor } from "../src/build-template";
import { formatSearchResults } from "../src/search";

let dir: string;
let fork: string;
let prevCwd: string;
const originalFetch = globalThis.fetch;

async function sh(args: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  if (code !== 0) throw new Error(`git ${args.join(" ")} failed: ${err || out}`);
  return out.trim();
}

const BUILD_MD = `---
target_repo: github.com/test/other
artifacts: [patched-source-tarball]
---

## Build intent
`;

const BUILD_URL =
  "https://github.com/alice/.forkhub/blob/main/repos/github.com/test/other/build/BUILD.md";

beforeEach(async () => {
  prevCwd = process.cwd();
  dir = mkdtempSync(join(tmpdir(), "fh-build-"));
  const upstream = join(dir, "upstream");
  fork = join(dir, "fork");
  mkdirSync(upstream, { recursive: true });
  await sh(["init", "-q", "-b", "main"], upstream);
  await sh(["config", "user.email", "test@forkhub"], upstream);
  await sh(["config", "user.email", "test@forkhub"], upstream);
  await sh(["config", "user.name", "forkhub test"], upstream);
  await Bun.write(join(upstream, "game.ts"), "export const x = 1;\n");
  await sh(["add", "-A"], upstream);
  await sh(["commit", "-qm", "v1"], upstream);
  await sh(["clone", "-q", upstream, fork], dir);
  await sh(["config", "user.email", "test@forkhub"], fork);
  await sh(["config", "user.name", "forkhub test"], fork);
  await sh(["remote", "rename", "origin", "upstream"], fork);
  process.chdir(fork);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.chdir(prevCwd);
  rmSync(dir, { recursive: true, force: true });
});

test("init scaffolds reusable build workflow + per-target build descriptors", async () => {
  await runInit({ target: "github.com/test/t" });
  const fh = join(dir, ".forkhub");
  expect(existsSync(join(fh, ".github", "workflows", "forkhub-build.yml"))).toBe(true);
  const buildDir = join(fh, "repos", "github.com/test/t", "build");
  for (const f of ["BUILD.md", "build.sh", "CONSUME.md", "triggers.md"]) {
    expect(existsSync(join(buildDir, f))).toBe(true);
  }
  // build.sh must be executable for CI's `[ -x ... ]` check
  expect(statSync(join(buildDir, "build.sh")).mode & 0o111).toBeGreaterThan(0);
  const workflow = await Bun.file(join(fh, ".github", "workflows", "forkhub-build.yml")).text();
  expect(workflow).toMatch(/forkhub build/);
  expect(workflow).toMatch(/apply_order/);
});

test("init never overwrites customized workflow or build files", async () => {
  await runInit({ target: "github.com/test/t" });
  const fh = join(dir, ".forkhub");
  const buildMd = join(fh, "repos", "github.com/test/t", "build", "BUILD.md");
  const workflow = join(fh, ".github", "workflows", "forkhub-build.yml");
  await Bun.write(buildMd, "CUSTOM");
  await Bun.write(workflow, "CUSTOM-WORKFLOW");
  await runInit({ target: "github.com/test/t" });
  expect(await Bun.file(buildMd).text()).toBe("CUSTOM");
  expect(await Bun.file(workflow).text()).toBe("CUSTOM-WORKFLOW");
});

test("release tags are namespaced per target", () => {
  expect(targetSlug("github.com/pingdotgg/t3code")).toBe("pingdotgg-t3code");
  expect(releaseTagFor("github.com/pingdotgg/t3code", "v2.1.0", 1)).toBe(
    "pingdotgg-t3code-v2.1.0-fh1",
  );
  expect(releaseTagFor("github.com/pingdotgg/t3code", "2.1.0", 2)).toBe(
    "pingdotgg-t3code-v2.1.0-fh2",
  );
});

test("import supports BUILD.md (reusable builds)", async () => {
  await runInit({ target: "github.com/test/t" });
  globalThis.fetch = (async (url: any) => {
    const u = String(url);
    if (u.endsWith("/build/BUILD.md")) return new Response(BUILD_MD, { status: 200 });
    if (u.endsWith("/build/CONSUME.md")) return new Response("consume", { status: 200 });
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;

  const result = await runImport(BUILD_URL);
  expect(result.kind).toBe("build");
  expect(result.targetRepo).toBe("github.com/test/other");
  expect(result.filesImported).toContain("BUILD.md");
  expect(result.filesImported).toContain("CONSUME.md");
  const buildDir = join(dir, ".forkhub", "repos", "github.com/test/other", "build");
  expect(existsSync(join(buildDir, "BUILD.md"))).toBe(true);
  // builds don't create patch entries
  const manifest = JSON.parse(
    await Bun.file(join(dir, ".forkhub", "repos", "github.com/test/other", "manifest.json")).text(),
  );
  expect(Object.keys(manifest.patches)).toHaveLength(0);
});

test("reuse rejects build URLs (patch-only)", async () => {
  await runInit({ target: "github.com/test/t" });
  globalThis.fetch = (async (url: any) => {
    const u = String(url);
    if (u.endsWith("/build/BUILD.md")) return new Response(BUILD_MD, { status: 200 });
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;

  let threw = false;
  try {
    await runReuse(BUILD_URL);
  } catch (err) {
    threw = true;
    expect((err as Error).message).toMatch(/patch-only/);
  }
  expect(threw).toBe(true);
});

test("search results distinguish patches from builds", () => {
  const out = formatSearchResults([
    {
      user: "alice",
      repo: ".forkhub",
      branch: "main",
      path: "repos/github.com/test/t/patches/fix-x/INTENT.md",
      url: "https://github.com/alice/.forkhub/blob/main/repos/github.com/test/t/patches/fix-x/INTENT.md",
      patchId: "fix-x",
      title: "Fix X",
      targetRepo: "github.com/test/t",
      kind: "patch",
      stars: 3,
    },
    {
      user: "alice",
      repo: ".forkhub",
      branch: "main",
      path: "repos/github.com/test/t/build/BUILD.md",
      url: "https://github.com/alice/.forkhub/blob/main/repos/github.com/test/t/build/BUILD.md",
      patchId: "build:test-t",
      title: "Build",
      targetRepo: "github.com/test/t",
      kind: "build",
      stars: 3,
    },
  ]);
  expect(out).toMatch(/kind:\s+patch/);
  expect(out).toMatch(/kind:\s+build/);
  // reuse hint only for patches; builds go through import
  expect(out.match(/fh reuse/g)?.length ?? 0).toBe(1);
});
