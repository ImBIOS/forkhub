import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export type ListOptions = {
  forkhubDir?: string;
  all?: boolean;
};

export type PatchListEntry = {
  targetRepo: string;
  patchId: string;
  title: string;
  status: string;
  lastRealized: string;
  branch: string;
  prNumber?: number;
  prUrl?: string;
  issueUrl?: string;
};

export type ListResult = {
  repos: { targetRepo: string; manifestPath: string; patches: PatchListEntry[] }[];
  total: number;
};

function resolveForkhubDirs(candidates: string[]): string[] {
  const dirs: string[] = [];
  for (const d of candidates) {
    if (d && existsSync(join(d, "repos"))) dirs.push(d);
  }
  // dedup
  return [...new Set(dirs)];
}

function defaultForkhubDirs(cwd: string, explicit?: string): string[] {
  if (explicit) return resolveForkhubDirs([explicit]);
  const candidates: string[] = [];
  // 1) sibling of cwd (standard: repo/../.forkhub)
  candidates.push(join(cwd, "..", ".forkhub"));
  // 2) global store at ~/dev/projects/.forkhub (used by t3code and others on this machine)
  candidates.push(join(homedir(), "dev/projects/.forkhub"));
  // 3) ~/.forkhub fallback
  candidates.push(join(homedir(), ".forkhub"));
  return resolveForkhubDirs(candidates);
}

export async function runList(options: ListOptions = {}): Promise<ListResult> {
  const cwd = process.cwd();
  const dirs = defaultForkhubDirs(cwd, options.forkhubDir);
  if (dirs.length === 0) {
    throw new Error("No .forkhub repo found. Run `fh init` inside a fork, or check ~/dev/projects/.forkhub");
  }

  // For `fh list` we aggregate across all dirs; for per-repo we could filter,
  // but user asked "list all intent-patch of this machine" so we show all.
  const allRepos: ListResult["repos"] = [];

  for (const forkhubDir of dirs) {
    const reposDir = join(forkhubDir, "repos");
    if (!existsSync(reposDir)) continue;
    for (const host of readdirSync(reposDir)) {
      const hostDir = join(reposDir, host);
      if (!existsSync(hostDir)) continue;
      let owners: string[] = [];
      try {
        owners = readdirSync(hostDir);
      } catch {
        continue;
      }
      for (const owner of owners) {
        const ownerDir = join(hostDir, owner);
        let repos: string[] = [];
        try {
          repos = readdirSync(ownerDir);
        } catch {
          continue;
        }
        for (const repo of repos) {
          const targetRepo = `${host}/${owner}/${repo}`;
          const manifestPath = join(ownerDir, repo, "manifest.json");
          if (!existsSync(manifestPath)) continue;
          try {
            const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
            const patches: PatchListEntry[] = [];
            for (const [patchId, info] of Object.entries<any>(manifest.patches || {})) {
              // read INTENT.md for title/pr if available
              let title: string = patchId;
              let prNumber: number | undefined;
              let prUrl: string | undefined;
              let issueUrl: string | undefined;
              const intentPath = join(ownerDir, repo, "patches", patchId, "INTENT.md");
              if (existsSync(intentPath)) {
                const content = readFileSync(intentPath, "utf-8");
                const titleMatch = content.match(/^title:\s*(.+)$/m);
                if (titleMatch?.[1]) title = titleMatch[1].trim();
                const prNumMatch = content.match(/applied_upstream_pr:\s*\n\s*number:\s*(\d+)/m);
                if (prNumMatch?.[1]) prNumber = parseInt(prNumMatch[1], 10);
                const prUrlMatch = content.match(/url:\s*(https:\/\/github\.com\/[^\/]+\/[^\/]+\/pull\/\d+)/m);
                if (prUrlMatch?.[1]) prUrl = prUrlMatch[1];
                const issueMatch = content.match(/issue:\s*(https:\/\/github\.com\/[^\/]+\/[^\/]+\/issues\/\d+)/m);
                if (issueMatch?.[1]) issueUrl = issueMatch[1];
              }
              // fallback to manifest's applied_upstream_pr
              if (!prNumber && info.applied_upstream_pr?.number) {
                prNumber = info.applied_upstream_pr.number;
                prUrl = info.applied_upstream_pr.url;
                issueUrl = info.applied_upstream_pr.issue;
              }
              patches.push({
                targetRepo,
                patchId,
                title,
                status: info.status ?? "unknown",
                lastRealized: info.last_realized_against_commit ?? "",
                branch: info.branch ?? "",
                prNumber,
                prUrl,
                issueUrl,
              });
            }
            // avoid duplicate targetRepo from multiple forkhubDirs
            if (!allRepos.some((r) => r.targetRepo === targetRepo)) {
              allRepos.push({ targetRepo, manifestPath, patches });
            } else {
              // merge patches if duplicate repo appears in multiple dirs
              const existing = allRepos.find((r) => r.targetRepo === targetRepo)!;
              for (const p of patches) {
                if (!existing.patches.some((e) => e.patchId === p.patchId)) existing.patches.push(p);
              }
            }
          } catch {
            // ignore malformed
          }
        }
      }
    }
  }

  const total = allRepos.reduce((acc, r) => acc + r.patches.length, 0);
  return { repos: allRepos, total };
}

export function formatListResult(result: ListResult): string {
  const lines: string[] = [];
  if (result.repos.length === 0) {
    return "No .forkhub patches found on this machine.\nRun `fh init` + `fh draft` inside a fork to create one.";
  }
  lines.push(`Found ${result.total} patch(es) across ${result.repos.length} repo(s) on this machine:\n`);
  for (const repo of result.repos) {
    lines.push(`${repo.targetRepo} — ${repo.patches.length} patch(es)`);
    lines.push(`  manifest: ${repo.manifestPath}`);
    if (repo.patches.length === 0) {
      lines.push(`  (no patches)`);
    } else {
      for (const p of repo.patches) {
        const prPart = p.prNumber ? ` PR #${p.prNumber}${p.prUrl ? ` (${p.prUrl})` : ""}` : "";
        const issuePart = p.issueUrl ? ` issue ${p.issueUrl}` : "";
        lines.push(`  • ${p.patchId}`);
        lines.push(`    title:  ${p.title}`);
        lines.push(`    status: ${p.status}  branch: ${p.branch}  realized: ${p.lastRealized}${prPart}${issuePart}`);
      }
    }
    lines.push("");
  }
  lines.push(`Use \`fh drift-check\` inside a repo, or \`fh pr-status [patch-id]\` to check upstream PR/issue,`);
  lines.push(`and \`fh cleanup [--apply]\` to auto-remove upstreamed patches and switch to official release.`);
  return lines.join("\n");
}
