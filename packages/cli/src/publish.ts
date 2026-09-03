import { existsSync } from "node:fs";
import { join } from "node:path";
import { isGitRepo, gitOrThrow, gitExec } from "./git";

export type PublishOptions = {
  forkhubDir?: string;
  message?: string;
  allowMissingPr?: boolean;
};

export type PublishResult = {
  pushed: boolean;
  remote: string;
  commitSha: string;
  commitMessage: string;
  filesStaged: number;
};

async function findTargetRepoForPublish(forkhubDir: string, cwd: string): Promise<string | null> {
  const { getRemoteUrl, listRemotes } = await import("./git");
  const reposBase = join(forkhubDir, "repos");
  if (!existsSync(reposBase)) return null;
  for (const remote of await listRemotes(cwd)) {
    const url = await getRemoteUrl(remote, cwd);
    if (!url) continue;
    let match = url.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
    if (match) {
      const targetRepo = `${match[1]}/${match[2]}`;
      if (existsSync(join(reposBase, targetRepo, "manifest.json"))) return targetRepo;
    }
    match = url.match(/^https?:\/\/([^/]+)\/(.+?)(?:\.git)?$/);
    if (match) {
      const targetRepo = `${match[1]}/${match[2]}`;
      if (existsSync(join(reposBase, targetRepo, "manifest.json"))) return targetRepo;
    }
  }
  return null;
}

async function validatePatchesHavePrIssue(
  forkhubDir: string,
  allowMissingPr: boolean,
): Promise<void> {
  if (allowMissingPr) return;
  const { readdirSync, readFileSync } = await import("node:fs");
  const reposBase = join(forkhubDir, "repos");
  if (!existsSync(reposBase)) return;
  const targetRepo = await findTargetRepoForPublish(forkhubDir, process.cwd());
  const reposToCheck: Array<{ host: string; owner: string; repo: string; manifestPath: string }> =
    [];
  if (targetRepo) {
    const parts = targetRepo.split("/");
    if (parts.length === 3) {
      reposToCheck.push({
        host: parts[0]!,
        owner: parts[1]!,
        repo: parts[2]!,
        manifestPath: join(reposBase, targetRepo, "manifest.json"),
      });
    }
  } else {
    const hosts = readdirSync(reposBase).filter((h) => {
      try {
        return readdirSync(join(reposBase, h)).length > 0;
      } catch {
        return false;
      }
    });
    for (const host of hosts) {
      const ownersPath = join(reposBase, host);
      let owners: string[] = [];
      try {
        owners = readdirSync(ownersPath);
      } catch {
        continue;
      }
      for (const owner of owners) {
        const reposPath = join(ownersPath, owner);
        let repos: string[] = [];
        try {
          repos = readdirSync(reposPath);
        } catch {
          continue;
        }
        for (const repo of repos) {
          reposToCheck.push({
            host,
            owner,
            repo,
            manifestPath: join(reposPath, repo, "manifest.json"),
          });
        }
      }
    }
  }
  for (const { host, owner, repo, manifestPath } of reposToCheck) {
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const targetRepo = `${host}/${owner}/${repo}`;
    const patches = manifest.patches as Record<string, any> | undefined;
    if (!patches) continue;
    // Best-effort: a PR opened via `gh pr create` (not `fh pr`) leaves the
    // manifest stale. Auto-link it by branch name so publish doesn't block.
    const { autoLinkPrByBranch } = await import("./link-pr");
    let manifestChanged = false;
    for (const [patchId, patch] of Object.entries(patches)) {
      if (patch.status !== "applied" || patch.private) continue;
      const pr = patch.applied_upstream_pr;
      if (pr && typeof pr.number === "number" && pr.url) continue;
      if (typeof patch.branch !== "string" || !patch.branch) continue;
      const linked = await autoLinkPrByBranch(forkhubDir, targetRepo, patchId, patch.branch);
      if (linked) manifestChanged = true;
    }
    const refreshed = manifestChanged ? JSON.parse(readFileSync(manifestPath, "utf8")) : manifest;
    const refreshedPatches = refreshed.patches as Record<string, any> | undefined;
    if (!refreshedPatches) continue;
    const missing: string[] = [];
    for (const [patchId, patch] of Object.entries(refreshedPatches)) {
      if (patch.status !== "applied") continue;
      if ((patch as any).private) continue;
      const pr = (patch as any).applied_upstream_pr;
      const hasPr = pr && typeof pr.number === "number" && pr.url;
      const hasIssue = pr && (pr.issue || pr.issue_number);
      if (!hasPr || !hasIssue) {
        const reasons: string[] = [];
        if (!hasPr) reasons.push("missing PR (applied_upstream_pr.number/url)");
        if (!hasIssue) reasons.push("missing linked issue (applied_upstream_pr.issue)");
        missing.push(
          `  - ${patchId} (${(patch as any).branch ?? "unknown branch"}): ${reasons.join(", ")}`,
        );
      } else if (pr.state && pr.state !== "open") {
        missing.push(`  - ${patchId}: PR #${pr.number} is not open (state=${pr.state})`);
      }
    }
    if (missing.length > 0) {
      throw new Error(
        `Publish blocked: ${missing.length} applied patch(es) in ${host}/${owner}/${repo} have no open issue+PR tracking in the original repo (required by default).\n` +
          missing.join("\n") +
          "\n\n" +
          `Fix: for each patch, create an issue and PR in the upstream repo, then link them:\n` +
          `  1. gh issue create --repo ${host}/${owner}/${repo} --title "..." --body "..."\n` +
          `  2. git checkout <patch-branch> && fh pr  # pushes branch + opens PR + updates manifest\n` +
          `  3. Or link an existing PR: fh link-pr <patch-id|branch> <pr-number|pr-url>\n` +
          `  4. Ensure manifest.json has applied_upstream_pr with {number, url, issue, issue_number, state:"open"}\n\n` +
          `To bypass this check for private patches (not recommended), run:\n` +
          `  fh publish --allow-missing-pr\n` +
          `Or mark a patch as private in manifest.json (add "private": true).\n`,
      );
    }
  }
}

