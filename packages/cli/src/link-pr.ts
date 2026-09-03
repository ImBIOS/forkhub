import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { isGitRepo } from "./git";
import { runGh } from "./pr";

export type LinkPrOptions = {
  forkhubDir?: string;
  targetRepo?: string;
};

export type LinkPrResult = {
  patchId: string;
  branch: string;
  prNumber: number;
  prUrl: string;
  prState: string;
};

function findTargetRepo(forkhubDir: string): string {
  const reposDir = join(forkhubDir, "repos");
  if (!existsSync(reposDir))
    throw new Error("No repos found in .forkhub. Run `forkhub init` first.");
  for (const host of readdirSync(reposDir)) {
    for (const owner of readdirSync(join(reposDir, host))) {
      for (const repo of readdirSync(join(reposDir, host, owner))) {
        const targetRepo = `${host}/${owner}/${repo}`;
        if (existsSync(join(reposDir, targetRepo, "manifest.json"))) return targetRepo;
      }
    }
  }
  throw new Error("Could not determine target repo. Run `forkhub init` first.");
}

function loadManifest(forkhubDir: string, targetRepo: string): { path: string; data: any } {
  const path = join(forkhubDir, "repos", targetRepo, "manifest.json");
  if (!existsSync(path))
    throw new Error(`Manifest not found at ${path}. Run \`forkhub init\` first.`);
  return { path, data: JSON.parse(readFileSync(path, "utf8")) };
}

function resolvePatchId(manifest: any, ref: string): { patchId: string; branch: string } {
  if (manifest.patches?.[ref]) {
    return { patchId: ref, branch: manifest.patches[ref].branch ?? ref };
  }
  for (const [id, p] of Object.entries<any>(manifest.patches ?? {})) {
    if (p.branch === ref) return { patchId: id, branch: p.branch };
  }
  throw new Error(`Patch '${ref}' not found in manifest (tried id and branch name).`);
}

function parsePrNumber(prRef: string): number {
  const urlMatch = prRef.match(/\/pull\/(\d+)/);
  if (urlMatch?.[1]) return parseInt(urlMatch[1], 10);
  const bare = prRef.trim().replace(/^#/, "");
  const n = parseInt(bare, 10);
  if (!Number.isNaN(n) && String(n) === bare) return n;
  throw new Error(
    `Could not parse PR reference: ${prRef}\nUse a PR number (e.g. 42) or URL (e.g. https://github.com/owner/repo/pull/42).`,
  );
}

/**
 * Link an existing upstream PR (created via `gh pr create` or the web UI)
 * to a forkhub patch, so `fh publish` no longer blocks on it.
 */
export async function runLinkPr(
  patchRef: string,
  prRef: string,
  options: LinkPrOptions = {},
): Promise<LinkPrResult> {
  if (!(await isGitRepo())) {
    throw new Error("Not a git repository. Run from inside your fork's checkout.");
  }
  const forkhubDir = options.forkhubDir ?? join(process.cwd(), "..", ".forkhub");
  if (!existsSync(forkhubDir))
    throw new Error(".forkhub repo not found. Run `forkhub init` first.");

  const targetRepo = options.targetRepo ?? findTargetRepo(forkhubDir);
  const { path: manifestPath, data: manifest } = loadManifest(forkhubDir, targetRepo);
  const { patchId, branch } = resolvePatchId(manifest, patchRef);
  const prNumber = parsePrNumber(prRef);

  let prUrl = `https://github.com/${targetRepo}/pull/${prNumber}`;
  let prState = "open";
  const viewed = await runGh([
    "pr",
    "view",
    String(prNumber),
    "--repo",
    targetRepo,
    "--json",
    "url,state",
  ]);
  if (viewed.exitCode === 0) {
    try {
      const parsed = JSON.parse(viewed.stdout);
      if (typeof parsed.url === "string" && parsed.url) prUrl = parsed.url;
      const raw = typeof parsed.state === "string" ? parsed.state.toUpperCase() : "";
      prState = raw === "MERGED" ? "merged" : raw === "CLOSED" ? "closed" : "open";
    } catch {}
  }

  const existing = manifest.patches[patchId].applied_upstream_pr ?? {};
  manifest.patches[patchId].applied_upstream_pr = {
    ...existing,
    number: prNumber,
    url: prUrl,
    state: prState,
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  return { patchId, branch, prNumber, prUrl, prState };
}

/**
 * Best-effort: find an open upstream PR for `branch` via `gh` and link it.
 * Returns the PR number when found, null when gh is missing/offline/no match.
 * Never throws — publish validation must not break without gh.
 */
export async function autoLinkPrByBranch(
  forkhubDir: string,
  targetRepo: string,
  patchId: string,
  branch: string,
): Promise<number | null> {
  try {
    const viewed = await runGh([
      "pr",
      "view",
      branch,
      "--repo",
      targetRepo,
      "--json",
      "number,url,state",
    ]);
    if (viewed.exitCode !== 0) return null;
    const parsed = JSON.parse(viewed.stdout);
    const prNumber =
      typeof parsed.number === "number" ? parsed.number : parseInt(parsed.number, 10);
    if (!prNumber) return null;
    const manifestPath = join(forkhubDir, "repos", targetRepo, "manifest.json");
    if (!existsSync(manifestPath)) return null;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (!manifest.patches?.[patchId]) return null;
    const raw = typeof parsed.state === "string" ? parsed.state.toUpperCase() : "";
    manifest.patches[patchId].applied_upstream_pr = {
      ...manifest.patches[patchId].applied_upstream_pr,
      number: prNumber,
      url:
        typeof parsed.url === "string"
          ? parsed.url
          : `https://github.com/${targetRepo}/pull/${prNumber}`,
      state: raw === "MERGED" ? "merged" : raw === "CLOSED" ? "closed" : "open",
    };
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    return prNumber;
  } catch {
    return null;
  }
}
