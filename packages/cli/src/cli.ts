#!/usr/bin/env bun
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
import { runList, formatListResult } from "./list";
import { runPrStatus, formatPrStatus } from "./pr-status";
import { runCleanup, formatCleanup } from "./cleanup";
import {
  bold,
  dim,
  gray,
  red,
  green,
  yellow,
  cyan,
  ok,
  fail,
  warn,
  info,
  cmd,
  filePath,
  url,
  sha,
  refName,
  meta,
  kv,
  errPrefix,
  heading,
  highlightCmds,
  setColorsEnabled,
} from "./style";

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

type HelpRow = [command: string, description: string];

const COMMAND_ROWS: HelpRow[] = [
  ["init [--target <repo>]", "Set up .forkhub repo"],
  ['draft "<intent>"', "Create a draft branch for a new patch"],
  ["satisfied [--skip-port]", "Finalize intent, port to forkhub/main"],
  ["pr [--draft] [--base <branch>]", "Push current branch + open PR to upstream"],
  ["publish [--message <msg>]", "Push .forkhub repo to your public GitHub repo"],
  ["import <url> [--force]", "Import a patch from another user's .forkhub"],
  ["search [query] [--target <repo>]", "Search GitHub for patches"],
  ["re-derive <patch-id> [--force]", "Generate re-derivation context bundle"],
  ["apply <bundle-path>", "Apply realization from context bundle"],
  ["drift-check", "Check if patches need re-derivation"],
  ["watch [--once] [--interval <sec>] [--agent <name>]", "Daemon: auto-detect drift + generate bundles"],
  ["update [--tag <tag>] [--dry-run]", "Update to latest (or specified) tag"],
  ["rollback", "Roll back to the previous tag"],
  ["status", "Show current state"],
  ["list | patches [--target <repo>]", "List all intent-patches on this machine (global)"],
  ["pr-status [patch-id] [--target <repo>]", "Check upstream PR/issue status (uses gh)"],
  ["cleanup [--apply] [--dry-run] [--target <repo>]", "Auto-remove upstreamed patches, switch to official release"],
];

const FLAG_ROWS: HelpRow[] = [
  ["--help, -h", "Show this help"],
  ["--no-color", "Disable colored output"],
  ["--color", "Force colored output (also FORCE_COLOR=1)"],
];

function renderHelp(): string {
  const lines: string[] = [];
  const nameWidth = Math.max(...COMMAND_ROWS.map(([c]) => c.length), ...FLAG_ROWS.map(([c]) => c.length)) + 2;

  lines.push(`  ${bold(green("fh"))} ${dim("·")} ${bold("forkhub")}`);
  lines.push(`  ${gray("Keep up-to-date upstream + your custom patches. Patches are intent, not diffs.")}`);
  lines.push("");
  lines.push(`${heading("Usage")} ${dim("fh <command> [flags]")}`);
  lines.push("");
  lines.push(heading("Commands"));
  for (const [c, d] of COMMAND_ROWS) {
    const rawPad = pad(c, nameWidth);
    const idx = c.indexOf(" ");
    let styled: string;
    if (idx === -1) styled = cyan(c);
    else styled = `${cyan(c.slice(0, idx))} ${dim(c.slice(idx + 1))}`;
    const ansiExtra = styled.length - c.length;
    const padCount = Math.max(0, nameWidth - c.length);
    styled = `${styled}${" ".repeat(padCount)}`;
    void ansiExtra;
    void rawPad;
    lines.push(`  ${styled}${d}`);
  }
  lines.push("");
  lines.push(heading("Flags"));
  for (const [f, d] of FLAG_ROWS) {
    const padCount = Math.max(0, nameWidth - f.length);
    lines.push(`  ${dim(f)}${" ".repeat(padCount)}${d}`);
  }
  lines.push("");
  lines.push(gray("Producer commands run from inside your fork's checkout."));
  lines.push(highlightCmds(gray("Consumer commands (update, rollback, status) also run from the fork checkout.")));
  lines.push(gray("The `pr` command requires a fork setup (separate `upstream` and `origin` remotes)."));
  return lines.join("\n");
}

const HELP = renderHelp();

