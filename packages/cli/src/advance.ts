import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  isGitRepo,
  gitExec,
  gitOrThrow,
  shortSha,
  checkout,
  currentBranch,
  isDirty,
  mergeBase,
  refExists,
  revListReverse,
} from "./git";
import { findTargetRepo } from "./target-repo";
import { resolveTagPattern, deriveNextFhTag } from "./tags";

export type AdvanceOptions = {
  forkhubDir?: string;
  targetRepo?: string;
  /** Ref to advance onto (default: upstream's main branch tip). */
  to?: string;
  dryRun?: boolean;
  /** Gate the advance on every applied patch's verify.sh passing. */
  verify?: boolean;
};

export type AdvanceResult = {
  status: "advanced" | "up-to-date" | "conflict" | "verify-failed";
  fromSha: string;
  toSha: string;
  baseSha: string;
  commitsReplayed: { sha: string; subject: string }[];
  failedCommit: { sha: string; subject: string } | null;
  conflictFiles: string[];
  tag: string | null;
  patchesUpdated: string[];
  bundlesGenerated: { patchId: string; bundlePath: string }[];
  warnings: string[];
};

type Manifest = {
  upstream_main_branch?: string;
  upstream_remote?: string;
  patches: Record<string, any>;
  apply_order: string[];
};

