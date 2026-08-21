import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export type PrStatusOptions = {
  forkhubDir?: string;
  patchId?: string;
  targetRepo?: string;
};

export type PrStatusEntry = {
  targetRepo: string;
  patchId: string;
  prNumber?: number;
  prUrl?: string;
  issueNumber?: number;
  issueUrl?: string;
  prState?: "open" | "merged" | "closed" | "not_found" | "unknown";
  issueState?: "open" | "closed" | "not_found" | "unknown";
  mergeCommit?: string;
  error?: string;
};

async function ghJson(args: string[]): Promise<any | null> {
  const proc = Bun.spawn(["gh", ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const exit = await proc.exited;
  if (exit !== 0) return null;
  try {
    return JSON.parse(stdout.trim());
  } catch {
    return null;
  }
}

async function checkPr(targetRepo: string, prNumber: number): Promise<{ state: "open" | "merged" | "closed"; mergeCommit?: string } | null> {
  const data = await ghJson(["pr", "view", String(prNumber), "--repo", targetRepo, "--json", "state,mergeCommit,url"]);
  if (!data) return null;
  const raw = data.state?.toUpperCase();
  if (raw === "MERGED") return { state: "merged", mergeCommit: data.mergeCommit?.oid };
  if (raw === "CLOSED") return { state: "closed" };
  return { state: "open" };
}

async function checkIssue(targetRepo: string, issueNumber: number): Promise<{ state: "open" | "closed" } | null> {
  const data = await ghJson(["issue", "view", String(issueNumber), "--repo", targetRepo, "--json", "state,url"]);
  if (!data) return null;
  const s = data.state?.toLowerCase();
  if (s === "open" || s === "closed") return { state: s };
  return null;
}

function findPatch(forkhubDir: string, patchId: string): { targetRepo: string; manifest: any; patchInfo: any; intentPath: string } | null {
  const reposDir = join(forkhubDir, "repos");
  if (!existsSync(reposDir)) return null;
  for (const host of readdirSync(reposDir)) {
    for (const owner of readdirSync(join(reposDir, host))) {
      for (const repo of readdirSync(join(reposDir, host, owner))) {
        const targetRepo = `${host}/${owner}/${repo}`;
        const manifestPath = join(reposDir, targetRepo, "manifest.json");
        if (!existsSync(manifestPath)) continue;
        const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
        if (manifest.patches?.[patchId]) {
          return { targetRepo, manifest, patchInfo: manifest.patches[patchId], intentPath: join(reposDir, targetRepo, "patches", patchId, "INTENT.md") };
        }
      }
    }
  }
  return null;
}

function parseIntentPr(intentPath: string): { prNumber?: number; prUrl?: string; issueNumber?: number; issueUrl?: string } {
  if (!existsSync(intentPath)) return {};
  const c = readFileSync(intentPath, "utf-8");
  let prNumber: number | undefined;
  let prUrl: string | undefined;
  let issueNumber: number | undefined;
  let issueUrl: string | undefined;
  const prNumMatch = c.match(/applied_upstream_pr:\s*\n\s*number:\s*(\d+)/m);
  if (prNumMatch?.[1]) prNumber = parseInt(prNumMatch[1], 10);
  const prUrlMatch = c.match(/url:\s*(https:\/\/github\.com\/[^\/]+\/[^\/]+\/pull\/(\d+))/m);
  if (prUrlMatch?.[1]) {
    prUrl = prUrlMatch[1];
    if (!prNumber) prNumber = parseInt(prUrlMatch[2], 10);
  }
  const issueMatch = c.match(/issue:\s*(https:\/\/github\.com\/[^\/]+\/[^\/]+\/issues\/(\d+))/m);
  if (issueMatch?.[1]) {
    issueUrl = issueMatch[1];
    issueNumber = parseInt(issueMatch[2], 10);
  }
  // also check issue_number: 7754
  const issueNumMatch = c.match(/issue_number:\s*(\d+)/m);
  if (issueNumMatch?.[1] && !issueNumber) {
    issueNumber = parseInt(issueNumMatch[1], 10);
    if (!issueUrl) {
      // derive issueUrl from targetRepo if possible
      const repoMatch = c.match(/target_repo:\s*([^\s]+)/m);
      if (repoMatch?.[1]) issueUrl = `https://github.com/${repoMatch[1]}/issues/${issueNumber}`;
    }
  }
  return { prNumber, prUrl, issueNumber, issueUrl };
}

function resolveForkhubDir(explicit?: string): string {
  if (explicit && existsSync(explicit)) return explicit;
  const candidates = [
    join(process.cwd(), "..", ".forkhub"),
    join(homedir(), "dev/projects/.forkhub"),
    join(homedir(), ".forkhub"),
  ];
  for (const c of candidates) if (existsSync(join(c, "repos"))) return c;
  return candidates[0]!;
}

export async function runPrStatus(options: PrStatusOptions = {}): Promise<PrStatusEntry[]> {
  const forkhubDir = resolveForkhubDir(options.forkhubDir);
  if (!existsSync(forkhubDir)) throw new Error("No .forkhub repo found");

  let targets: { targetRepo: string; patchId: string; prNumber?: number; issueNumber?: number; prUrl?: string; issueUrl?: string }[] = [];

  if (options.patchId) {
    const found = findPatch(forkhubDir, options.patchId);
    if (!found) throw new Error(`Patch ${options.patchId} not found in ${forkhubDir}`);
    const parsed = parseIntentPr(found.intentPath);
    // also check manifest's applied_upstream_pr
    const mPr = found.patchInfo.applied_upstream_pr;
    const prNumber = parsed.prNumber ?? mPr?.number;
    const prUrl = parsed.prUrl ?? mPr?.url;
    const issueNumber = parsed.issueNumber ?? mPr?.issue_number;
    const issueUrl = parsed.issueUrl ?? mPr?.issue;
    targets.push({ targetRepo: found.targetRepo, patchId: options.patchId, prNumber, prUrl, issueNumber, issueUrl });
  } else {
    // all patches
    const reposDir = join(forkhubDir, "repos");
    for (const host of readdirSync(reposDir)) {
      for (const owner of readdirSync(join(reposDir, host))) {
        for (const repo of readdirSync(join(reposDir, host, owner))) {
          const targetRepo = `${host}/${owner}/${repo}`;
          const manifestPath = join(reposDir, targetRepo, "manifest.json");
          if (!existsSync(manifestPath)) continue;
          const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
          for (const [patchId, info] of Object.entries<any>(manifest.patches || {})) {
            const intentPath = join(reposDir, targetRepo, "patches", patchId, "INTENT.md");
            const parsed = parseIntentPr(intentPath);
            const prNumber = parsed.prNumber ?? (info as any).applied_upstream_pr?.number;
            const prUrl = parsed.prUrl ?? (info as any).applied_upstream_pr?.url;
            const issueNumber = parsed.issueNumber ?? (info as any).applied_upstream_pr?.issue_number;
            const issueUrl = parsed.issueUrl ?? (info as any).applied_upstream_pr?.issue;
            if (options.targetRepo && targetRepo !== options.targetRepo) continue;
            targets.push({ targetRepo, patchId, prNumber, prUrl, issueNumber, issueUrl });
          }
        }
      }
    }
  }

  if (targets.length === 0) throw new Error("No patches with upstream PR/issue tracked. Add `applied_upstream_pr` to INTENT.md/manifest.json");

  const results: PrStatusEntry[] = [];
  for (const t of targets) {
    const entry: PrStatusEntry = { targetRepo: t.targetRepo, patchId: t.patchId, prNumber: t.prNumber, prUrl: t.prUrl, issueNumber: t.issueNumber, issueUrl: t.issueUrl };
    if (t.prNumber) {
      const pr = await checkPr(t.targetRepo, t.prNumber);
      if (!pr) {
        entry.prState = "not_found";
        entry.error = `gh pr view ${t.prNumber} failed (no gh auth or not found)`;
      } else {
        entry.prState = pr.state;
        entry.mergeCommit = pr.mergeCommit;
      }
    } else {
      entry.prState = "unknown";
    }
    if (t.issueNumber) {
      const iss = await checkIssue(t.targetRepo, t.issueNumber);
      if (!iss) entry.issueState = "not_found";
      else entry.issueState = iss.state;
    }
    results.push(entry);
  }
  return results;
}

export function formatPrStatus(results: PrStatusEntry[]): string {
  const lines: string[] = [];
  for (const r of results) {
    lines.push(`• ${r.targetRepo} :: ${r.patchId}`);
    if (r.prNumber) {
      const state = r.prState ?? "unknown";
      const icon = state === "merged" ? "✓ merged" : state === "open" ? "⏳ open" : state === "closed" ? "✗ closed" : "?";
      lines.push(`  PR:       #${r.prNumber} ${r.prUrl ?? ""} → ${icon}${r.mergeCommit ? ` (${r.mergeCommit.slice(0, 7)})` : ""}`);
      if (r.error) lines.push(`  PR error: ${r.error}`);
    } else {
      lines.push(`  PR:       (not tracked) add applied_upstream_pr.number to INTENT.md`);
    }
    if (r.issueNumber) {
      const istate = r.issueState ?? "unknown";
      const iicon = istate === "closed" ? "✓ closed" : istate === "open" ? "⏳ open" : "?";
      lines.push(`  Issue:    #${r.issueNumber} ${r.issueUrl ?? ""} → ${iicon} (${istate})`);
    }
    if (r.prState === "merged") {
      lines.push(`  Action:   PR merged → safe to \`fh cleanup --apply\` to drop self-patched build and use official release`);
      lines.push(`            (fh will checkout upstream/main and remove patch from manifest)`);
    } else if (r.prState === "open") {
      lines.push(`  Action:   PR still open → keep self-patched build (forkhub/main ${r.patchId}) and wrapper ~/.local/bin/opencode-clean if on desktop 0.0.33`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
