import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../src/init";
import { runDraft } from "../src/draft";
import { runSatisfied } from "../src/satisfied";
import { runLinkPr } from "../src/link-pr";

let dir: string;
let upstream: string;
let fork: string;
let prevCwd: string;

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

beforeEach(async () => {
  prevCwd = process.cwd();
  dir = mkdtempSync(join(tmpdir(), "fh-e2e-"));
  upstream = join(dir, "upstream");
  fork = join(dir, "fork");
  mkdirSync(upstream, { recursive: true });
  // Upstream whose default branch is `master` (the GA regression case).
  await sh(["init", "-q", "-b", "master"], upstream);
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
  process.chdir(prevCwd);
  rmSync(dir, { recursive: true, force: true });
});

test("init autodetects master as upstream_main_branch", async () => {
  const result = await runInit({ target: "github.com/test/test-game" });
  expect(result.isFork).toBe(false); // single remote setup
  const manifest = JSON.parse(
    await Bun.file(
      join(dir, ".forkhub", "repos", "github.com/test/test-game", "manifest.json"),
    ).text(),
  );
  expect(manifest.upstream_main_branch).toBe("master");
  const upstreamJson = JSON.parse(
    await Bun.file(
      join(dir, ".forkhub", "repos", "github.com/test/test-game", "upstream.json"),
    ).text(),
  );
  expect(upstreamJson.upstream_main_branch).toBe("master");
});

test("draft → implement → satisfied works on a master-default repo", async () => {
  await runInit({ target: "github.com/test/test-game" });

  const draft = await runDraft("add debug flag");
  expect(draft.slug).toBe("add-debug-flag");
  expect(existsSync(join(fork, ".forkhub-draft.md"))).toBe(true);
  const current = await sh(["rev-parse", "--abbrev-ref", "HEAD"], fork);
  expect(current).toBe("add-debug-flag");

  await Bun.write(join(fork, "game.ts"), "export const x = 2;\n");
  await sh(["add", "-A"], fork);
  await sh(["commit", "-qm", "add debug flag"], fork);

  const done = await runSatisfied({ skipPort: true });
  expect(done.patchId.startsWith("add-debug-flag-")).toBe(true);
  expect(done.filesChanged).toContain("game.ts");
  expect(done.forkhubMainUpdated).toBe(false);
  expect(existsSync(join(fork, ".forkhub-draft.md"))).toBe(false);

  const patchDir = join(
    dir,
    ".forkhub",
    "repos",
    "github.com/test/test-game",
    "patches",
    done.patchId,
  );
  expect(existsSync(join(patchDir, "INTENT.md"))).toBe(true);
  expect(existsSync(join(patchDir, "verify.sh"))).toBe(true);
  expect(existsSync(join(patchDir, "reference.diff"))).toBe(true);
});

test("link-pr records an existing PR without gh (offline-safe)", async () => {
  await runInit({ target: "github.com/test/test-game" });
  await runDraft("add debug flag");
  await Bun.write(join(fork, "game.ts"), "export const x = 2;\n");
  await sh(["add", "-A"], fork);
  await sh(["commit", "-qm", "add debug flag"], fork);
  const done = await runSatisfied({ skipPort: true });

  // No `gh` auth offline — runLinkPr still records the PR number.
  const linked = await runLinkPr(done.patchId, "https://github.com/test/test-game/pull/42");
  expect(linked.prNumber).toBe(42);
  expect(linked.patchId).toBe(done.patchId);

  const manifest = JSON.parse(
    await Bun.file(
      join(dir, ".forkhub", "repos", "github.com/test/test-game", "manifest.json"),
    ).text(),
  );
  expect(manifest.patches[done.patchId].applied_upstream_pr.number).toBe(42);
});

test("draft rejects duplicate branch names", async () => {
  await runInit({ target: "github.com/test/test-game" });
  await runDraft("add debug flag");
  await sh(["checkout", "-q", "master"], fork);
  let threw = false;
  try {
    await runDraft("add debug flag");
  } catch (err) {
    threw = true;
    expect((err as Error).message).toMatch(/already exists/);
  }
  expect(threw).toBe(true);
});
