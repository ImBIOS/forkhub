#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { join } from "node:path";
import { runUpdate, type UpdateOptions } from "./update";
import { runRollback } from "./rollback";
import { runInit } from "./init";
import { runDraft } from "./draft";
import { runSatisfied } from "./satisfied";
import { runDriftCheck, formatDriftCheckResult } from "./drift-check";
import { runImport } from "./import";
import { runReDerive } from "./re-derive";
import { runApply } from "./apply";
import { runWatch } from "./watch";
import { runSearch, formatSearchResults } from "./search";
import { runPr } from "./pr";
import { runPublish } from "./publish";
import { runAdvance, type AdvanceResult } from "./advance";
import { runReconcile } from "./reconcile";
import { runPush } from "./push";
import { resolveTagPattern } from "./tags";

const HELP = `fh (forkhub) — keep up-to-date upstream + your custom patches

Usage:
  fh init [--target <repo>]              Set up .forkhub repo
  fh draft "<intent>"                    Create a draft branch for a new patch
  fh satisfied [--skip-port]             Finalize intent, port to forkhub/main
  fh advance [--to <ref>] [--verify]     Fast-forward: cherry-pick patch commits onto new
                                         upstream base without AI; escalates to bundles on conflict
  fh pr [--draft] [--base <branch>]      Push current branch + open PR to upstream
  fh publish [--message <msg>] [--allow-missing-pr]  Push .forkhub repo (requires open issue+PR by default)
  fh push [--remote <name>] [--with-metadata]  Push forkhub/main + tags to your remote
  fh import <url> [--force]              Import a patch from another user's .forkhub
  fh search [query] [--target <repo>]    Search GitHub for patches
  fh re-derive <patch-id> [--force]      Generate re-derivation context bundle
  fh apply <bundle-path>                 Apply realization from context bundle
  fh drift-check [--json]                Check if patches need re-derivation
  fh watch [--once] [--interval <sec>] [--agent <name>]
                                         Daemon: auto-detect drift + generate bundles
  fh update [--tag <tag>] [--dry-run]    Update to latest (or specified) tag
  fh rollback                            Roll back to the previous tag
  fh reconcile [--tag <tag>] [--dry-run] Sync manifest state from the consumed tag's history
  fh status                              Show current state
  fh --help                              Show this help

Producer commands run from inside your fork's checkout.
Consumer commands (update, rollback, status) also run from the fork checkout.
The \`pr\` command requires a fork setup (separate \`upstream\` and \`origin\` remotes).

Channel/track pinning: set \`tag_pattern\` in manifest.json (e.g. "v*-nightly*")
so update/rollback/satisfied only see tags on your track.
Drift baseline: set \`drift_against: "tag"\` to measure against the latest
upstream release instead of the branch tip.
`;

function parseArgs(argv: string[]): {
  command?: string;
  opts: Record<string, string | boolean>;
  positional: string[];
} {
  const [command, ...rest] = argv;
  const opts: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (
      arg &&
      (arg.startsWith("--") || (arg.startsWith("-") && arg.length > 1 && !/^-?\d/.test(arg)))
    ) {
      const key = arg.slice(arg.startsWith("--") ? 2 : 1);
      const next = rest[i + 1];
      if (next && !next.startsWith("-")) {
        opts[key] = next;
        i++;
      } else {
        opts[key] = true;
      }
    } else if (arg) {
      positional.push(arg);
    }
  }
  return { command, opts, positional };
}

async function runStatus(tagPattern?: string) {
  const { isGitRepo, currentSha, currentTag, listTags } = await import("./git");
  if (!(await isGitRepo())) {
    console.error("Not a git repository.");
    process.exit(1);
  }
  const sha = await currentSha();
  const tag = await currentTag();
  const tags = await listTags(tagPattern ?? "v*-fh*");

  console.log(`Current:  ${tag ?? "(detached)"} ${sha.slice(0, 7)}`);
  const latest = tags[0];
  if (latest) {
    console.log(`Latest:   ${latest.name} ${latest.sha.slice(0, 7)}`);
    if (latest.sha !== sha) {
      console.log(`\nRun \`fh update\` to advance.`);
    } else {
      console.log(`\nAlready at latest.`);
    }
  } else {
    console.log(`\nNo forkhub tags found.`);
  }
}