function parseArgs(argv: string[]): { command?: string; opts: Record<string, string | boolean>; positional: string[] } {
  const [command, ...rest] = argv;
  const opts: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg && (arg.startsWith("--") || (arg.startsWith("-") && arg.length > 1 && !/^-?\d/.test(arg)))) {
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

async function runStatus() {
  const { isGitRepo, currentSha, currentTag, listTags } = await import("./git");
  if (!(await isGitRepo())) {
    console.error(`${errPrefix()} Not a git repository.`);
    process.exit(1);
  }
  const shaStr = await currentSha();
  const tag = await currentTag();
  const tags = await listTags();

  console.log(`${kv("Current:", 10)}${tag ? refName(tag) : gray("(detached)")} ${sha(shaStr.slice(0, 7))}`);
  const latest = tags[0];
  if (latest) {
    console.log(`${kv("Latest:", 10)}${refName(latest.name)} ${sha(latest.sha.slice(0, 7))}`);
    if (latest.sha !== shaStr) {
      console.log(`\n${highlightCmds(gray(`Run \`fh update\` to advance.`))}`);
    } else {
      console.log(`\n${ok()} ${green("Already at latest.")}`);
    }
  } else {
    console.log(`\n${warn()} No forkhub tags found.`);
  }
}

async function main() {
  // global color flags (before anything prints) — support both `fh --color list` and `fh list --color`
  const rawArgs = process.argv.slice(2);
  const hasNoColor = rawArgs.includes("--no-color");
  const hasColor = rawArgs.includes("--color");
  if (hasNoColor) setColorsEnabled(false);
  else if (hasColor) setColorsEnabled(true);
  // strip global color flags so `fh --color list` doesn't treat --color as command
  const filteredArgs = rawArgs.filter((a) => a !== "--color" && a !== "--no-color");

  const { command, opts, positional } = parseArgs(filteredArgs);

  if (!command || command === "--help" || command === "-h" || command === "help") {
    console.log(HELP);
    return;
  }

  try {
    switch (command) {
      case "init": {
        const initOpts: { upstreamRemote?: string; forkRemote?: string; target?: string } = {};
        if (typeof opts["upstream-remote"] === "string") initOpts.upstreamRemote = opts["upstream-remote"];
        if (typeof opts["fork-remote"] === "string") initOpts.forkRemote = opts["fork-remote"];
        if (typeof opts.target === "string") initOpts.target = opts.target;

        const result = await runInit(initOpts);
        console.log(`${kv("Target repo:", 17)}${cyan(result.targetRepo)}`);
        console.log(`${kv("Upstream remote:", 17)}${result.upstreamRemote} ${gray(`(${result.upstreamUrl})`)}`);
        if (result.isFork && result.forkRemote) {
          console.log(`${kv("Fork remote:", 17)}${result.forkRemote} ${gray(`(${result.forkUrl})`)}`);
          console.log(`${kv("Setup:", 17)}${green("FORK")} ${dim(`— track drift on upstream, push PRs from`)} ${result.forkRemote}`);
        } else {
          console.log(`${kv("Setup:", 17)}${yellow("SINGLE-REMOTE")} ${dim("— no fork detected")}`);
        }
        console.log(`${kv(".forkhub:", 17)}${filePath(result.forkhubDir)}`);
        console.log(result.created ? `${ok()} Created new .forkhub repo.` : `${ok()} Existing .forkhub repo configured.`);
        break;
      }

      case "draft": {
        const intent = positional.join(" ");
        if (!intent) {
          throw new Error("Intent description required. Usage: fh draft \"<intent>\"");
        }
        const result = await runDraft(intent);
        console.log(`${kv("Branch:", 11)}${refName(result.branch)}`);
        console.log(`${kv("Slug:", 11)}${result.slug}`);
        console.log(`${kv("Base:", 11)}${sha(result.baseSha.slice(0, 7))}`);
        console.log(`${kv("Draft:", 11)}${filePath(result.draftFile)}`);
        console.log(`\n${highlightCmds(gray(`Implement your patch on branch '${result.branch}'.`))}`);
        console.log(`${highlightCmds(gray(`When done, run: \`fh satisfied\``))}`);
        break;
      }

      case "satisfied": {
        const satisfiedOpts: { skipPort?: boolean } = {};
        if (opts["skip-port"] === true) satisfiedOpts.skipPort = true;

        const result = await runSatisfied(satisfiedOpts);
        console.log(`${kv("Patch ID:", 16)}${cyan(result.patchId)}`);
        console.log(`${kv("Branch:", 16)}${refName(result.branch)}`);
        console.log(`${kv("Files changed:", 16)}${result.filesChanged.join(", ") || gray("(none)")}`);
        if (result.forkhubMainUpdated) {
          console.log(`${kv("Ported to:", 16)}${refName("forkhub/main")}`);
          if (result.tag) console.log(`${kv("Tag:", 16)}${refName(result.tag)}`);
        } else {
          console.log(`${kv("Port:", 16)}${yellow("skipped")}`);
        }
        console.log(`\n${ok()} ${highlightCmds(gray("Intent saved to `.forkhub`."))}`);
        break;
      }

      case "update": {
        const updateOpts: UpdateOptions = {};
        if (typeof opts.tag === "string") updateOpts.tag = opts.tag;
        if (opts["dry-run"] === true) updateOpts.dryRun = true;
        if (opts["skip-install"] === true) updateOpts.skipInstall = true;

        const result = await runUpdate(updateOpts);

        if (result.skipped) {
          console.log(`${ok()} Already at ${refName(result.to)} ${gray(`(${sha(result.from.slice(0, 7))})`)}. Nothing to do.`);
          return;
        }

        if (opts["dry-run"]) {
          console.log(`${warn("[dry-run]")} Would update ${sha(result.from.slice(0, 7))} → ${refName(result.to)} ${gray(`(${sha(result.toSha.slice(0, 7))})`)}`);
          return;
        }

        console.log(`${ok()} Updated ${sha(result.from.slice(0, 7))} → ${refName(result.to)} ${gray(`(${sha(result.toSha.slice(0, 7))})`)}`);
        if (result.stashed) {
          if (result.stashRestored) {
            console.log(`  ${ok()} Local changes restored from stash.`);
          } else {
            console.warn(`  ${warn()} ${yellow("Local changes could not be restored (conflicts).")} See ${cmd("`git stash list`")}.`);
          }
        }
        break;
      }

      case "rollback": {
        const rollbackOpts: UpdateOptions = {};
        if (opts["dry-run"] === true) rollbackOpts.dryRun = true;
        if (opts["skip-install"] === true) rollbackOpts.skipInstall = true;

        const result = await runRollback(rollbackOpts);
        if (result.skipped) {
          console.log(`${ok()} Already at ${refName(result.to)}. Nothing to do.`);
        } else {
          console.log(`${ok()} Rolled back ${sha(result.from)} → ${refName(result.to)} ${gray(`(${sha(result.toSha.slice(0, 7))})`)}`);
        }
        break;
      }

      case "status": {
        await runStatus();
        break;
      }

      case "drift-check": {
        const result = await runDriftCheck();
        console.log(formatDriftCheckResult(result));
        break;
      }

      case "search": {
        const searchOpts: { targetRepo?: string; author?: string; query?: string; limit?: number } = {};
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
        console.log(`${kv("Patch ID:", 14)}${cyan(result.patchId)}`);
        console.log(`${kv("Target repo:", 14)}${cyan(result.targetRepo)}`);
        console.log(`${kv("Author:", 14)}${result.author}`);
        console.log(`${kv("Files:", 14)}${result.filesImported.join(", ") || gray("(none)")}`);
        console.log(`\n${ok()} Patch imported. ${highlightCmds(gray("Run `fh drift-check` to see if re-derivation is needed."))}`);
        break;
      }

      case "re-derive": {
        const patchId = positional[0];
        if (!patchId) {
          throw new Error("Patch ID required. Usage: fh re-derive <patch-id>");
        }
        const reDeriveOpts: { force?: boolean } = {};
        if (opts.force === true) reDeriveOpts.force = true;

        const result = await runReDerive(patchId, reDeriveOpts);
        if (result.status === "current" && !opts.force) {
          console.log(`${ok()} Patch ${cyan(result.patchId)} is ${green("current")}. No re-derivation needed.`);
          console.log(`  ${meta("Use --force to re-derive anyway.")}`);
          break;
        }
        console.log(`${kv("Patch ID:", 13)}${cyan(result.patchId)}`);
        console.log(`${kv("Bundle:", 13)}${filePath(result.bundlePath)}`);
        console.log(`${kv("Status:", 13)}${result.status === "current" ? green(result.status) : yellow(result.status)}`);
        console.log(`\n${bold(`Bundle contents (${result.filesInBundle.length} files):`)}`);
        for (const f of result.filesInBundle) {
          console.log(`  ${dim("-")} ${f}`);
        }
        console.log(`\n${bold("Next steps:")}`);
        console.log(`  ${dim("1.")} Have an AI agent re-derive the patch and save to ${cmd("REALIZATION/realization.diff")}`);
        console.log(`  ${dim("2.")} Run: ${cmd(`fh apply ${result.bundlePath}`)}`);
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
        console.log(`${kv("Patch ID:", 14)}${cyan(result.patchId)}`);
        console.log(`${kv("Bundle:", 14)}${filePath(result.bundlePath)}`);
        console.log(`${kv("Diff applied:", 14)}${result.diffApplied ? green("yes") : red("no")}`);
        console.log(`${kv("Tests pass:", 14)}${result.testsPass ? green("yes") : red("no")}`);
        if (result.tag) console.log(`${kv("Tag:", 14)}${refName(result.tag)}`);
        if (result.errors.length > 0) {
          console.log(`\n${red(bold("Errors:"))}`);
          for (const err of result.errors) console.log(`  ${fail()} ${err}`);
        } else {
          console.log(`\n${ok()} ${green("Patch applied.")}`);
        }
        break;
      }

      case "pr": {
        const prOpts: { draft?: boolean; base?: string; title?: string; body?: string; noPush?: boolean } = {};
        if (opts.draft === true) prOpts.draft = true;
        if (typeof opts.base === "string") prOpts.base = opts.base;
        if (typeof opts.title === "string") prOpts.title = opts.title;
        if (typeof opts.body === "string") prOpts.body = opts.body;
        if (opts["no-push"] === true) prOpts.noPush = true;

        const result = await runPr(prOpts);
        console.log(`${kv("Branch:", 11)}${refName(result.branch)}`);
        console.log(`${kv("Pushed:", 11)}${result.pushedTo}`);
        if (result.prUrl) {
          console.log(`${kv("PR:", 11)}${url(result.prUrl)}`);
          console.log(`${kv("PR #:", 11)}${bold(`#${result.prNumber}`)}`);
          console.log(`\n${ok()} PR created/updated. Manifest updated.`);
        } else if (result.error) {
          console.error(`${fail()} gh pr create failed: ${result.error}`);
          console.error(`\n${gray("You can still push the branch manually:")}`);
          console.error(`  ${cmd(`git push -u <fork-remote> ${result.branch}`)}`);
          console.error(`${gray("Then open the PR at:")} https://github.com/<owner>/<repo>/compare/${result.branch}`);
        }
        break;
      }

      case "publish": {
        const pubOpts: { message?: string } = {};
        if (typeof opts.message === "string") pubOpts.message = opts.message;
        if (typeof opts.m === "string") pubOpts.message = opts.m;

        const result = await runPublish(pubOpts);
        if (result.pushed) {
          console.log(`${kv("Pushed:", 11)}${sha(result.commitSha)} ${dim("→")} ${result.remote}`);
          console.log(`${kv("Files:", 11)}${bold(String(result.filesStaged))} staged`);
          console.log(`${kv("Message:", 11)}${result.commitMessage}`);
          console.log(`\n${ok()} Patch intents published. Other users can import via:`);
          console.log(`  ${cmd("fh import https://github.com/<user>/.forkhub/...")}`);
        } else {
          console.log(`${info()} Nothing to publish. Latest commit: ${sha(result.commitSha)}`);
        }
        break;
      }

      case "list":
      case "patches": {
        const listOpts: { targetRepo?: string } = {};
        if (typeof opts.target === "string") listOpts.targetRepo = opts.target;
        const result = await runList({});
        // filter if target given
        if (listOpts.targetRepo) {
          result.repos = result.repos.filter((r) => r.targetRepo === listOpts.targetRepo);
          result.total = result.repos.reduce((acc, r) => acc + r.patches.length, 0);
        }
        console.log(formatListResult(result));
        break;
      }

      case "pr-status": {
        const prOpts: { patchId?: string; targetRepo?: string } = {};
        if (positional[0]) prOpts.patchId = positional[0];
        if (typeof opts.target === "string") prOpts.targetRepo = opts.target;
        // also support --patch-id flag
        if (typeof opts["patch-id"] === "string") prOpts.patchId = opts["patch-id"];
        const result = await runPrStatus(prOpts);
        console.log(formatPrStatus(result));
        break;
      }

      case "cleanup": {
        const cleanOpts: { apply?: boolean; dryRun?: boolean; targetRepo?: string } = {};
        if (opts.apply === true) cleanOpts.apply = true;
        if (opts["dry-run"] === true) cleanOpts.dryRun = true;
        if (typeof opts.target === "string") cleanOpts.targetRepo = opts.target;
        // default dry-run if not --apply
        if (!cleanOpts.apply) cleanOpts.dryRun = true;
        const result = await runCleanup(cleanOpts);
        console.log(formatCleanup(result, cleanOpts));
        break;
      }

      default:
        console.error(`${errPrefix()} Unknown command: ${bold(command ?? "")}\n`);
        console.log(HELP);
        process.exit(1);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${errPrefix()} ${message}`);
    process.exit(1);
  }
}

main();
