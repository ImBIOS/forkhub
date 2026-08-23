import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isGitRepo,
  gitOrThrow,
  gitExec,
  shortSha,
} from "./git";
import { bold, dim, green, yellow, red, magenta, cyan, gray, ok, warn, fail, statusBadge, sha as paintSha, meta } from "./style";

export type DriftCheckOptions = {
  forkhubDir?: string;
};

export type PatchDriftStatus = {
  patchId: string;
  status: "current" | "drifted" | "unknown" | "upstreamed";
  lastRealizedSha: string;
  targetArea: string[];
  upstreamChanged: boolean;
  targetAreaChanged: boolean;
  filesChangedInTargetArea: string[];
  appliedUpstreamPr?: {
    number: number;
    url: string;
    state: "open" | "merged" | "closed";
    mergeCommit?: string;
  } | null;
};

export type DriftCheckResult = {
  upstreamSha: string;
  lastKnownSha: string;
  upstreamAdvanced: boolean;
  patches: PatchDriftStatus[];
  summary: {
    total: number;
    current: number;
    drifted: number;
    wouldSkip: number;
  };
};

function readManifest(repoDir: string): any {
  const manifestPath = join(repoDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error("manifest.json not found. Run `forkhub init` first.");
  }
  return JSON.parse(readFileSync(manifestPath, "utf-8"));
}

function readUpstreamConfig(repoDir: string): any {
  const upstreamJsonPath = join(repoDir, "upstream.json");
  if (!existsSync(upstreamJsonPath)) {
    throw new Error("upstream.json not found. Run `forkhub init` first.");
  }
  return JSON.parse(readFileSync(upstreamJsonPath, "utf-8"));
}