function printAdvanceResult(result: AdvanceResult, dryRun: boolean) {
  const prefix = dryRun ? "[dry-run] " : "";
  switch (result.status) {
    case "up-to-date": {
      console.log(
        `${prefix}forkhub/main (${result.fromSha.slice(0, 7)}) already contains ${result.toSha.slice(0, 7)}. Nothing to advance.`,
      );
      for (const w of result.warnings) console.error(`⚠ ${w}`);
      return;
    }
    case "conflict": {
      console.log(
        `${prefix}Cherry-pick replay conflicted at ${result.failedCommit?.sha.slice(0, 7)}: ${result.failedCommit?.subject}`,
      );
      if (result.conflictFiles.length > 0) {
        console.log(`Conflicting files:`);
        for (const f of result.conflictFiles.slice(0, 10)) console.log(`  - ${f}`);
        if (result.conflictFiles.length > 10)
          console.log(`  … +${result.conflictFiles.length - 10} more`);
      }
      console.log(
        `\nReplayed cleanly before the conflict: ${result.commitsReplayed.length} commit(s).`,
      );
      for (const b of result.bundlesGenerated) {
        console.log(`Bundle generated for ${b.patchId}:`);
        console.log(`  ${b.bundlePath}`);
      }
      if (result.bundlesGenerated.length > 0) {
        console.log(
          `\nNext: have an AI agent fill REALIZATION/realization.diff, then \`fh apply <bundle>\`.`,
        );
      } else {
        console.log(
          `\nNo bundles generated. Identify the owning patch and run \`fh re-derive <patch-id>\`.`,
        );
      }
      break;
    }
    case "verify-failed": {
      console.error(`${prefix}Advance aborted: verification failed.`);
      break;
    }
    case "advanced": {
      console.log(
        `${prefix}Advanced forkhub/main ${result.fromSha.slice(0, 7)} → ${result.toSha.slice(0, 7)} ` +
          `(replayed ${result.commitsReplayed.length} commit(s)).`,
      );
      if (result.tag && !dryRun)
        console.log(`Tag: ${result.tag} (local only — share with \`fh push\`)`);
      if (dryRun) {
        console.log(`Would replay onto ${result.toSha.slice(0, 7)} and tag as ${result.tag}.`);
      }
      if (result.patchesUpdated.length > 0) {
        console.log(`Manifest synced for: ${result.patchesUpdated.join(", ")}`);
      }
      break;
    }
  }
  for (const w of result.warnings) console.error(`⚠ ${w}`);
}

