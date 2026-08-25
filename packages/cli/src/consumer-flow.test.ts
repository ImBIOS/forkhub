import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runUpdate } from "./update";
import { runReconcile } from "./reconcile";
import { runDriftCheck } from "./drift-check";
import { resolveTagPattern } from "./tags";

const CWD_BEFORE = process.cwd();
let root: string;
let forkDir: string;
let forkhubDir: string;
const targetRepo = "host.example/owner/project";

function git(args: string[], cwd: string): string {
  const proc = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${proc.stderr.toString()}`);
  }
  return proc.stdout.toString().trim();
}

/**
 * Mirrors the real-world report that motivated reconcile/track support:
 * upstream cuts numeric tags ("1179"), the fork hand-makes "1179-fh1",
 * and drift must measure against tags, not the branch tip.
 */
describe("consumer flow: nightly-ish track with hand-made tags", () => {
  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "forkhub-consumer-"));
    const upBare = join(root, "up.git");
    const workDir = join(root, "work");
    forkDir = join(root, "fork");
    forkhubDir = join(root, ".forkhub");

    git(["init", "--bare", "--initial-branch=main", upBare], root);
    git(["clone", "--quiet", upBare, workDir], root);
    for (const dir of [workDir]) {
      git(["config", "user.email", "t@t"], dir);
      git(["config", "user.name", "t"], dir);
      git(["config", "commit.gpgsign", "false"], dir);
      git(["config", "tag.gpgsign", "false"], dir);
    }

    writeFileSync(join(workDir, "app.txt"), "v1179 content\n");
    git(["add", "-A"], workDir);
    git(["commit", "-m", "release 1179"], workDir);
    git(["tag", "1179"], workDir);
    writeFileSync(join(workDir, "app.txt"), "v1180-unreleased content\n");
    git(["add", "-A"], workDir);
    git(["commit", "-m", "unbuildable main-tip commit"], workDir);
    git(["push", "--quiet", "origin", "main", "1179"], workDir);

    git(["clone", "--quiet", upBare, forkDir], root);
    git(["config", "user.email", "t@t"], forkDir);
    git(["config", "user.name", "t"], forkDir);
    git(["config", "commit.gpgsign", "false"], forkDir);
    git(["config", "tag.gpgsign", "false"], forkDir);
    git(["remote", "rename", "origin", "upstream"], forkDir);

    // Patch commit on top of 1179, ported onto forkhub/main by hand.
    const baseSha = git(["rev-parse", "upstream/main^"], forkDir); // the 1179 commit
    const content = git(["show", `${baseSha}:app.txt`], forkDir);
    writeFileSync(join(forkDir, "app.txt"), `${content}\npatch line\n`);
    git(["add", "-A"], forkDir);
    git(["commit", "-m", "patch: tweak app"], forkDir);
    const patchTip = git(["rev-parse", "HEAD"], forkDir);
    git(["branch", "forkhub/main", patchTip], forkDir);
    const referenceDiff = git(["diff", `${baseSha}..${patchTip}`], forkDir);

    const repoDir = join(forkhubDir, "repos", targetRepo);
    mkdirSync(join(repoDir, "patches", "tweak-app"), { recursive: true });
    writeFileSync(
      join(repoDir, "manifest.json"),
      JSON.stringify(
        {
          target_repo: targetRepo,
          upstream_main_branch: "main",
          upstream_remote: "upstream",
          tag_pattern: "*-fh*",
          drift_against: "tag",
          patches: {
            "tweak-app": {
              status: "applied",
              // Stale on purpose: says realized against some old sha…
              last_realized_against_commit: "45a2c4b",
              branch: "tweak-app",
            },
          },
          apply_order: ["tweak-app"],
        },
        null,
        2,
      ) + "\n",
    );
    writeFileSync(
      join(repoDir, "upstream.json"),
      JSON.stringify(
        { upstream_url: upBare, upstream_remote: "upstream", upstream_main_branch: "main" },
        null,
        2,
      ) + "\n",
    );
    writeFileSync(join(repoDir, "patches", "tweak-app", "reference.diff"), referenceDiff + "\n");

    // Hand-made consumer tag exactly like the report's "1179-fh1".
    git(["tag", "1179-fh1", patchTip], forkDir);

    process.chdir(forkDir);
  });

  afterAll(() => {
    process.chdir(CWD_BEFORE);
    rmSync(root, { recursive: true, force: true });
  });

  test("track pattern resolves from manifest and gates update", async () => {
    expect(await resolveTagPattern(forkhubDir)).toBe("*-fh*");

    // Latest matching tag is the hand-made 1179-fh1.
    const dryRun = await runUpdate({ tagPattern: "*-fh*", dryRun: true });
    expect(dryRun.to).toBe("1179-fh1");

    // A stable/upstream tag outside the track is refused.
    expect(runUpdate({ tagPattern: "*-fh*", tag: "1179" })).rejects.toThrow(/tag_pattern/);
  });

  test("fh reconcile syncs the stale manifest from the consumed tag", async () => {
    const result = await runReconcile({
      forkhubDir,
      targetRepo,
      tag: "1179-fh1",
    });

    // upstream base derived from the tag name "1179-fh1" → upstream tag "1179"
    expect(result.upstreamBaseSource).toBe("upstream-tag");
    expect(result.upstreamBaseSha).toBe(git(["rev-parse", "1179^{commit}"], forkDir));
    expect(result.patchesReconciled.map((p) => p.patchId)).toEqual(["tweak-app"]);

    const synced = JSON.parse(
      await Bun.file(join(forkhubDir, "repos", targetRepo, "manifest.json")).text(),
    );
    expect(synced.patches["tweak-app"].last_realized_against_commit).toBe(
      git(["rev-parse", "1179"], forkDir).slice(0, 7),
    );
  });

  test("drift_against=tag measures against the release, not unbuildable main tip", async () => {
    const result = await runDriftCheck({ forkhubDir, targetRepo });

    // Baseline is the 1179 tag commit even though main has advanced past it.
    expect(result.upstreamSha).toBe(git(["rev-parse", "1179"], forkDir));
    // The patch was reconciled against exactly that baseline → current.
    const patch = result.patches.find((p) => p.patchId === "tweak-app");
    expect(patch?.status).toBe("current");
    expect(result.summary.drifted).toBe(0);
  });
});