function readIntentTargetArea(repoDir: string, patchId: string): string[] {
  const intentPath = join(repoDir, "patches", patchId, "INTENT.md");
  if (!existsSync(intentPath)) return [];
  const content = readFileSync(intentPath, "utf-8");
  const match = content.match(/^target_area:\s*\[(.+?)\]/m);
  if (!match?.[1]) return [];
  return match[1]
    .split(",")
    .map((s) => s.trim().replace(/["']/g, ""))
    .filter(Boolean);
}

async function findTargetRepo(forkhubDir: string, forkCwd: string): Promise<string> {
  const { getRemoteUrl, listRemotes } = await import("./git");
  for (const remote of await listRemotes(forkCwd)) {
    const url = await getRemoteUrl(remote, forkCwd);
    if (!url) continue;
    let match = url.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
    if (match) {
      const targetRepo = `${match[1]}/${match[2]}`;
      if (existsSync(join(forkhubDir, "repos", targetRepo, "manifest.json"))) return targetRepo;
    }
    match = url.match(/^https?:\/\/([^/]+)\/(.+?)(?:\.git)?$/);
    if (match) {
      const targetRepo = `${match[1]}/${match[2]}`;
      if (existsSync(join(forkhubDir, "repos", targetRepo, "manifest.json"))) return targetRepo;
    }
  }
  const { readdirSync } = await import("node:fs");
  const reposDir = join(forkhubDir, "repos");
  if (!existsSync(reposDir)) {
    throw new Error("No repos found in .forkhub. Run `forkhub init` first.");
  }
  for (const host of readdirSync(reposDir)) {
    for (const owner of readdirSync(join(reposDir, host))) {
      for (const repo of readdirSync(join(reposDir, host, owner))) {
        const targetRepo = `${host}/${owner}/${repo}`;
        if (existsSync(join(reposDir, targetRepo, "manifest.json"))) {
          return targetRepo;
        }
      }
    }
  }
  throw new Error("Could not determine target repo from .forkhub.");
}

/**
 * Check the state of an upstream PR via `gh pr view`.
 * Returns the PR state (open/merged/closed) and merge commit SHA if merged.
 * On failure (gh not installed, no auth, network), returns null — callers
 * should not block drift-check just because PR tracking is unavailable.
 */
async function checkUpstreamPrState(
  targetRepo: string,
  prNumber: number,
): Promise<{ state: "open" | "merged" | "closed"; mergeCommit?: string } | null> {
  // Use gh CLI (not git) to query PR state
  const proc = Bun.spawn(["gh", "pr", "view", String(prNumber),
    "--repo", targetRepo,
    "--json", "state,mergeCommit",
  ], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    // gh not installed, no auth, or PR not found — don't block
    return null;
  }
  try {
    const data = JSON.parse(stdout.trim());
    const rawState = data.state?.toUpperCase();
    if (rawState === "MERGED") {
      return { state: "merged", mergeCommit: data.mergeCommit?.oid };
    }
    if (rawState === "CLOSED") {
      return { state: "closed" };
    }
    return { state: "open" };
  } catch {
    return null;
  }
}

export async function runDriftCheck(options: DriftCheckOptions = {}): Promise<DriftCheckResult> {
  if (!(await isGitRepo())) {
    throw new Error("Not a git repository. Run from inside your fork's checkout.");
  }

  const forkhubDir = options.forkhubDir ?? join(process.cwd(), "..", ".forkhub");
  if (!existsSync(forkhubDir)) {
    throw new Error(".forkhub repo not found. Run `forkhub init` first.");
  }

  const targetRepo = await findTargetRepo(forkhubDir, process.cwd());
  const repoDir = join(forkhubDir, "repos", targetRepo);
  const manifest = readManifest(repoDir);
  const upstreamConfig = readUpstreamConfig(repoDir);

  const upstreamRemote = upstreamConfig.upstream_remote ?? "upstream";
  const upstreamBranch = `${upstreamRemote}/${manifest.upstream_main_branch ?? "main"}`;

  const fetchResult = await gitExec(["fetch", upstreamRemote, "--quiet"]);
  if (fetchResult.exitCode !== 0) {
    throw new Error(`Could not fetch from ${upstreamRemote}: ${fetchResult.stderr}`);
  }

  const upstreamSha = await gitOrThrow(["rev-parse", upstreamBranch]);
  const lastKnownSha = upstreamConfig.last_known_upstream_sha ?? upstreamSha;
  const upstreamAdvanced = shortSha(upstreamSha) !== shortSha(lastKnownSha);

  const patchIds = Object.keys(manifest.patches || {});
  const patchStatuses: PatchDriftStatus[] = [];
  let manifestDirty = false;

  for (const patchId of patchIds) {
    const patchInfo = manifest.patches[patchId];
    const lastRealizedSha = patchInfo.last_realized_against_commit;
    const targetArea = readIntentTargetArea(repoDir, patchId);
    const appliedPr = patchInfo.applied_upstream_pr;

    let status: PatchDriftStatus["status"] = "unknown";
    let upstreamChanged = false;
    let targetAreaChanged = false;
    let filesChangedInTargetArea: string[] = [];
    let prInfo: PatchDriftStatus["appliedUpstreamPr"] = null;

    // Check upstream PR state if tracked. If merged → UPSTREAMED.
    // If closed (not merged) → NEEDS_HUMAN (surface to user).
    if (appliedPr?.number) {
      const prState = await checkUpstreamPrState(targetRepo, appliedPr.number);
      if (prState) {
        prInfo = {
          number: appliedPr.number,
          url: appliedPr.url ?? `https://github.com/${targetRepo}/pull/${appliedPr.number}`,
          state: prState.state,
          mergeCommit: prState.mergeCommit,
        };
        if (prState.state === "merged") {
          status = "upstreamed";
          // If we have the merge commit, advance last_realized to it so the
          // next drift cycle starts from the post-merge state.
          if (prState.mergeCommit) {
            patchInfo.last_realized_against_commit = shortSha(prState.mergeCommit);
            manifestDirty = true;
          }
        }
      }
    }

    if (status !== "upstreamed") {
      if (!lastRealizedSha) {
        status = "drifted";
        upstreamChanged = true;
        targetAreaChanged = true;
        filesChangedInTargetArea = ["(imported — needs first realization)"];
      } else if (shortSha(lastRealizedSha) === shortSha(upstreamSha)) {
        status = "current";
      } else {
        upstreamChanged = true;
        if (targetArea.length > 0) {
          const areaArgs = targetArea.flatMap((a) => ["--", a]);
          const diffResult = await gitExec([
            "diff", "--name-only", `${lastRealizedSha}..${upstreamSha}`, ...areaArgs,
          ]);
          filesChangedInTargetArea = diffResult.stdout
            ? diffResult.stdout.split("\n").filter(Boolean)
            : [];

          if (filesChangedInTargetArea.length > 0) {
            status = "drifted";
            targetAreaChanged = true;
          } else {
            status = "current";
          }
        } else {
          status = "drifted";
          targetAreaChanged = true;
        }
      }
    }

    patchStatuses.push({
      patchId,
      status,
      lastRealizedSha,
      targetArea,
      upstreamChanged,
      targetAreaChanged,
      filesChangedInTargetArea,
      appliedUpstreamPr: prInfo,
    });
  }

  // Persist manifest updates (e.g. advanced last_realized on UPSTREAMED)
  if (manifestDirty) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(repoDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  }

  const summary = {
    total: patchStatuses.length,
    current: patchStatuses.filter((p) => p.status === "current").length,
    drifted: patchStatuses.filter((p) => p.status === "drifted").length,
    wouldSkip: patchStatuses.filter((p) => p.status === "current" && p.upstreamChanged).length,
  };

  return {
    upstreamSha,
    lastKnownSha,
    upstreamAdvanced,
    patches: patchStatuses,
    summary,
  };
}

export function formatDriftCheckResult(result: DriftCheckResult): string {
  const lines: string[] = [];

  const advancedNote = result.upstreamAdvanced
    ? yellow(`(advanced from ${shortSha(result.lastKnownSha)})`)
    : green("(unchanged)");
  lines.push(`Upstream:  ${paintSha(shortSha(result.upstreamSha))} ${advancedNote}`);
  lines.push("");

  if (result.patches.length === 0) {
    lines.push(gray("No patches found."));
    return lines.join("\n");
  }

  for (const patch of result.patches) {
    const icon =
      patch.status === "current" ? ok()
      : patch.status === "drifted" ? warn()
      : patch.status === "upstreamed" ? magenta("↑")
      : gray("?");
    lines.push(`${icon} ${bold(patch.patchId)}`);
    lines.push(`   status:     ${statusBadge(patch.status)}`);
    lines.push(`   realized:   ${patch.lastRealizedSha ? paintSha(shortSha(patch.lastRealizedSha)) : gray("(not yet realized)")}`);
    lines.push(`   target_area: ${dim(`[${patch.targetArea.join(", ")}]`)}`);

    // Show upstream PR tracking info
    if (patch.appliedUpstreamPr) {
      const prState = patch.appliedUpstreamPr.state;
      const prIcon =
        prState === "merged" ? `${ok()} ${green("merged")}`
        : prState === "open" ? `${warn()} ${yellow("open")}`
        : `${fail()} ${red("closed")}`;
      lines.push(`   upstream PR: #${bold(String(patch.appliedUpstreamPr.number))} (${prIcon})`);
    }

    if (patch.status === "drifted") {
      const changed = patch.filesChangedInTargetArea.join(", ");
      const colored = changed === "(imported — needs first realization)" ? yellow(changed) : cyan(changed);
      lines.push(`   changed:    ${colored}`);
    } else if (patch.status === "current" && patch.upstreamChanged) {
      lines.push(`   skip:       ${meta("target_area untouched (0 tokens)")}`);
    }
    lines.push("");
  }

  lines.push(
    `Summary: ${bold(String(result.summary.total))} patches, ` +
      `${green(String(result.summary.current))} current, ` +
      `${result.summary.drifted > 0 ? red(String(result.summary.drifted)) : String(result.summary.drifted)} drifted`,
  );
  if (result.summary.wouldSkip > 0) {
    lines.push(`         ${meta(`${result.summary.wouldSkip} would be skipped (target_area untouched)`)}`);
  }

  if (result.summary.drifted > 0) {
    lines.push(`\n${warn()} ${yellow(`${result.summary.drifted} patch(es) need re-derivation.`)}`);
  } else {
    lines.push(`\n${ok()} ${green("All patches current. No action needed.")}`);
  }

  return lines.join("\n");
}