async function main() {
  const { command, opts, positional } = parseArgs(process.argv.slice(2));

  if (!command || command === "--help" || command === "-h") {
    console.log(HELP);
    return;
  }

  // Channel/track pattern: explicit flag wins, else manifest(s) under ../.forkhub.
  const forkhubDir = join(process.cwd(), "..", ".forkhub");
  const tagPattern =
    typeof opts["tag-pattern"] === "string"
      ? opts["tag-pattern"]
      : await resolveTagPattern(existsSync(forkhubDir) ? forkhubDir : undefined);

  try {
    switch (command) {
      case "init": {
        const initOpts: {
          upstreamRemote?: string;
          forkRemote?: string;
          target?: string;
          tagPattern?: string;
        } = {};
        if (typeof opts["upstream-remote"] === "string")
          initOpts.upstreamRemote = opts["upstream-remote"];
        if (typeof opts["fork-remote"] === "string") initOpts.forkRemote = opts["fork-remote"];
        if (typeof opts.target === "string") initOpts.target = opts.target;
        if (typeof opts["tag-pattern"] === "string") initOpts.tagPattern = opts["tag-pattern"];

        const result = await runInit(initOpts);
        console.log(`Target repo:     ${result.targetRepo}`);
        console.log(`Upstream remote: ${result.upstreamRemote} (${result.upstreamUrl})`);
        if (result.isFork && result.forkRemote) {
          console.log(`Fork remote:     ${result.forkRemote} (${result.forkUrl})`);
          console.log(
            `Setup:           FORK — track drift on upstream, push PRs from ${result.forkRemote}`,
          );
        } else {
          console.log(`Setup:           SINGLE-REMOTE — no fork detected`);
        }
        console.log(`.forkhub:    ${result.forkhubDir}`);
        console.log(
          result.created ? "Created new .forkhub repo." : "Existing .forkhub repo configured.",
        );
        break;
      }

      case "draft": {
        const intent = positional.join(" ");
        if (!intent) {
          throw new Error('Intent description required. Usage: fh draft "<intent>"');
        }
        const result = await runDraft(intent);
        console.log(`Branch:    ${result.branch}`);
        console.log(`Slug:      ${result.slug}`);
        console.log(`Base:      ${result.baseSha.slice(0, 7)}`);
        console.log(`Draft:     ${result.draftFile}`);
        console.log(`\nImplement your patch on branch '${result.branch}'.`);
        console.log(`When done, run: fh satisfied`);
        break;
      }

      case "satisfied": {
        const satisfiedOpts: { skipPort?: boolean; targetRepo?: string; forkhubDir?: string } = {};
        if (opts["skip-port"] === true) satisfiedOpts.skipPort = true;
        if (typeof opts.target === "string") satisfiedOpts.targetRepo = opts.target;
        if (typeof opts["forkhub-dir"] === "string") satisfiedOpts.forkhubDir = opts["forkhub-dir"];

        const result = await runSatisfied(satisfiedOpts);
        console.log(`Patch ID:       ${result.patchId}`);
        console.log(`Branch:         ${result.branch}`);
        console.log(`Files changed:  ${result.filesChanged.join(", ") || "(none)"}`);
        if (result.forkhubMainUpdated) {
          console.log(`Ported to:      forkhub/main`);
          if (result.tag)
            console.log(`Tag:            ${result.tag} (local only — share with \`fh push\`)`);
        } else {
          console.log(`Port:           skipped`);
        }
        console.log(`\nIntent saved to .forkhub.`);
        break;
      }

      case "advance": {
        const advanceOpts: Parameters<typeof runAdvance>[0] = {};
        if (typeof opts.to === "string") advanceOpts.to = opts.to;
        if (opts["dry-run"] === true) advanceOpts.dryRun = true;
        if (opts.verify === true) advanceOpts.verify = true;
        if (typeof opts.target === "string") advanceOpts.targetRepo = opts.target;
        if (typeof opts["forkhub-dir"] === "string") advanceOpts.forkhubDir = opts["forkhub-dir"];

        const result = await runAdvance(advanceOpts);
        printAdvanceResult(result, opts["dry-run"] === true);
        break;
      }

      case "update": {
        const updateOpts: UpdateOptions = {};
        if (typeof opts.tag === "string") updateOpts.tag = opts.tag;
        if (opts["dry-run"] === true) updateOpts.dryRun = true;
        if (opts["skip-install"] === true) updateOpts.skipInstall = true;
        if (typeof tagPattern === "string") updateOpts.tagPattern = tagPattern;

        const result = await runUpdate(updateOpts);

        if (result.skipped) {
          console.log(`Already at ${result.to} (${result.from.slice(0, 7)}). Nothing to do.`);
          return;
        }

        if (opts["dry-run"]) {
          console.log(
            `[dry-run] Would update ${result.from.slice(0, 7)} → ${result.to} (${result.toSha.slice(0, 7)})`,
          );
          return;
        }

        console.log(
          `Updated ${result.from.slice(0, 7)} → ${result.to} (${result.toSha.slice(0, 7)})`,
        );
        if (existsSync(forkhubDir)) {
          console.log(
            `\nIf this tag was created outside forkhub (or by hand), run \`fh reconcile\` to sync manifest state.`,
          );
        }
        if (result.stashed) {
          if (result.stashRestored) {
            console.log(`Local changes restored from stash.`);
          } else {
            console.warn(
              `Local changes could not be restored (conflicts). See \`git stash list\`.`,
            );
          }
        }
        break;
      }

      case "rollback": {
        const rollbackOpts: UpdateOptions = {};
        if (opts["dry-run"] === true) rollbackOpts.dryRun = true;
        if (opts["skip-install"] === true) rollbackOpts.skipInstall = true;
        if (typeof tagPattern === "string") rollbackOpts.tagPattern = tagPattern;

        const result = await runRollback(rollbackOpts);
        if (result.skipped) {
          console.log(`Already at ${result.to}. Nothing to do.`);
        } else {
          console.log(`Rolled back ${result.from} → ${result.to} (${result.toSha.slice(0, 7)})`);
        }
        break;
      }

      case "status": {
        await runStatus(tagPattern);
        break;
      }

      case "drift-check": {
        const driftOpts: { forkhubDir?: string; targetRepo?: string } = {};
        if (typeof opts.target === "string") driftOpts.targetRepo = opts.target;
        if (typeof opts["forkhub-dir"] === "string") driftOpts.forkhubDir = opts["forkhub-dir"];
        const result = await runDriftCheck(driftOpts);
        for (const warning of result.warnings) {
          console.error(`⚠ ${warning}`);
        }
        if (opts.json === true) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(formatDriftCheckResult(result));
        }
        break;
      }

      case "search": {
        const searchOpts: { targetRepo?: string; author?: string; query?: string; limit?: number } =
          {};
        if (typeof opts.target === "string") searchOpts.targetRepo = opts.target;
        if (typeof opts.author === "string") searchOpts.author = opts.author;
        if (typeof opts.limit === "string") searchOpts.limit = parseInt(opts.limit, 10);
        if (positional.length > 0) searchOpts.query = positional.join(" ");

        const results = await runSearch(searchOpts);
        console.log(formatSearchResults(results));
        break;
      }

      case "watch": {
        const watchOpts: { once?: boolean; interval?: number; agent?: string } = {};
        if (opts.once === true) watchOpts.once = true;
        if (typeof opts.interval === "string") watchOpts.interval = parseInt(opts.interval, 10);
        if (typeof opts.agent === "string") watchOpts.agent = opts.agent;
        await runWatch(watchOpts);
        break;
      }

      case "import": {
        const source = positional.join(" ");
        if (!source) {
          throw new Error("Source URL required. Usage: fh import <github-url>");
        }
        const importOpts: { force?: boolean } = {};
        if (opts.force === true) importOpts.force = true;

        const result = await runImport(source, importOpts);
        console.log(`Patch ID:     ${result.patchId}`);
        console.log(`Target repo:  ${result.targetRepo}`);
        console.log(`Author:       ${result.author}`);
        console.log(`Files:        ${result.filesImported.join(", ")}`);
        console.log(`\nPatch imported. Run \`fh drift-check\` to see if re-derivation is needed.`);
        break;
      }

      case "re-derive": {
        const patchId = positional[0];
        if (!patchId) {
          throw new Error("Patch ID required. Usage: fh re-derive <patch-id>");
        }
        const reDeriveOpts: { force?: boolean; targetRepo?: string; forkhubDir?: string } = {};
        if (opts.force === true) reDeriveOpts.force = true;
        if (typeof opts.target === "string") reDeriveOpts.targetRepo = opts.target;
        if (typeof opts["forkhub-dir"] === "string") reDeriveOpts.forkhubDir = opts["forkhub-dir"];

        const result = await runReDerive(patchId, reDeriveOpts);
        if (result.status === "current" && !opts.force) {
          console.log(`Patch ${result.patchId} is already current. No re-derivation needed.`);
          console.log(`Use --force to re-derive anyway.`);
          break;
        }
        console.log(`Patch ID:    ${result.patchId}`);
        console.log(`Bundle:      ${result.bundlePath}`);
        console.log(`Status:      ${result.status}`);
        console.log(`\nBundle contents (${result.filesInBundle.length} files):`);
        for (const f of result.filesInBundle) {
          console.log(`  - ${f}`);
        }
        console.log(`\nNext steps:`);
        console.log(
          `  1. Have an AI agent re-derive the patch and save to REALIZATION/realization.diff`,
        );
        console.log(`  2. Run: fh apply ${result.bundlePath}`);
        break;
      }

      case "apply": {
        const bundlePath = positional[0];
        if (!bundlePath) {
          throw new Error("Bundle path required. Usage: fh apply <bundle-path>");
        }
        const applyOpts: { skipTests?: boolean; skipTag?: boolean } = {};
        if (opts["skip-tests"] === true) applyOpts.skipTests = true;
        if (opts["skip-tag"] === true) applyOpts.skipTag = true;

        const result = await runApply(bundlePath, applyOpts);
        console.log(`Patch ID:    ${result.patchId}`);
        console.log(`Bundle:      ${result.bundlePath}`);
        console.log(`Diff applied: ${result.diffApplied ? "yes" : "no"}`);
        console.log(`Tests pass:   ${result.testsPass ? "yes" : "no"}`);
        if (result.tag) console.log(`Tag:          ${result.tag}`);
        if (result.errors.length > 0) {
          console.log(`\nErrors:`);
          for (const err of result.errors) console.log(`  - ${err}`);
        }
        break;
      }

      case "pr": {
        const prOpts: {
          draft?: boolean;
          base?: string;
          title?: string;
          body?: string;
          noPush?: boolean;
        } = {};
        if (opts.draft === true) prOpts.draft = true;
        if (typeof opts.base === "string") prOpts.base = opts.base;
        if (typeof opts.title === "string") prOpts.title = opts.title;
        if (typeof opts.body === "string") prOpts.body = opts.body;
        if (opts["no-push"] === true) prOpts.noPush = true;

        const result = await runPr(prOpts);
        console.log(`Branch:    ${result.branch}`);
        console.log(`Pushed:    ${result.pushedTo}`);
        if (result.prUrl) {
          console.log(`PR:        ${result.prUrl}`);
          console.log(`PR #:      ${result.prNumber}`);
          console.log(`\nPR created/updated. Manifest updated.`);
        } else if (result.error) {
          console.error(`gh pr create failed: ${result.error}`);
          console.error(`\nYou can still push the branch manually:`);
          console.error(`  git push -u <fork-remote> ${result.branch}`);
          console.error(
            `Then open the PR at: https://github.com/<owner>/<repo>/compare/${result.branch}`,
          );
        }
        break;
      }

      case "publish": {
        const pubOpts: { message?: string; allowMissingPr?: boolean } = {};
        if (typeof opts.message === "string") pubOpts.message = opts.message;
        if (typeof opts.m === "string") pubOpts.message = opts.m;
        if (opts["allow-missing-pr"] === true) pubOpts.allowMissingPr = true;

        const result = await runPublish(pubOpts);
        if (result.pushed) {
          console.log(`Pushed:    ${result.commitSha} → ${result.remote}`);
          console.log(`Files:     ${result.filesStaged} staged`);
          console.log(`Message:   ${result.commitMessage}`);
          console.log(`\nPatch intents published. Other users can import via:`);
          console.log(`  fh import https://github.com/<user>/.forkhub/...`);
        } else {
          console.log(`Nothing to publish. Latest commit: ${result.commitSha}`);
        }
        break;
      }

      case "reconcile": {
        const reconcileOpts: Parameters<typeof runReconcile>[0] = {};
        if (typeof opts.tag === "string") reconcileOpts.tag = opts.tag;
        if (opts["dry-run"] === true) reconcileOpts.dryRun = true;
        if (typeof opts.target === "string") reconcileOpts.targetRepo = opts.target;
        if (typeof opts["forkhub-dir"] === "string") reconcileOpts.forkhubDir = opts["forkhub-dir"];

        const result = await runReconcile(reconcileOpts);
        for (const w of result.warnings) console.error(`⚠ ${w}`);
        console.log(`Tag:            ${result.consumedTag} (${result.consumedSha.slice(0, 7)})`);
        console.log(
          `Upstream base:  ${result.upstreamBaseSha.slice(0, 7)} (${result.upstreamBaseSource})`,
        );
        if (result.patchesReconciled.length > 0) {
          console.log(`\nReconciled ${result.patchesReconciled.length} patch(es):`);
          for (const p of result.patchesReconciled) {
            console.log(`  - ${p.patchId}: last_realized ${p.from ?? "(none)"} → ${p.to}`);
          }
          if (opts["dry-run"])
            console.log(`\n[dry-run] No changes written. Re-run without --dry-run to apply.`);
        }
        if (result.alreadySynced.length > 0) {
          console.log(`Already synced: ${result.alreadySynced.join(", ")}`);
        }
        if (result.patchesMissing.length > 0) {
          console.log(`\nNot found in this tag (left untouched):`);
          for (const p of result.patchesMissing) {
            console.log(`  - ${p.patchId}: ${p.reason}`);
          }
        }
        break;
      }

      case "push": {
        const pushOpts: Parameters<typeof runPush>[0] = {};
        if (typeof opts.remote === "string") pushOpts.remote = opts.remote;
        if (opts["dry-run"] === true) pushOpts.dryRun = true;
        if (opts["with-metadata"] === true || opts.metadata === true) pushOpts.withMetadata = true;
        if (typeof opts.target === "string") pushOpts.targetRepo = opts.target;
        if (typeof opts["forkhub-dir"] === "string") pushOpts.forkhubDir = opts["forkhub-dir"];

        const result = await runPush(pushOpts);
        if (result.branchPushed) {
          console.log(`Pushed forkhub/main → ${result.remote}`);
        } else {
          console.log(`forkhub/main not pushed${opts["dry-run"] ? "" : " (see errors)"}.`);
        }
        if (result.tagsPushed.length > 0) {
          console.log(`Pushed ${result.tagsPushed.length} tag(s): ${result.tagsPushed.join(", ")}`);
        }
        if (result.metadataPushed) {
          console.log(`Pushed .forkhub metadata repo.`);
        }
        if (result.errors.length > 0) {
          console.error(`Errors:`);
          for (const err of result.errors) console.error(`  - ${err}`);
          process.exitCode = 1;
        }
        break;
      }

      default:
        console.error(`Unknown command: ${command}\n`);
        console.log(HELP);
        process.exit(1);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

main();