export async function runAdvance(options: AdvanceOptions = {}): Promise<AdvanceResult> {
  const warnings: string[] = [];
  if (!(await isGitRepo())) {
    throw new Error("Not a git repository. Run from inside your fork's checkout.");
  }
  if (await isDirty()) {
    throw new Error("Working tree is dirty. Commit or stash before `fh advance`.");
  }

  const forkhubDir = options.forkhubDir ?? join(process.cwd(), "..", ".forkhub");
  if (!existsSync(forkhubDir)) {
    throw new Error(".forkhub repo not found. Run `fh init` first.");
  }

  const targetRepo = options.targetRepo ?? (await findTargetRepo(forkhubDir, process.cwd()));
  const repoDir = join(forkhubDir, "repos", targetRepo);
  const manifestPath = join(repoDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`manifest.json not found at ${manifestPath}. Run \`fh init\` first.`);
  }
  const manifest: Manifest = JSON.parse(await Bun.file(manifestPath).text());

  const upstreamRemote = manifest.upstream_remote ?? "upstream";
  const mainBranch = manifest.upstream_main_branch ?? "main";
  const newBaseRef = options.to ?? `${upstreamRemote}/${mainBranch}`;

  const fetchResult = await gitExec(["fetch", upstreamRemote, "--quiet"]);
  if (fetchResult.exitCode !== 0 && !options.to) {
    throw new Error(`Could not fetch ${upstreamRemote}: ${fetchResult.stderr}`);
  }
  if (!(await refExists(newBaseRef))) {
    throw new Error(`Unknown ref: ${newBaseRef}`);
  }
  const newBaseSha = await gitOrThrow(["rev-parse", newBaseRef]);

  if (!(await refExists("forkhub/main"))) {
    throw new Error("forkhub/main does not exist. Run `fh satisfied` at least once first.");
  }

  const originalBranch = await currentBranch();
  const fromSha = await gitOrThrow(["rev-parse", "forkhub/main"]);
  const baseSha = await mergeBase(newBaseSha, fromSha);
  if (!baseSha) {
    throw new Error(
      `forkhub/main and ${newBaseRef} have no common ancestor — cannot fast-forward.`,
    );
  }

  if (shortSha(fromSha) === shortSha(newBaseSha)) {
    return emptyResult("up-to-date", fromSha, newBaseSha, baseSha, warnings);
  }

  if (shortSha(baseSha) === shortSha(newBaseSha)) {
    // The upstream tip is already an ancestor of forkhub/main.
    warnings.push("forkhub/main already contains the upstream tip; nothing to advance.");
    return emptyResult("up-to-date", fromSha, newBaseSha, baseSha, warnings);
  }

  // Fork-only commits (patches + anything else not on the new base), oldest first.
  const commits = await revListReverse(fromSha, baseSha);

  if (options.dryRun) {
    const pattern = await resolveTagPattern(forkhubDir);
    const nextTag = await deriveNextFhTag(process.cwd(), pattern, "forkhub/main");
    return {
      ...emptyResult("advanced", fromSha, newBaseSha, baseSha, warnings),
      commitsReplayed: commits,
      tag: nextTag,
    };
  }

  if (commits.length === 0) {
    // No patch commits — pure fast-forward of the branch pointer.
    await gitOrThrow(["checkout", "--quiet", "forkhub/main"]);
    try {
      await gitOrThrow(["merge", "--ff-only", newBaseSha]);
    } finally {
      await checkout(originalBranch);
    }
    const pattern = await resolveTagPattern(forkhubDir);
    let tag: string | null = null;
    try {
      tag = await deriveNextFhTag(process.cwd(), pattern, "forkhub/main");
      await gitOrThrow(["tag", tag]);
    } catch (err) {
      warnings.push(`Tagging failed: ${err instanceof Error ? err.message : err}`);
    }
    return {
      ...emptyResult("advanced", fromSha, newBaseSha, baseSha, warnings),
      tag,
    };
  }

  // Replay fork-only commits onto the new base via a temporary branch.
  await gitOrThrow(["branch", "-f", "forkhub/advance-tmp", newBaseSha]);
  await checkout("forkhub/advance-tmp");

  let failedCommit: { sha: string; subject: string } | null = null;
  let conflictFiles: string[] = [];
  let replayed: { sha: string; subject: string }[] = [];

  for (const commit of commits) {
    const pick = await gitExec(["cherry-pick", "--allow-empty", commit.sha]);
    if (pick.exitCode !== 0) {
      const filesResult = await gitExec(["diff", "--name-only"]);
      const stagedResult = await gitExec(["diff", "--cached", "--name-only"]);
      conflictFiles = [
        ...new Set(
          [...filesResult.stdout.split("\n"), ...stagedResult.stdout.split("\n")]
            .map((s) => s.trim())
            .filter(Boolean),
        ),
      ];
      failedCommit = commit;
      break;
    }
    replayed.push(commit);
  }

  if (failedCommit) {
    await gitExec(["cherry-pick", "--abort"]);
    await checkout(originalBranch);
    await gitExec(["branch", "-D", "forkhub/advance-tmp"]);

    const affected = await patchesAffectedByConflict(
      repoDir,
      manifest,
      failedCommit,
      conflictFiles,
    );

    const bundlesGenerated: { patchId: string; bundlePath: string }[] = [];
    for (const patchId of affected) {
      try {
        const { runReDerive } = await import("./re-derive");
        const bundle = await runReDerive(patchId, { forkhubDir, force: true });
        if (bundle.bundlePath) {
          bundlesGenerated.push({ patchId, bundlePath: bundle.bundlePath });
        }
      } catch (err) {
        warnings.push(
          `Could not generate a re-derivation bundle for ${patchId}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    if (affected.length === 0) {
      warnings.push(
        `Commit ${shortSha(failedCommit.sha)} (${failedCommit.subject}) conflicted but could not be attributed to a tracked patch.`,
      );
    }

    return {
      status: "conflict",
      fromSha,
      toSha: "",
      baseSha,
      commitsReplayed: replayed,
      failedCommit,
      conflictFiles,
      tag: null,
      patchesUpdated: [],
      bundlesGenerated,
      warnings,
    };
  }

  // Optional verification gate against the fully-advanced tree.
  if (options.verify) {
    const failures = await verifyPatches(repoDir, manifest, warnings);
    if (failures.length > 0) {
      await checkout(originalBranch);
      await gitExec(["branch", "-D", "forkhub/advance-tmp"]);
      return {
        status: "verify-failed",
        fromSha,
        toSha: "",
        baseSha,
        commitsReplayed: replayed,
        failedCommit: null,
        conflictFiles: [],
        tag: null,
        patchesUpdated: [],
        bundlesGenerated: [],
        warnings: [`Verification failed for: ${failures.join(", ")}`],
      };
    }
  }

  // Promote the temp branch to forkhub/main, tag, and sync the manifest.
  await gitOrThrow(["checkout", "--quiet", "forkhub/main"]);
  await gitOrThrow(["reset", "--hard", "forkhub/advance-tmp"]);
  await gitOrThrow(["branch", "-D", "forkhub/advance-tmp"]);

  let tag: string | null = null;
  try {
    const pattern = await resolveTagPattern(forkhubDir);
    tag = await deriveNextFhTag(process.cwd(), pattern, "forkhub/main");
    await gitOrThrow(["tag", tag]);
  } catch (err) {
    warnings.push(`Tagging failed: ${err instanceof Error ? err.message : err}`);
  }

  const patchesUpdated = await syncManifestAfterAdvance(
    repoDir,
    manifestPath,
    manifest,
    replayed,
    newBaseSha,
    warnings,
  );

  await checkout(originalBranch);

  return {
    status: "advanced",
    fromSha,
    toSha: await gitOrThrow(["rev-parse", "forkhub/main"]),
    baseSha,
    commitsReplayed: replayed,
    failedCommit: null,
    conflictFiles: [],
    tag,
    patchesUpdated,
    bundlesGenerated: [],
    warnings,
  };
}

function emptyResult(
  status: AdvanceResult["status"],
  fromSha: string,
  toSha: string,
  baseSha: string,
  warnings: string[],
): AdvanceResult {
  return {
    status,
    fromSha,
    toSha,
    baseSha,
    commitsReplayed: [],
    failedCommit: null,
    conflictFiles: [],
    tag: null,
    patchesUpdated: [],
    bundlesGenerated: [],
    warnings,
  };
}

/** Attribute a conflicted commit to patches via recorded SHAs, else by file overlap. */
async function patchesAffectedByConflict(
  repoDir: string,
  manifest: Manifest,
  failedCommit: { sha: string },
  conflictFiles: string[],
): Promise<string[]> {
  const bySha = Object.entries(manifest.patches)
    .filter(([, p]) => Array.isArray(p.commit_shas) && p.commit_shas.includes(failedCommit.sha))
    .map(([id]) => id);
  if (bySha.length > 0) return bySha;

  const conflictSet = new Set(conflictFiles);
  const byFiles: string[] = [];
  for (const [patchId] of Object.entries(manifest.patches)) {
    const diffPath = join(repoDir, "patches", patchId, "reference.diff");
    if (!existsSync(diffPath)) continue;
    const content = await Bun.file(diffPath).text();
    const touched = new Set([...content.matchAll(/^diff --git a\/(.+?) b\//gm)].map((m) => m[1]!));
    for (const f of conflictSet) {
      if (touched.has(f)) {
        byFiles.push(patchId);
        break;
      }
    }
  }
  return byFiles;
}

async function verifyPatches(
  repoDir: string,
  manifest: Manifest,
  warnings: string[],
): Promise<string[]> {
  const failures: string[] = [];
  const { runVerify } = await import("./verify");
  for (const [patchId, info] of Object.entries(manifest.patches)) {
    if (info.status !== "applied" && info.status !== "imported") continue;
    const patchDir = join(repoDir, "patches", patchId);
    const verifySh = join(patchDir, "verify.sh");
    if (!existsSync(verifySh)) continue;
    try {
      const result = await runVerify(patchDir, process.cwd());
      if (!result.passed) {
        failures.push(patchId);
        warnings.push(`${patchId} verification output:\n${result.output.slice(0, 2000)}`);
      }
    } catch (err) {
      failures.push(patchId);
      warnings.push(`${patchId} verification errored: ${err instanceof Error ? err.message : err}`);
    }
  }
  return failures;
}

/**
 * After a clean replay, update last_realized_against_commit for patches whose
 * commits are known-replayed; for legacy patches (no recorded SHAs), fall back
 * to a reverse-apply probe of reference.diff against the advanced tree.
 */
async function syncManifestAfterAdvance(
  repoDir: string,
  manifestPath: string,
  manifest: Manifest,
  replayed: { sha: string }[],
  newBaseSha: string,
  warnings: string[],
): Promise<string[]> {
  const replayedSet = new Set(replayed.map((c) => c.sha));
  const updated: string[] = [];
  for (const [patchId, info] of Object.entries(manifest.patches)) {
    if (info.status !== "applied" && info.status !== "imported") continue;

    let realized = false;
    if (Array.isArray(info.commit_shas) && info.commit_shas.length > 0) {
      realized = info.commit_shas.every((s: string) => replayedSet.has(s));
    } else {
      const diffPath = join(repoDir, "patches", patchId, "reference.diff");
      if (existsSync(diffPath)) {
        const check = await gitExec(["apply", "--reverse", "--check", diffPath]);
        realized = check.exitCode === 0;
        if (!realized) {
          warnings.push(
            `${patchId}: no recorded commits and reference.diff does not match the advanced tree — leaving last_realized unchanged (run \`fh reconcile\` or re-derive).`,
          );
        }
      } else {
        warnings.push(`${patchId}: no reference.diff found — skipping manifest sync.`);
      }
    }

    if (realized) {
      info.last_realized_against_commit = shortSha(newBaseSha);
      updated.push(patchId);
      await appendAttempt(join(repoDir, "patches", patchId, "attempts.jsonl"), newBaseSha);
    }
  }
  await Bun.write(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  return updated;
}

async function appendAttempt(attemptsPath: string, newBaseSha: string): Promise<void> {
  let existing = "";
  try {
    if (existsSync(attemptsPath)) existing = await Bun.file(attemptsPath).text();
  } catch {
    // start fresh
  }
  const n = existing.split("\n").filter(Boolean).length + 1;
  const entry = JSON.stringify({
    n,
    phase: "advancing",
    timestamp: new Date().toISOString(),
    upstream_sha: shortSha(newBaseSha),
    approach: "git cherry-pick replay (fh advance)",
    result: "passed",
    tokens: 0,
    model: "fast-forward",
  });
  await Bun.write(
    attemptsPath,
    existing + (existing.endsWith("\n") || !existing ? "" : "\n") + entry + "\n",
  );
}
