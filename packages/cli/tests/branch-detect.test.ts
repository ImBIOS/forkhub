import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectRemoteDefaultBranch, detectDefaultBranch, resolveBaseRef } from "../src/git";

let dir: string;

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

async function makeRepo(path: string, branch: "main" | "master"): Promise<void> {
  await sh(["init", "-q", "-b", branch], path);
  await sh(["config", "user.email", "test@forkhub"], path);
  await sh(["config", "user.name", "forkhub test"], path);
  await Bun.write(join(path, "README.md"), "# test\n");
  await sh(["add", "-A"], path);
  await sh(["commit", "-qm", "init"], path);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "fh-branch-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

test("detectRemoteDefaultBranch finds master via ls-remote", async () => {
  const upstream = join(dir, "upstream");
  const fork = join(dir, "fork");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(upstream, { recursive: true });
  await makeRepo(upstream, "master");
  await sh(["clone", "-q", upstream, fork], dir);
  await sh(["config", "user.email", "test@forkhub"], fork);
  await sh(["config", "user.name", "forkhub test"], fork);
  await sh(["remote", "rename", "origin", "upstream"], fork);

  expect(await detectRemoteDefaultBranch("upstream", fork)).toBe("master");
});

test("detectRemoteDefaultBranch finds main via ls-remote", async () => {
  const upstream = join(dir, "upstream");
  const fork = join(dir, "fork");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(upstream, { recursive: true });
  await makeRepo(upstream, "main");
  await sh(["clone", "-q", upstream, fork], dir);
  await sh(["config", "user.email", "test@forkhub"], fork);
  await sh(["config", "user.name", "forkhub test"], fork);
  await sh(["remote", "rename", "origin", "upstream"], fork);

  expect(await detectRemoteDefaultBranch("upstream", fork)).toBe("main");
});

test("detectRemoteDefaultBranch returns null for missing remote", async () => {
  const repo = join(dir, "repo");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(repo, { recursive: true });
  await makeRepo(repo, "main");
  expect(await detectRemoteDefaultBranch("upstream", repo)).toBeNull();
});

test("detectDefaultBranch prefers remote over local fallback", async () => {
  const upstream = join(dir, "upstream");
  const fork = join(dir, "fork");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(upstream, { recursive: true });
  await makeRepo(upstream, "master");
  await sh(["clone", "-q", upstream, fork], dir);
  await sh(["config", "user.email", "test@forkhub"], fork);
  await sh(["config", "user.name", "forkhub test"], fork);
  await sh(["remote", "rename", "origin", "upstream"], fork);

  expect(await detectDefaultBranch(["upstream", "origin"], fork)).toBe("master");
});

test("resolveBaseRef resolves local branch and remote tracking branch", async () => {
  const upstream = join(dir, "upstream");
  const fork = join(dir, "fork");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(upstream, { recursive: true });
  await makeRepo(upstream, "master");
  await sh(["clone", "-q", upstream, fork], dir);
  await sh(["config", "user.email", "test@forkhub"], fork);
  await sh(["config", "user.name", "forkhub test"], fork);
  await sh(["remote", "rename", "origin", "upstream"], fork);

  expect(await resolveBaseRef("master", ["upstream", "origin"], fork)).toBe("master");
});
