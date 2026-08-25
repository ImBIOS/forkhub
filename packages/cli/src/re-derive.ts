import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isGitRepo, gitOrThrow, gitExec, shortSha } from "./git";
import { findTargetRepo } from "./target-repo";

export type ReDeriveOptions = {
  forkhubDir?: string;
  targetRepo?: string;
  force?: boolean;
};

export type ReDeriveResult = {
  patchId: string;
  bundlePath: string;
  status: "needs-derivation" | "current" | "unknown";
  filesInBundle: string[];
};

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function copyFiles(filePaths: string[], srcBase: string, destDir: string): void {
  ensureDir(destDir);
  for (const file of filePaths) {
    const src = join(srcBase, file);
    const dest = join(destDir, file);
    if (!existsSync(src)) continue;
    ensureDir(dirname(dest));
    const proc = Bun.spawn(["cp", src, dest], { stdout: "pipe", stderr: "pipe" });
    proc.exited.then(() => {});
  }
}

function dirname(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "." : path.slice(0, idx);
}

function readManifest(repoDir: string): any {
  return JSON.parse(readFileSync(join(repoDir, "manifest.json"), "utf-8"));
}

function readIntentTargetArea(intentPath: string): string[] {
  if (!existsSync(intentPath)) return [];
  const content = readFileSync(intentPath, "utf-8");
  const match = content.match(/^target_area:\s*\[(.+?)\]/m);
  if (!match?.[1]) return [];
  return match[1]
    .split(",")
    .map((s) => s.trim().replace(/["']/g, ""))
    .filter(Boolean);
}

function getUpstreamLocalPath(remoteUrl: string): string | null {
  if (
    remoteUrl.startsWith("git@") ||
    remoteUrl.startsWith("https://") ||
    remoteUrl.startsWith("http://")
  ) {
    return null;
  }
  return remoteUrl.replace(/\.git$/, "");
}

export async function runReDerive(
  patchId: string,
  options: ReDeriveOptions = {},
): Promise<ReDeriveResult> {
  if (!(await isGitRepo())) {
    throw new Error("Not a git repository. Run from inside your fork's checkout.");
  }

  const forkhubDir = options.forkhubDir ?? join(process.cwd(), "..", ".forkhub");
  if (!existsSync(forkhubDir)) {
    throw new Error(".forkhub repo not found. Run `forkhub init` first.");
  }

  const targetRepo = options.targetRepo ?? (await findTargetRepo(forkhubDir, process.cwd()));
  if (!targetRepo) {
    throw new Error("Could not determine target repo. Run `forkhub init` first.");
  }

  const repoDir = join(forkhubDir, "repos", targetRepo);
  const manifest = readManifest(repoDir);
  const patchInfo = manifest.patches[patchId];
  if (!patchInfo) {
    throw new Error(`Patch ${patchId} not found in manifest.`);
  }

  const patchDir = join(repoDir, "patches", patchId);
  const upstreamJson = JSON.parse(readFileSync(join(repoDir, "upstream.json"), "utf-8"));
  const upstreamRemote = upstreamJson.upstream_remote ?? "upstream";
  const upstreamBranch = manifest.upstream_main_branch ?? "main";
  const upstreamRef = `${upstreamRemote}/${upstreamBranch}`;

  const intentPath = join(patchDir, "INTENT.md");
  const targetArea = readIntentTargetArea(intentPath);
  const lastRealizedSha = patchInfo.last_realized_against_commit;

  const fetchResult = await gitExec(["fetch", upstreamRemote, "--quiet"]);
  if (fetchResult.exitCode !== 0) {
    throw new Error(`Could not fetch from ${upstreamRemote}: ${fetchResult.stderr}`);
  }
  const upstreamSha = await gitOrThrow(["rev-parse", upstreamRef]);

  const status: ReDeriveResult["status"] =
    lastRealizedSha && shortSha(lastRealizedSha) === shortSha(upstreamSha)
      ? "current"
      : "needs-derivation";

  if (status === "current" && !options.force) {
    return { patchId, bundlePath: "", status: "current", filesInBundle: [] };
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const bundlePath = join(forkhubDir, "derive", patchId, timestamp);
  ensureDir(bundlePath);
  ensureDir(join(bundlePath, "REALIZATION"));

  const filesInBundle: string[] = [];

  for (const src of ["INTENT.md", "ACCEPTANCE.md", "reference.diff", "attempts.jsonl"]) {
    const srcPath = join(patchDir, src);
    if (existsSync(srcPath)) {
      const proc = Bun.spawn(["cp", srcPath, join(bundlePath, src)], {
        stdout: "pipe",
        stderr: "pipe",
      });
      await proc.exited;
      filesInBundle.push(src);
    }
  }

  const siblingDir = join(bundlePath, "siblings");
  ensureDir(siblingDir);
  for (const [siblingId, siblingInfo] of Object.entries(manifest.patches) as [string, any][]) {
    if (siblingId === patchId) continue;
    if (siblingInfo.status !== "applied" && siblingInfo.status !== "imported") continue;
    const siblingPatchDir = join(repoDir, "patches", siblingId);
    const siblingIntent = readFileSync(join(siblingPatchDir, "INTENT.md"), "utf-8");
    const siblingTitle = siblingIntent.match(/^title:\s*(.+)$/m)?.[1]?.trim() ?? siblingId;
    const siblingDiff = existsSync(join(siblingPatchDir, "reference.diff"))
      ? readFileSync(join(siblingPatchDir, "reference.diff"), "utf-8")
      : "(no reference.diff)";
    const siblingMd = `# Sibling: ${siblingId}\n\n**Title**: ${siblingTitle}\n\n**Status**: ${siblingInfo.status}\n\n**Reference diff**:\n\n\`\`\`diff\n${siblingDiff}\n\`\`\`\n`;
    await Bun.write(join(siblingDir, `${siblingId}.md`), siblingMd);
    filesInBundle.push(`siblings/${siblingId}.md`);
  }

  if (targetArea.length > 0 && lastRealizedSha) {
    const areaArgs = targetArea.flatMap((a) => ["--", a]);
    const diffSummary = await gitOrThrow([
      "diff",
      "--stat",
      `${lastRealizedSha}..${upstreamRef}`,
      ...areaArgs,
    ]);
    const diffFull = await gitOrThrow(["diff", `${lastRealizedSha}..${upstreamRef}`, ...areaArgs]);
    const summary = `# Drift Summary

## What changed in upstream's target_area

Upstream went from \`${shortSha(lastRealizedSha)}\` to \`${shortSha(upstreamSha)}\`.

Target area: \`${targetArea.join(", ")}\`

## Files changed

\`\`\`
${diffSummary || "(no changes in target_area)"}
\`\`\`

## Full diff (target_area only)

\`\`\`diff
${diffFull || "(no diff)"}
\`\`\`
`;
    await Bun.write(join(bundlePath, "drift-summary.txt"), summary);
    filesInBundle.push("drift-summary.txt");
  } else {
    await Bun.write(
      join(bundlePath, "drift-summary.txt"),
      `# Drift Summary\n\nNo prior realization recorded. This is a first-time derivation.\n`,
    );
    filesInBundle.push("drift-summary.txt");
  }

  const upstreamUrl = upstreamJson.upstream_url ?? "";
  const upstreamLocalPath = getUpstreamLocalPath(upstreamUrl);
  if (upstreamLocalPath && existsSync(upstreamLocalPath)) {
    const upstreamDest = join(bundlePath, "upstream");
    if (targetArea.length > 0) {
      copyFiles(targetArea, upstreamLocalPath, upstreamDest);
      filesInBundle.push(...targetArea.map((f) => `upstream/${f}`));
    }
  }

  if (targetArea.length > 0) {
    const fhMainExists = await gitExec(["rev-parse", "--verify", "forkhub/main"]);
    if (fhMainExists.exitCode === 0) {
      const currentBranch = await gitOrThrow(["rev-parse", "--abbrev-ref", "HEAD"]);
      if (currentBranch !== "forkhub/main") {
        await gitOrThrow(["checkout", "--quiet", "forkhub/main"]);
      }
      copyFiles(targetArea, process.cwd(), join(bundlePath, "fork"));
      if (currentBranch !== "forkhub/main") {
        await gitOrThrow(["checkout", "--quiet", currentBranch]);
      }
      filesInBundle.push(...targetArea.map((f) => `fork/${f}`));
    } else {
      copyFiles(targetArea, process.cwd(), join(bundlePath, "fork"));
      filesInBundle.push(...targetArea.map((f) => `fork/${f}`));
    }
  }

  const readme = `# Re-derivation Context Bundle

**Patch**: \`${patchId}\`
**Generated**: ${new Date().toISOString()}
**Upstream**: ${shortSha(lastRealizedSha ?? "unknown")} → ${shortSha(upstreamSha)}

## What this is

This is a context bundle for re-deriving the patch against new upstream code.
The AI agent should read everything in this directory and produce a new realization
saved to \`REALIZATION/\`.

## Files in this bundle

- \`INTENT.md\` — the source of truth (what to implement)
- \`ACCEPTANCE.md\` — verification criteria
- \`reference.diff\` — previous realization (HINT only, do NOT apply mechanically)
- \`attempts.jsonl\` — past attempt history (learn from failures)
- \`drift-summary.txt\` — what changed in upstream's target_area
- \`siblings/\` — other patches already applied (preserve their code)
- \`upstream/\` — clean upstream code (no patches)
- \`fork/\` — current fork state (upstream + siblings)
- \`REALIZATION/\` — YOUR OUTPUT GOES HERE

## Steps for the AI

1. Read \`INTENT.md\` (source of truth for what to implement)
2. Read \`ACCEPTANCE.md\` (how to verify the result)
3. Read \`drift-summary.txt\` (what changed in upstream)
4. Read \`reference.diff\` (what worked last time — HINT only, not literal)
5. Read \`attempts.jsonl\` (past failures to avoid)
6. Read \`siblings/*.md\` (what other patches added — must coexist)
7. Compare \`upstream/\` vs \`fork/\` (to understand current state)
8. Implement the patch against \`fork/\`
9. Save your diff to \`REALIZATION/realization.diff\`
10. Write your self-evaluation to \`REALIZATION/report.md\`

## Constraints

- DO NOT modify files the INTENT says are off-limits
- DO NOT apply reference.diff mechanically — re-derive from intent
- DO preserve sibling patches' code verbatim
- DO write a clean unified diff (only the lines that change)
- The realization must be a valid \`git diff\` that can be applied with \`git apply\`

## After the AI finishes

Run \`forkhub apply ${bundlePath}\` to validate and finalize.
`;
  await Bun.write(join(bundlePath, "README.md"), readme);
  filesInBundle.push("README.md");

  const prompt = `# Re-derivation Task

You are re-deriving the patch \`${patchId}\` against new upstream code.

## Your task

1. Read \`INTENT.md\` (source of truth — what to implement)
2. Read \`ACCEPTANCE.md\` (verification criteria)
3. Read \`drift-summary.txt\` (what changed in upstream)
4. Read \`reference.diff\` (previous realization — HINT only, do NOT apply mechanically)
5. Read \`attempts.jsonl\` (past failures to avoid)
6. Read \`siblings/*.md\` (other patches already applied — preserve their code)
7. Compare \`upstream/\` and \`fork/\` (to understand current state)
8. Implement the patch against \`fork/\`
9. Save the diff to \`REALIZATION/realization.diff\` (must be valid \`git apply\` format)
10. Write a self-evaluation to \`REALIZATION/report.md\`

## Constraints

- DO NOT modify files the INTENT says are off-limits
- DO NOT apply reference.diff mechanically — re-derive from intent
- DO preserve sibling patches' code verbatim
- DO write a clean unified diff (only the lines that change)

## Output

When done, the \`forkhub apply\` command will validate and finalize. Make sure:
- \`REALIZATION/realization.diff\` exists and is non-empty
- \`REALIZATION/report.md\` describes what you did

Begin.
`;
  await Bun.write(join(bundlePath, "prompt.md"), prompt);
  filesInBundle.push("prompt.md");

  return {
    patchId,
    bundlePath,
    status,
    filesInBundle,
  };
}
