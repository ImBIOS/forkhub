import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../src/init";
import { runReuse } from "../src/reuse";

let dir: string;
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

const INTENT = `---
id: shared-fix
title: Shared fix
target_repo: github.com/test/t
target_area: [game.ts]
author: alice
version: 1
source_url: null
imported_at: null
---

## Intent

Shared fix
`;

beforeEach(async () => {
  prevCwd = process.cwd();
  dir = mkdtempSync(join(tmpdir(), "fh-reuse-"));
  const upstream = join(dir, "upstream");
  const fork = join(dir, "fork");
  mkdirSync(upstream, { recursive: true });
  await sh(["init", "-q", "-b", "main"], upstream);
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

  globalThis.fetch = (async (url: any) => {
    const u = String(url);
    if (u.endsWith("/patches/shared-fix/INTENT.md")) return new Response(INTENT, { status: 200 });
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.chdir(prevCwd);
  rmSync(dir, { recursive: true, force: true });
});

test("reuse imports and builds a re-derivation bundle in one step", async () => {
  await runInit({ target: "github.com/test/t" });
  const result = await runReuse(
    "https://github.com/alice/.forkhub/blob/main/repos/github.com/test/t/patches/shared-fix/INTENT.md",
  );
  expect(result.patchId).toBe("shared-fix");
  expect(result.author).toBe("alice");
  expect(existsSync(join(result.bundlePath, "INTENT.md"))).toBe(true);
  expect(existsSync(join(result.bundlePath, "prompt.md"))).toBe(true);
  expect(existsSync(join(result.bundlePath, "REALIZATION"))).toBe(true);
  expect(result.filesInBundle).toContain("INTENT.md");
});

test("reuse requires a git repo", async () => {
  process.chdir(dir); // not a git repo
  let threw = false;
  try {
    await runReuse(
      "https://github.com/alice/.forkhub/blob/main/repos/github.com/test/t/patches/shared-fix/INTENT.md",
    );
  } catch (err) {
    threw = true;
    expect((err as Error).message).toMatch(/Not a git repository/);
  }
  expect(threw).toBe(true);
});
