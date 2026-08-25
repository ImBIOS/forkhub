import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isGitRepo,
  gitOrThrow,
  gitExec,
  shortSha,
} from "./git";

export type DriftCheckOptions = {
  forkhubDir?: string;
};

export type PatchDriftStatus = {
  patchId: string;
  title?: string | null;
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
    /** false when the PR merged somewhere other than the tracked upstream branch */
    mergeOnTrackedBranch?: boolean;
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

function readIntentMeta(repoDir: string, patchId: string): { title: string | null; targetArea: string[] } {
  const intentPath = join(repoDir, "patches", patchId, "INTENT.md");
  if (!existsSync(intentPath)) return { title: null, targetArea: [] };
  const content = readFileSync(intentPath, "utf-8");
  const titleMatch = content.match(/^title:\s*(.+)$/m);
  const areaMatch = content.match(/^target_area:\s*\[(.+?)\]/m);
  const targetArea = areaMatch?.[1]
    ? areaMatch[1]
        .split(",")
        .map((s) => s.trim().replace(/["']/g, ""))
        .filter(Boolean)
    : [];
  return { title: titleMatch?.[1]?.trim().replace(/["']/g, "") ?? null, targetArea };
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
  const [stdout] = await Promise.all([
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
    const intentMeta = readIntentMeta(repoDir, patchId);
    const targetArea = intentMeta.targetArea;
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
          // Only trust the merge commit when it actually landed on the
          // tracked upstream branch — `fh pr --base` allows merging a PR
          // elsewhere, and advancing last_realized to such a commit would
          // silently corrupt drift tracking.
          const mergeOnTracked =
            !!prState.mergeCommit &&
            (
              await gitExec(["merge-base", "--is-ancestor", prState.mergeCommit, upstreamSha])
            ).exitCode === 0;
          if (mergeOnTracked) {
            status = "upstreamed";
            // Advance last_realized to the merge commit so the next drift
            // cycle starts from the post-merge state.
            patchInfo.last_realized_against_commit = shortSha(prState.mergeCommit!);
            manifestDirty = true;
          } else {
            prInfo.mergeOnTrackedBranch = false;
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
      title: intentMeta.title,
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

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

/** Strip C0/C1 control characters (incl. ESC) — INTENT.md fields are untrusted input. */
function sanitize(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u001F\u007F-\u009F]/g, "");
}

function summarizeFiles(files: string[], max = 3): string {
  if (files.length === 0) return "";
  const shown = files.slice(0, max).join(", ");
  const rest = files.length - Math.min(files.length, max);
  return rest > 0 ? `${shown} (+${rest} more)` : shown;
}

export function formatDriftCheckResult(result: DriftCheckResult): string {
  const lines: string[] = [];

  const drifted = result.patches.filter((p) => p.status === "drifted");
  const upstreamed = result.patches.filter((p) => p.status === "upstreamed");
  const unknown = result.patches.filter((p) => p.status === "unknown");
  const currentCount = result.summary.current;

  const labelOf = (p: PatchDriftStatus): string => {
    if (p.title) return `“${truncate(sanitize(p.title), 80)}”`;
    return truncate(sanitize(p.patchId), 60);
  };
  const pidOf = (p: PatchDriftStatus): string => sanitize(p.patchId);

  lines.push(
    `Upstream: ${shortSha(result.upstreamSha)} ${
      result.upstreamAdvanced ? `(advanced from ${shortSha(result.lastKnownSha)})` : "(unchanged since last check)"
    }`,
  );

  if (result.patches.length === 0) {
    lines.push("");
    lines.push("No intent patches tracked. Nothing to maintain.");
    return lines.join("\n");
  }

  lines.push(
    `${result.summary.total} intent ${result.summary.total === 1 ? "patch" : "patches"}: ${drifted.length} need re-derivation · ${upstreamed.length} upstreamed · ${unknown.length} unclear · ${currentCount} current`,
  );
  lines.push("");

  if (drifted.length > 0) {
    lines.push("Needs re-derivation — upstream changed files these patches cover:");
    lines.push("");
    for (const [i, patch] of drifted.entries()) {
      lines.push(`  ${i + 1}. ${labelOf(patch)}`);
      lines.push(`      patch:    ${pidOf(patch)}`);
      if (!patch.lastRealizedSha) {
        lines.push("      reason:   imported but never realized against upstream yet");
      } else if (patch.filesChangedInTargetArea.length > 0) {
        lines.push(
          `      reason:   ${patch.filesChangedInTargetArea.length} covered file(s) changed upstream since ${shortSha(patch.lastRealizedSha)}`,
        );
        lines.push(`                ${summarizeFiles(patch.filesChangedInTargetArea)}`);
      } else {
        lines.push("      reason:   target_area not declared — cannot prove it's still safe, treat as drifted");
      }
      if (patch.appliedUpstreamPr?.state === "open") {
        lines.push(
          `      upstream: PR #${patch.appliedUpstreamPr.number} still open — once merged, this patch becomes obsolete`,
        );
      } else if (patch.appliedUpstreamPr?.state === "closed") {
        lines.push(`      upstream: PR #${patch.appliedUpstreamPr.number} was closed without merging`);
      } else if (
        patch.appliedUpstreamPr?.state === "merged" &&
        patch.appliedUpstreamPr.mergeOnTrackedBranch === false
      ) {
        lines.push(
          `      upstream: PR #${patch.appliedUpstreamPr.number} merged, but NOT on the tracked upstream branch — ignoring it`,
        );
      }
      lines.push(`      fix:      fh re-derive ${pidOf(patch)}`);
      lines.push("");
    }
  }

  if (upstreamed.length > 0) {
    lines.push("Safe to drop — upstream now includes these patches:");
    for (const patch of upstreamed) {
      const merged = patch.appliedUpstreamPr?.mergeCommit
        ? ` (merged as ${shortSha(patch.appliedUpstreamPr.mergeCommit)})`
        : "";
      const pr = patch.appliedUpstreamPr ? ` — #${patch.appliedUpstreamPr.number}${merged}` : "";
      lines.push(`  • ${labelOf(patch)}${pr}`);
      lines.push(`      patch: ${pidOf(patch)}`);
    }
    lines.push("");
  }

  if (unknown.length > 0) {
    lines.push("Unclear state — needs a human look:");
    for (const patch of unknown) {
      lines.push(`  • ${labelOf(patch)}`);
      lines.push(`      patch: ${pidOf(patch)}`);
    }
    lines.push("");
  }

  if (drifted.length > 0) {
    lines.push("What to do next:");
    lines.push("  1. fh re-derive <patch-id>          regenerate the context bundle for each drifted patch");
    lines.push("  2. point your AI agent at prompt.md in the bundle and let it fill");
    lines.push("     REALIZATION/realization.diff (fh watch --agent can automate this)");
    lines.push("  3. fh apply <bundle-path>           apply + tag when tests pass");
  } else if (unknown.length > 0) {
    lines.push("Everything else is current; only the unclear entries above need attention.");
  } else if (upstreamed.length > 0) {
    lines.push("All covered. Consider removing the upstreamed patches from .forkhub.");
  } else {
    lines.push("All patches current. Nothing to do.");
  }

  return lines.join("\n");
}
