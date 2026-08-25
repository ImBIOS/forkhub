import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { isGitRepo, gitExec, gitOrThrow, shortSha, mergeBase, refExists } from "./git";
import { findTargetRepo } from "./target-repo";
import { resolveTagPattern, upstreamTagOf, globToRegExp } from "./tags";
import { currentTag } from "./update";

export type ReconcileOptions = {
  forkhubDir?: string;
  targetRepo?: string;
  /** The consumed forkhub tag (default: the exact tag currently checked out). */
  tag?: string;
  dryRun?: boolean;
};

export type ReconcileResult = {
  consumedTag: string;
  consumedSha: string;
  upstreamBaseSha: string;
  upstreamBaseSource: "upstream-tag" | "merge-base";
  patchesReconciled: { patchId: string; from: string | null; to: string }[];
  patchesMissing: { patchId: string; reason: string }[];
  alreadySynced: string[];
  warnings: string[];
};

/**
 * Does `diffPath` reverse-apply cleanly onto the tree at `treeish`?
 * Uses a throwaway index (GIT_INDEX_FILE) so neither worktree nor real index
 * are touched — safe to run from any branch.
 */
export async function diffIsPresentInTree(
  treeish: string,
  diffPath: string,
  cwd: string,
): Promise<boolean> {
  const tmpIndex = join(
    "/tmp",
    `forkhub-index-${process.pid}-${Math.random().toString(36).slice(2)}`,
  );
  const env = { ...process.env, GIT_INDEX_FILE: tmpIndex };
  try {
    const readTree = await gitRunWithEnv(["read-tree", treeish], cwd, env);
    if (readTree.exitCode !== 0) return false;
    const check = await gitRunWithEnv(
      ["apply", "--reverse", "--check", "--cached", diffPath],
      cwd,
      env,
    );
    return check.exitCode === 0;
  } finally {
    rmSync(tmpIndex, { force: true });
  }
}

function gitRunWithEnv(
  args: string[],
  cwd: string,
  env: Record<string, string | undefined>,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe", env });
  return (async () => {
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;
    return { exitCode, stdout: stdout.trim(), stderr: stderr.trim() };
  })();
}

export async function runReconcile(options: ReconcileOptions = {}): Promise<ReconcileResult> {
  if (!(await isGitRepo())) {
    throw new Error("Not a git repository. Run from inside your fork's checkout.");
  }

  const forkhubDir = options.forkhubDir ?? join(process.cwd(), "..", ".forkhub");
  if (!existsSync(forkhubDir)) {
    throw new Error(".forkhub repo not found. Run `fh init` first.");
  }

  const targetRepo = options.targetRepo ?? (await findTargetRepo(forkhubDir, process.cwd()));
  const repoDir = join(forkhubDir, "repos", targetRepo);
  const manifestPath = join(repoDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`manifest.json not found at ${manifestPath}.`);
  }
  const manifest = JSON.parse(await Bun.file(manifestPath).text());

  const consumedTag = options.tag ?? (await currentTag());
  if (!consumedTag) {
    throw new Error("Not checked out on a tag. Run `fh update` first, or pass --tag <tag>.");
  }
  const consumedSha = await gitOrThrow(["rev-list", "-n1", consumedTag]);

  const pattern = await resolveTagPattern(forkhubDir);
  const warnings: string[] = [];
  if (!globToRegExp(pattern).test(consumedTag)) {
    warnings.push(
      `Tag '${consumedTag}' does not match configured tag_pattern '${pattern}' — reconciling anyway.`,
    );
  }

  // Where did this tag branch from upstream?
  const upstreamRemote = manifest.upstream_remote ?? "upstream";
  const mainBranch = manifest.upstream_main_branch ?? "main";
  const upstreamRef = `${upstreamRemote}/${mainBranch}`;

  let upstreamBaseSha: string | null = null;
  let upstreamBaseSource: ReconcileResult["upstreamBaseSource"] = "merge-base";

  const upstreamTagName = upstreamTagOf(consumedTag, pattern);
  if (upstreamTagName && (await refExists(`${upstreamTagName}^{commit}`))) {
    upstreamBaseSha = await gitOrThrow(["rev-parse", `${upstreamTagName}^{commit}`]);
    upstreamBaseSource = "upstream-tag";
  } else {
    if (!upstreamTagName) {
      warnings.push(
        `Could not derive an upstream tag from '${consumedTag}' using pattern '${pattern}'.`,
      );
    }
    await gitExec(["fetch", upstreamRemote, "--quiet"]);
    upstreamBaseSha = await mergeBase(consumedSha, upstreamRef);
    if (!upstreamBaseSha) {
      throw new Error(`No common ancestor between ${consumedTag} and ${upstreamRef}.`);
    }
  }

  const baseShort = shortSha(upstreamBaseSha);
  const patchesReconciled: ReconcileResult["patchesReconciled"] = [];
  const patchesMissing: ReconcileResult["patchesMissing"] = [];
  const alreadySynced: string[] = [];

  for (const [patchId, info] of Object.entries(manifest.patches) as [string, any][]) {
    if (info.status !== "applied" && info.status !== "imported") continue;

    const diffPath = join(repoDir, "patches", patchId, "reference.diff");
    if (!existsSync(diffPath)) {
      patchesMissing.push({ patchId, reason: "no reference.diff on disk" });
      continue;
    }

    const present = await diffIsPresentInTree(consumedSha, diffPath, process.cwd());
    if (!present) {
      patchesMissing.push({
        patchId,
        reason: `content not found in ${consumedTag} (may have drifted)`,
      });
      continue;
    }

    const current = info.last_realized_against_commit ?? null;
    if (current && shortSha(current) === baseShort) {
      alreadySynced.push(patchId);
      continue;
    }

    patchesReconciled.push({ patchId, from: current, to: baseShort });
    info.last_realized_against_commit = baseShort;
  }

  if (!options.dryRun && patchesReconciled.length > 0) {
    await Bun.write(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    for (const { patchId, to } of patchesReconciled) {
      await appendAttempt(join(repoDir, "patches", patchId, "attempts.jsonl"), to);
    }
  }

  return {
    consumedTag,
    consumedSha,
    upstreamBaseSha,
    upstreamBaseSource,
    patchesReconciled,
    patchesMissing,
    alreadySynced,
    warnings,
  };
}

async function appendAttempt(attemptsPath: string, baseShort: string): Promise<void> {
  let existing = "";
  try {
    if (existsSync(attemptsPath)) existing = await Bun.file(attemptsPath).text();
  } catch {
    // start fresh
  }
  const n = existing.split("\n").filter(Boolean).length + 1;
  const entry = JSON.stringify({
    n,
    phase: "reconciling",
    timestamp: new Date().toISOString(),
    upstream_sha: baseShort,
    approach: "manifest synced from consumed tag history (fh reconcile)",
    result: "passed",
    tokens: 0,
    model: "reconcile",
  });
  await Bun.write(
    attemptsPath,
    existing + (existing.endsWith("\n") || !existing ? "" : "\n") + entry + "\n",
  );
}
