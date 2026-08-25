import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAdvance } from "./advance";
import { runReconcile } from "./reconcile";


const CWD_BEFORE = process.cwd();
let root: string;
let forkDir: string;
let forkhubDir: string;
const targetRepo = "local/upstream/repo";

function git(args: string[], cwd: string): string {
  const proc = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${proc.stderr.toString()}`);
  }
  return proc.stdout.toString().trim();
}

async function seed(): Promise<void> {
  root = mkdtempSync(join(tmpdir(), "forkhub-test-"));
  const upBare = join(root, "up.git");
  const workDir = join(root, "work");
  forkDir = join(root, "fork");
  forkhubDir = join(root, ".forkhub");

  git(["init", "--bare", "--initial-branch=main", upBare], root);
  git(["clone", "--quiet", upBare, workDir], root);
  git(["config", "user.email", "t@t"], workDir);
  git(["config", "user.name", "t"], workDir);
  git(["config", "commit.gpgsign", "false"], workDir);
  git(["config", "tag.gpgsign", "false"], workDir);
  writeFileSync(join(workDir, "file.txt"), "line1\nline2\nline3\n");
  writeFileSync(join(workDir, "other.txt"), "other\n");
  git(["add", "-A"], workDir);
  git(["commit", "-m", "base commit"], workDir);
  git(["tag", "v1.0.0"], workDir);
  git(["push", "--quiet", "origin", "main"], workDir);
  git(["push", "--quiet", "origin", "v1.0.0"], workDir);

  // Fork clone
  git(["clone", "--quiet", upBare, forkDir], root);
  git(["config", "user.email", "t@t"], forkDir);
  git(["config", "user.name", "t"], forkDir);
  git(["config", "commit.gpgsign", "false"], forkDir);
  git(["config", "tag.gpgsign", "false"], forkDir);
  git(["remote", "rename", "origin", "upstream"], forkDir);

  // .forkhub structure
  const repoDir = join(forkhubDir, "repos", targetRepo);
  mkdirSync(repoDir, { recursive: true });
  mkdirSync(join(repoDir, "patches", "fix-thing"), { recursive: true });
  writeFileSync(
    join(repoDir, "manifest.json"),
    JSON.stringify(
      {
        target_repo: targetRepo,
        upstream_main_branch: "main",
        upstream_remote: "upstream",
        tag_pattern: "v*-fh*",
        drift_against: "branch",
        patches: {},
        apply_order: [],
      },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(
    join(repoDir, "upstream.json"),
    JSON.stringify(
      {
        upstream_url: upBare,
        upstream_main_branch: "main",
        upstream_remote: "upstream",
      },
      null,
      2,
    ) + "\n",
  );
}

function makePatchCommit(subject: string): string {
  // Branch off main, edit file.txt, commit; return the sha.
  const base = git(["rev-parse", "main"], forkDir);
  git(["checkout", "-B", "patch-tmp", base], forkDir);
  const content = git(["show", "main:file.txt"], forkDir);
  writeFileSync(join(forkDir, "file.txt"), `${content}${subject}\n`);
  git(["add", "-A"], forkDir);
  git(["commit", "-m", subject], forkDir);
  const sha = git(["rev-parse", "patch-tmp"], forkDir);
  git(["checkout", "main"], forkDir);
  git(["branch", "-D", "patch-tmp"], forkDir);
  return sha;
}

function setupForkhubMainWithPatch(patchSha: string): void {
  const parent = git(["rev-parse", `${patchSha}^`], forkDir);
  git(["branch", "-f", "forkhub/main", patchSha], forkDir);
  void parent;
}

function advanceUpstream(file: string, content: string, message: string, tag?: string): string {
  const workDir = join(root, "work");
  writeFileSync(join(workDir, file), content);
  git(["add", "-A"], workDir);
  git(["commit", "-m", message], workDir);
  const sha = git(["rev-parse", "HEAD"], workDir);
  if (tag) git(["tag", tag], workDir);
  git(["push", "--quiet", "origin", "main"], workDir);
  if (tag) git(["push", "--quiet", "origin", tag], workDir);
  return sha;
}

describe("fh advance", () => {
  beforeAll(async () => {
    await seed();
    process.chdir(forkDir);
  });

  afterAll(() => {
    process.chdir(CWD_BEFORE);
  });

  test("replays patch commits onto a new upstream base without AI", async () => {
    const patchSha = makePatchCommit("patch: add marker A");
    setupForkhubMainWithPatch(patchSha);

    const repoDir = join(forkhubDir, "repos", targetRepo);
    const manifestPath = join(repoDir, "manifest.json");
    const manifest = JSON.parse(await Bun.file(manifestPath).text());
    manifest.patches["fix-thing"] = {
      status: "applied",
      last_realized_against_commit: git(["rev-parse", "v1.0.0"], forkDir).slice(0, 7),
      commit_shas: [patchSha],
    };
    manifest.apply_order.push("fix-thing");
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    const referenceDiff = git(["diff", `${patchSha}^..${patchSha}`], forkDir);
    writeFileSync(join(repoDir, "patches", "fix-thing", "reference.diff"), referenceDiff + "\n");

    // Upstream moves on in an unrelated area.
    advanceUpstream("other.txt", "other\nnew-upstream-stuff\n", "upstream: extend other.txt");
    git(["fetch", "upstream", "--quiet"], forkDir);

    const result = await runAdvance({ forkhubDir, targetRepo });

    expect(result.status).toBe("advanced");
    expect(result.commitsReplayed.map((c) => c.subject)).toEqual(["patch: add marker A"]);
    expect(result.tag).toBe("v1.0.0-fh1"); // describe sees v1.0.0 until we tag the new upstream commit

    // forkhub/main now contains both upstream work and the replayed patch
    const fhLog = git(["log", "--format=%s", "forkhub/main"], forkDir);
    expect(fhLog).toContain("upstream: extend other.txt");
    expect(fhLog).toContain("patch: add marker A");

    // Manifest advanced to new upstream tip
    const updated = JSON.parse(await Bun.file(manifestPath).text());
    expect(updated.patches["fix-thing"].last_realized_against_commit).toBe(
      git(["rev-parse", "upstream/main"], forkDir).slice(0, 7),
    );

    // Tag exists and points at the advanced tip
    expect(git(["rev-list", "-n1", result.tag!], forkDir)).toBe(
      git(["rev-parse", "forkhub/main"], forkDir),
    );
  });

  test("escalates to bundle generation when replay conflicts", async () => {
    // Upstream rewrites the same lines the patch touches.
    advanceUpstream("file.txt", "rewritten-by-upstream\n", "upstream: rewrite file.txt");
    git(["fetch", "upstream", "--quiet"], forkDir);

    const result = await runAdvance({ forkhubDir, targetRepo });

    expect(result.status).toBe("conflict");
    expect(result.failedCommit?.subject).toBe("patch: add marker A");
    expect(result.bundlesGenerated.length).toBe(1);
    expect(result.bundlesGenerated[0]!.patchId).toBe("fix-thing");
    expect(existsSync(join(result.bundlesGenerated[0]!.bundlePath, "prompt.md"))).toBe(true);

    // forkhub/main untouched by the failed advance
    const fhSubjects = git(["log", "--format=%s", "forkhub/main"], forkDir);
    expect(fhSubjects).not.toContain("upstream: rewrite file.txt");
  });

  test("dry-run reports plan without mutating anything", async () => {
    const beforeTip = git(["rev-parse", "forkhub/main"], forkDir);
    const result = await runAdvance({ forkhubDir, targetRepo, dryRun: true });
    expect(result.status).toBe("advanced");
    expect(result.commitsReplayed.map((c) => c.subject)).toEqual(["patch: add marker A"]);
    expect(git(["rev-parse", "forkhub/main"], forkDir)).toBe(beforeTip);
  });
});

describe("fh reconcile", () => {
  beforeAll(async () => {
    process.chdir(forkDir);
  });

  afterAll(() => {
    process.chdir(CWD_BEFORE);
  });

  test("syncs last_realized from a consumed tag's history", async () => {
    // Hand-craft a tag whose tree contains the patch, then desync the manifest.
    const repoDir = join(forkhubDir, "repos", targetRepo);
    const manifestPath = join(repoDir, "manifest.json");
    const manifest = JSON.parse(await Bun.file(manifestPath).text());
    manifest.patches["fix-thing"].last_realized_against_commit = "0000000";
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

    // The current forkhub/main tip contains the patch content; hand-tag it.
    git(["tag", "-f", "v1.0.0-fh9", "forkhub/main"], forkDir);
    const consumedSha = git(["rev-list", "-n1", "v1.0.0-fh9"], forkDir);

    const result = await runReconcile({
      forkhubDir,
      targetRepo,
      tag: "v1.0.0-fh9",
    });

    expect(result.consumedTag).toBe("v1.0.0-fh9");
    expect(result.upstreamBaseSource).toBe("upstream-tag"); // v1.0.0 derived from the name
    expect(result.patchesReconciled).toEqual([
      {
        patchId: "fix-thing",
        from: "0000000",
        to: git(["rev-parse", "v1.0.0"], forkDir).slice(0, 7),
      },
    ]);
    expect(result.patchesMissing).toEqual([]);

    const synced = JSON.parse(await Bun.file(manifestPath).text());
    expect(synced.patches["fix-thing"].last_realized_against_commit).toBe(
      git(["rev-parse", "v1.0.0"], forkDir).slice(0, 7),
    );
    void consumedSha;
  });

  test("flags patches whose content is absent from the tag", async () => {
    // Point the tag at plain upstream history that lacks the patch content.
    const plainUpstream = git(["rev-parse", "v1.0.0"], forkDir);
    git(["tag", "-f", "v1.0.0-fh8", plainUpstream], forkDir);

    const result = await runReconcile({ forkhubDir, targetRepo, tag: "v1.0.0-fh8" });
    expect(result.patchesReconciled).toEqual([]);
    expect(result.patchesMissing[0]?.patchId).toBe("fix-thing");
  });
});

afterAll(() => {
  process.chdir(CWD_BEFORE);
  if (root) rmSync(root, { recursive: true, force: true });
});
