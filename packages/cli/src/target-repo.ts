import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getRemoteUrl, listRemotes } from "./git";

/**
 * Resolve which repo under `.forkhub/repos/<host>/<owner>/<repo>` the current
 * checkout corresponds to.
 *
 * 1. Exact match: one of the checkout's remote URLs maps to a configured repo.
 * 2. Explicit override via `--target` (preferred when multiple targets exist).
 * 3. Fallback: first repo found — DANGEROUS with multiple targets, so warn
 *    loudly on stderr instead of silently guessing.
 */
export async function findTargetRepo(
  forkhubDir: string,
  forkCwd: string,
  explicitTarget?: string,
): Promise<string> {
  const reposDir = join(forkhubDir, "repos");
  if (!existsSync(reposDir)) {
    throw new Error("No repos found in .forkhub. Run `forkhub init` first.");
  }

  if (explicitTarget) {
    if (!existsSync(join(reposDir, explicitTarget, "manifest.json"))) {
      throw new Error(
        `Target repo not configured: ${explicitTarget}. Expected ${join(reposDir, explicitTarget, "manifest.json")}.`,
      );
    }
    return explicitTarget;
  }

  const matches: string[] = [];
  for (const remote of await listRemotes(forkCwd)) {
    const url = await getRemoteUrl(remote, forkCwd);
    if (!url) continue;
    let match = url.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
    if (match) {
      const candidate = `${match[1]}/${match[2]}`;
      if (existsSync(join(reposDir, candidate, "manifest.json"))) matches.push(candidate);
    }
    match = url.match(/^https?:\/\/([^/]+)\/(.+?)(?:\.git)?$/);
    if (match) {
      const candidate = `${match[1]}/${match[2]}`;
      if (existsSync(join(reposDir, candidate, "manifest.json"))) matches.push(candidate);
    }
  }

  const unique = [...new Set(matches)];
  if (unique.length === 1) return unique[0]!;
  if (unique.length > 1) {
    throw new Error(
      `Multiple target repos match this checkout's remotes:\n` +
        unique.map((r) => `  - ${r}`).join("\n") +
        `\nDisambiguate with --target <host/owner/repo>.`,
    );
  }

  // Second pass: compare remote URLs against each configured repo's recorded
  // upstream_url / fork_url — catches local-path remotes that the git@/https
  // regexes above can't parse.
  for (const repo of allConfiguredRepos(reposDir)) {
    const urls = recordedUrls(forkhubDir, repo);
    for (const remote of await listRemotes(forkCwd)) {
      const url = await getRemoteUrl(remote, forkCwd);
      if (url && urls.has(normalizeUrl(url))) {
        return repo;
      }
    }
  }

  // Fallback: first repo found.
  const found = firstConfiguredRepo(reposDir);
  if (found) {
    const all = allConfiguredRepos(reposDir);
    console.error(
      `⚠ Could not match any git remote to a .forkhub target repo; falling back to "${found}".`,
    );
    if (all.length > 1) {
      console.error(
        `⚠ ${all.length} targets are configured (${all.join(", ")}) — this may be the WRONG repo.\n` +
          `  Pass --target <host/owner/repo> to be explicit.`,
      );
    }
    return found;
  }

  throw new Error("Could not determine target repo. Run `forkhub init` first.");
}

export function firstConfiguredRepo(reposDir: string): string | null {
  return allConfiguredRepos(reposDir)[0] ?? null;
}

function normalizeUrl(url: string): string {
  return url
    .trim()
    .replace(/\.git\/?$/, "")
    .replace(/\/$/, "");
}

/** URLs a configured repo claims to track (upstream_url, fork_url, target_repo). */
function recordedUrls(forkhubDir: string, repo: string): Set<string> {
  const urls = new Set<string>();
  const repoDir = join(forkhubDir, "repos", repo);
  const upstreamJsonPath = join(repoDir, "upstream.json");
  if (existsSync(upstreamJsonPath)) {
    try {
      const cfg = JSON.parse(readFileSync(upstreamJsonPath, "utf-8"));
      for (const key of ["upstream_url", "fork_url"]) {
        const v = (cfg as Record<string, unknown>)[key];
        if (typeof v === "string" && v) urls.add(normalizeUrl(v));
      }
    } catch {
      // unparseable config — skip
    }
  }
  return urls;
}

export function allConfiguredRepos(reposDir: string): string[] {
  if (!existsSync(reposDir)) return [];
  const result: string[] = [];
  for (const host of readdirSync(reposDir)) {
    const hostsPath = join(reposDir, host);
    let owners: string[] = [];
    try {
      owners = readdirSync(hostsPath);
    } catch {
      continue;
    }
    for (const owner of owners) {
      const ownerPath = join(hostsPath, owner);
      let repos: string[] = [];
      try {
        repos = readdirSync(ownerPath);
      } catch {
        continue;
      }
      for (const repo of repos) {
        if (existsSync(join(ownerPath, repo, "manifest.json"))) {
          result.push(`${host}/${owner}/${repo}`);
        }
      }
    }
  }
  return result;
}
