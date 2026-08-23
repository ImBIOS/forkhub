import { existsSync, readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { gitExec, gitOrThrow, isGitRepo, currentBranch } from "./git";
import { runDriftCheck } from "./drift-check";
import { bold, green, yellow, red, cyan, gray, ok, warn, statusBadge, cmd, meta } from "./style";

export type CleanupOptions = {
  forkhubDir?: string;
  apply?: boolean;
  dryRun?: boolean;
  targetRepo?: string;
};

export type CleanupResult = {
  forkhubDir: string;
  targetRepo: string;
  patchId: string;
  status: string;
  prNumber?: number;
  prState?: string;
  action: "would_remove" | "removed" | "skipped" | "no_op";
  details: string[];
};

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

async function ghPrState(targetRepo: string, prNumber: number): Promise<{ state: "open" | "merged" | "closed"; mergeCommit?: string } | null> {
  const proc = Bun.spawn(["gh", "pr", "view", String(prNumber), "--repo", targetRepo, "--json", "state,mergeCommit"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const exit = await proc.exited;
  if (exit !== 0) return null;
  try {
    const data = JSON.parse(stdout.trim());
    const raw = data.state?.toUpperCase();
    if (raw === "MERGED") return { state: "merged", mergeCommit: data.mergeCommit?.oid };
    if (raw === "CLOSED") return { state: "closed" };
    return { state: "open" };
  } catch {
    return null;
  }
}

export async function runCleanup(options: CleanupOptions = {}): Promise<CleanupResult[]> {
  const forkhubDir = resolveForkhubDir(options.forkhubDir);
  if (!existsSync(forkhubDir)) throw new Error("No .forkhub repo found");

  // If we're inside a fork checkout, do per-repo drift-check for accuracy
  // else do global scan.
  const isRepo = await isGitRepo();
  const results: CleanupResult[] = [];

  if (isRepo) {
    // per-repo path: use drift-check which already knows upstreamed status
    let drift;
    try {
      drift = await runDriftCheck({ forkhubDir });
    } catch (e) {
      // fall back to global scan if drift-check fails (e.g. not a forkhub repo)
      drift = null;
    }
    if (drift) {
      for (const p of drift.patches) {
        const targetRepo = drift.patches.length ? (await (async () => {
          // find targetRepo from manifest
          const manifestPath = join(forkhubDir, "repos", ((): string => {
            // derive from first patch's info? simpler: scan manifest for this patch
            const reposDir = join(forkhubDir, "repos");
            for (const host of readdirSync(reposDir)) {
              for (const owner of readdirSync(join(reposDir, host))) {
                for (const repo of readdirSync(join(reposDir, host, owner))) {
                  const tr = `${host}/${owner}/${repo}`;
                  const mp = join(reposDir, tr, "manifest.json");
                  if (!existsSync(mp)) continue;
                  const m = JSON.parse(readFileSync(mp, "utf-8"));
                  if (m.patches?.[p.patchId]) return tr;
                }
              }
            }
            return "unknown";
          })(), "manifest.json");
          return "";
        })()) : "unknown";
        // For per-repo, we need targetRepo; derive from drift's upstream? Instead read manifest search
        let actualTargetRepo = "unknown";
        for (const host of readdirSync(join(forkhubDir, "repos"))) {
          for (const owner of readdirSync(join(forkhubDir, "repos", host))) {
            for (const repo of readdirSync(join(forkhubDir, "repos", host, owner))) {
              const tr = `${host}/${owner}/${repo}`;
              const mp = join(forkhubDir, "repos", tr, "manifest.json");
              if (!existsSync(mp)) continue;
              const m = JSON.parse(readFileSync(mp, "utf-8"));
              if (m.patches?.[p.patchId]) { actualTargetRepo = tr; break; }
            }
          }
        }

        const prNumber = p.appliedUpstreamPr?.number;
        const prState = p.appliedUpstreamPr?.state;
        const isUpstreamed = p.status === "upstreamed" || prState === "merged";

        if (!isUpstreamed) {
          results.push({
            forkhubDir,
            targetRepo: actualTargetRepo,
            patchId: p.patchId,
            status: p.status,
            prNumber,
            prState: prState ?? p.status,
            action: "skipped",
            details: [`status: ${p.status}${prState ? `, PR #${prNumber} ${prState}` : ""} — keep self-patched build`],
          });
          continue;
        }

        // upstreamed → would remove
        const details: string[] = [];
        details.push(`PR #${prNumber} merged (${p.appliedUpstreamPr?.mergeCommit?.slice(0, 7) ?? ""}) → patch upstreamed`);
        details.push(`manifest: ${join(forkhubDir, "repos", actualTargetRepo, "manifest.json")}`);

        if (options.apply && !options.dryRun) {
          // Remove from manifest
          const manifestPath = join(forkhubDir, "repos", actualTargetRepo, "manifest.json");
          if (existsSync(manifestPath)) {
            const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
            delete manifest.patches[p.patchId];
            manifest.apply_order = (manifest.apply_order || []).filter((id: string) => id !== p.patchId);
            writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
            details.push(`removed ${p.patchId} from manifest`);
          }
          // Optionally remove patch dir
          const patchDir = join(forkhubDir, "repos", actualTargetRepo, "patches", p.patchId);
          if (existsSync(patchDir)) {
            rmSync(patchDir, { recursive: true, force: true });
            details.push(`deleted patch dir ${patchDir}`);
          }

          // If current checkout is on forkhub/main or draft branch containing this patch, switch to official
          try {
            const branch = await currentBranch();
            const upstreamBranch = "upstream/main";
            // check if upstream/main exists
            const upstreamExists = (await gitExec(["rev-parse", "--verify", upstreamBranch])).exitCode === 0;
            if (upstreamExists && (branch === "forkhub/main" || branch === p.patchId || branch.startsWith("fix-t3code"))) {
              await gitExec(["checkout", "main"]);
              await gitOrThrow(["reset", "--hard", upstreamBranch]);
              details.push(`checked out main → ${upstreamBranch} (official release)`);
              // remove wrapper if this is the t3code OSC patch
              if (actualTargetRepo === "github.com/pingdotgg/t3code" && p.patchId.includes("strip-osc")) {
                const wrapper = join(homedir(), ".local/bin/opencode-clean");
                if (existsSync(wrapper)) {
                  rmSync(wrapper, { force: true });
                  details.push(`removed wrapper ${wrapper}`);
                }
                const settings = join(homedir(), ".t3/userdata/settings.json");
                if (existsSync(settings)) {
                  try {
                    const j = JSON.parse(readFileSync(settings, "utf-8"));
                    if (j.providerInstances?.opencode?.config?.binaryPath?.includes("opencode-clean")) {
                      delete j.providerInstances.opencode.config.binaryPath;
                      writeFileSync(settings, JSON.stringify(j, null, 2) + "\n");
                      details.push(`reverted settings.json binaryPath`);
                    }
                  } catch {}
                }
                // remove zshrc reminder
                const zshrc = join(homedir(), ".zshrc");
                if (existsSync(zshrc)) {
                  const content = readFileSync(zshrc, "utf-8");
                  if (content.includes("opencode OSC fix reminder")) {
                    const cleaned = content
                      .replace(/\n# opencode OSC leak workaround reminder[^\n]*\n(?:.*\n)*?  fi\n/, "\n");
                    // safer: just note, don't auto-edit zshrc destructively; add instruction instead
                    details.push(`manual: remove opencode OSC reminder block from ~/.zshrc (daily-updates)`);
                  }
                }
              }
              // delete the forkhub tag? keep but note
              details.push(`self-patched tag ${p.patchId} superseded by official; run \`fh status\` to confirm on upstream`);
            }
          } catch (e) {
            details.push(`branch switch failed: ${e instanceof Error ? e.message : String(e)}`);
          }

          results.push({
            forkhubDir,
            targetRepo: actualTargetRepo,
            patchId: p.patchId,
            status: p.status,
            prNumber,
            prState,
            action: "removed",
            details,
          });
        } else {
          details.push(`dry-run: would remove patch and switch to official (\`fh cleanup --apply\` to execute)`);
          results.push({
            forkhubDir,
            targetRepo: actualTargetRepo,
            patchId: p.patchId,
            status: p.status,
            prNumber,
            prState,
            action: "would_remove",
            details,
          });
        }
      }
      return results;
    }
  }

  // Global fallback: scan all repos
  const reposDir = join(forkhubDir, "repos");
  if (!existsSync(reposDir)) return results;
  for (const host of readdirSync(reposDir)) {
    for (const owner of readdirSync(join(reposDir, host))) {
      for (const repo of readdirSync(join(reposDir, host, owner))) {
        const targetRepo = `${host}/${owner}/${repo}`;
        if (options.targetRepo && targetRepo !== options.targetRepo) continue;
        const manifestPath = join(reposDir, targetRepo, "manifest.json");
        if (!existsSync(manifestPath)) continue;
        const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
        for (const [patchId, info] of Object.entries<any>(manifest.patches || {})) {
          const prNumber = (info as any).applied_upstream_pr?.number;
          let prState: string | undefined;
          let status = (info as any).status ?? "unknown";
          if (prNumber) {
            const pr = await ghPrState(targetRepo, prNumber);
            if (pr) {
              prState = pr.state;
              if (pr.state === "merged") status = "upstreamed";
            }
          }
          const isUpstreamed = status === "upstreamed" || prState === "merged";
          if (!isUpstreamed) {
            results.push({
              forkhubDir,
              targetRepo,
              patchId,
              status,
              prNumber,
              prState,
              action: "skipped",
              details: [`status: ${status}${prState ? `, PR #${prNumber} ${prState}` : ""}`],
            });
            continue;
          }
          const details = [`PR #${prNumber} ${prState} → upstreamed`];
          if (options.apply && !options.dryRun) {
            delete manifest.patches[patchId];
            manifest.apply_order = (manifest.apply_order || []).filter((id: string) => id !== patchId);
            writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
            const patchDir = join(reposDir, targetRepo, "patches", patchId);
            if (existsSync(patchDir)) rmSync(patchDir, { recursive: true, force: true });
            details.push(`removed from manifest and deleted dir`);
            results.push({ forkhubDir, targetRepo, patchId, status, prNumber, prState, action: "removed", details });
          } else {
            details.push(`would remove (use --apply)`);
            results.push({ forkhubDir, targetRepo, patchId, status, prNumber, prState, action: "would_remove", details });
          }
        }
      }
    }
  }
  return results;
}

export function formatCleanup(results: CleanupResult[], opts: CleanupOptions = {}): string {
  const lines: string[] = [];
  if (results.length === 0) {
    return "No patches found. Nothing to clean.";
  }
  const toRemove = results.filter((r) => r.action === "would_remove" || r.action === "removed");
  const skipped = results.filter((r) => r.action === "skipped");
  lines.push(
    `Checked ${bold(String(results.length))} patch(es): ` +
      `${toRemove.length > 0 ? red(String(toRemove.length)) : green("0")} upstreamed, ` +
      `${skipped.length} still needed\n`,
  );
  for (const r of results) {
    const icon =
      r.action === "removed" ? `${ok()} ${green("removed")}`
      : r.action === "would_remove" ? `${warn()} ${yellow("would remove")}`
      : r.action === "skipped" ? `${gray("—")} keep`
      : gray("?");
    lines.push(`${icon}  ${cyan(r.targetRepo)} ${gray("::")} ${bold(r.patchId)} ${statusBadge(r.status)}${r.prState ? ` PR #${bold(String(r.prNumber))} ${r.prState}` : ""}`);
    for (const d of r.details) lines.push(`    ${meta(d)}`);
    lines.push("");
  }
  if (toRemove.length > 0 && !opts.apply) {
    {
      const first = toRemove[0]!;
      lines.push(`Run ${cmd("`fh cleanup --apply`")} inside the repo (or ${cmd(`\`fh cleanup --apply --target ${first.targetRepo}\``)}) to auto-remove and switch to official release.`);
    }
    lines.push(meta("This will: remove patch from manifest, delete patch dir, checkout main → upstream/main, and clean wrapper ~/.local/bin/opencode-clean if present."));
  } else if (toRemove.length > 0 && opts.apply) {
    lines.push(`${ok()} ${green("Cleanup applied.")} Verify with ${cmd("`fh status`")} and ${cmd("`fh drift-check`")}, and ${cmd("`fh list`")} should no longer show the upstreamed patch.`);
  } else {
    lines.push(`${ok()} All patches still needed. No action.`);
  }
  return lines.join("\n");
}