export async function runPublish(options: PublishOptions = {}): Promise<PublishResult> {
  const forkhubDir = options.forkhubDir ?? join(process.cwd(), "..", ".forkhub");
  if (!existsSync(forkhubDir)) {
    throw new Error(".forkhub repo not found. Run `forkhub init` first.");
  }

  await validatePatchesHavePrIssue(forkhubDir, options.allowMissingPr ?? false);

  // Check that it's a git repo
  const isRepo = await isGitRepo(forkhubDir);
  if (!isRepo) {
    throw new Error(
      `${forkhubDir} is not a git repo. Initialize it with: cd ${forkhubDir} && git init && git remote add origin <your-github-repo>`,
    );
  }

  // Check remote exists
  const remoteResult = await gitExec(["remote", "get-url", "origin"], forkhubDir);
  if (remoteResult.exitCode !== 0) {
    throw new Error(
      "No 'origin' remote set on .forkhub repo. Add one:\n" +
        `  cd ${forkhubDir}\n` +
        "  git remote add origin git@github.com:USERNAME/.forkhub.git",
    );
  }
  const remote = remoteResult.stdout;

  // Stage all patch files
  await gitOrThrow(["add", "-A"], forkhubDir);

  // Check if there's anything to commit
  const statusResult = await gitExec(["status", "--porcelain", "--untracked-files=no"], forkhubDir);
  const stagedFiles = statusResult.stdout
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .filter((l) => l.startsWith("A") || l.startsWith("M") || l.startsWith("D"));

  if (stagedFiles.length === 0) {
    // Nothing to publish
    const shaResult = await gitExec(["rev-parse", "HEAD"], forkhubDir);
    return {
      pushed: false,
      remote,
      commitSha: shaResult.stdout.slice(0, 7),
      commitMessage: "(no changes)",
      filesStaged: 0,
    };
  }

  // Commit
  const message =
    options.message ?? `chore: sync patches (${new Date().toISOString().split("T")[0]})`;
  await gitOrThrow(["commit", "-m", message, "--no-allow-empty"], forkhubDir);

  // Push
  const branchResult = await gitExec(["rev-parse", "--abbrev-ref", "HEAD"], forkhubDir);
  const branch = branchResult.stdout || "main";
  const pushResult = await gitExec(["push", "origin", branch], forkhubDir);
  if (pushResult.exitCode !== 0) {
    throw new Error(
      `git push failed: ${pushResult.stderr || pushResult.stdout}\n` +
        `The commit was made but not pushed. Check your remote and branch.\n` +
        `Remote: ${remote}\nBranch: ${branch}`,
    );
  }

  const shaResult = await gitExec(["rev-parse", "HEAD"], forkhubDir);

  return {
    pushed: true,
    remote,
    commitSha: shaResult.stdout.slice(0, 7),
    commitMessage: message,
    filesStaged: stagedFiles.length,
  };
}
