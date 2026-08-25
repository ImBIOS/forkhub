import { existsSync } from "node:fs";
import { join } from "node:path";
import { gitExec, gitOrThrow } from "./git";
import { findTargetRepo } from "./target-repo";
import { resolveTagPattern, globToRegExp, DEFAULT_TAG_PATTERN } from "./tags";

export type PushOptions = {
  forkhubDir?: string;
  targetRepo?: string;
  /** Remote to push code refs to (default: manifest fork_remote ?? origin). */
  remote?: string;
  dryRun?: boolean;
  /** Also push the .forkhub metadata repo to its origin. */
  withMetadata?: boolean;
};

export type PushResult = {
  remote: string;
  branchPushed: boolean;
  tagsPushed: string[];
  metadataPushed: boolean;
  errors: string[];
};

/**
 * Share consumer-visible state: forkhub/main + all track-matching tags.
 * Multi-machine setups otherwise silently lag behind local-only tags.
 */
export async function runPush(options: PushOptions = {}): Promise<PushResult> {
  const errors: string[] = [];
  let branchPushed = false;
  let metadataPushed = false;

  const forkhubDir = options.forkhubDir ?? join(process.cwd(), "..", ".forkhub");
  if (!existsSync(forkhubDir)) {
    throw new Error(".forkhub repo not found. Run `fh init` first.");
  }

  const manifestPath = join(forkhubDir, "repos");
  let forkRemote: string | null = null;
  let pattern = DEFAULT_TAG_PATTERN;
  if (existsSync(manifestPath)) {
    try {
      const targetRepo = options.targetRepo ?? (await findTargetRepo(forkhubDir, process.cwd()));
      const manifest = JSON.parse(
        await Bun.file(join(forkhubDir, "repos", targetRepo, "manifest.json")).text(),
      );
      forkRemote = manifest.fork_remote ?? null;
    } catch (err) {
      errors.push(`manifest lookup: ${err instanceof Error ? err.message : err}`);
    }
    pattern = await resolveTagPattern(forkhubDir);
  }

  const remote = options.remote ?? forkRemote ?? "origin";

  const remoteCheck = await gitExec(["remote", "get-url", remote]);
  if (remoteCheck.exitCode !== 0) {
    throw new Error(
      `No '${remote}' remote on your checkout. Add it or pass --remote <name>.\n` +
        `  git remote add ${remote} git@github.com:YOU/your-fork.git`,
    );
  }

  // forkhub/main
  const fhMain = await gitExec(["rev-parse", "--verify", "forkhub/main"]);
  if (fhMain.exitCode === 0) {
    if (!options.dryRun) {
      const pushResult = await gitExec(["push", remote, "forkhub/main:forkhub/main"]);
      if (pushResult.exitCode !== 0) {
        errors.push(`forkhub/main: ${pushResult.stderr || pushResult.stdout}`);
      } else {
        branchPushed = true;
      }
    }
  } else {
    errors.push("forkhub/main does not exist yet — nothing to push for the branch.");
  }

  // Track-matching tags only.
  const tagListing = await gitOrThrow(["tag", "--list"]);
  const matching = tagListing
    .split("\n")
    .filter(Boolean)
    .filter((t) => globToRegExp(pattern).test(t));

  let tagsPushed: string[] = [];
  if (matching.length > 0 && !options.dryRun) {
    const pushArgs = ["push", remote, ...matching.map((t) => `refs/tags/${t}:refs/tags/${t}`)];
    const pushResult = await gitExec(pushArgs);
    if (pushResult.exitCode !== 0) {
      errors.push(`tags: ${pushResult.stderr || pushResult.stdout}`);
    } else {
      tagsPushed = matching;
    }
  } else if (options.dryRun) {
    tagsPushed = matching;
  }

  // Optionally publish .forkhub metadata too.
  if (options.withMetadata) {
    const metaRemote = await gitExec(["remote", "get-url", "origin"], forkhubDir);
    if (metaRemote.exitCode !== 0) {
      errors.push("metadata: no 'origin' remote configured on .forkhub repo.");
    } else {
      const metaBranch =
        (await gitExec(["rev-parse", "--abbrev-ref", "HEAD"], forkhubDir)).stdout || "main";
      const metaPush = await gitExec(["push", "origin", metaBranch], forkhubDir);
      if (metaPush.exitCode !== 0) {
        errors.push(`metadata: ${metaPush.stderr || metaPush.stdout}`);
      } else {
        metadataPushed = true;
      }
    }
  }

  return { remote, branchPushed, tagsPushed, metadataPushed, errors };
}
