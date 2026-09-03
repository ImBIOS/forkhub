import { join } from "node:path";
import { isGitRepo } from "./git";
import { runImport } from "./import";
import { runReDerive } from "./re-derive";

export type ReuseOptions = {
  forkhubDir?: string;
  force?: boolean;
  agent?: string;
};

export type ReuseResult = {
  patchId: string;
  targetRepo: string;
  author: string;
  bundlePath: string;
  filesInBundle: string[];
};

/**
 * One-command reuse: import someone's published patch and immediately
 * generate the re-derivation bundle for it, so an AI agent can implement
 * it against your fork. With `agent`, invoke the agent like `watch` does.
 *
 * Full loop: `fh reuse <url>` → agent writes REALIZATION/realization.diff
 * → `fh apply <bundle>` → `fh update`.
 */
export async function runReuse(source: string, options: ReuseOptions = {}): Promise<ReuseResult> {
  if (!(await isGitRepo())) {
    throw new Error("Not a git repository. Run from inside your fork's checkout.");
  }
  const forkhubDir = options.forkhubDir ?? join(process.cwd(), "..", ".forkhub");

  const imported = await runImport(source, { forkhubDir, force: options.force });
  const derived = await runReDerive(imported.patchId, { forkhubDir });
  if (!derived.bundlePath) {
    throw new Error(`Patch ${imported.patchId} is already current. Nothing to re-derive.`);
  }

  if (options.agent) {
    const { invokeAgent } = await import("./watch");
    await invokeAgent(options.agent, derived.bundlePath, imported.patchId);
  }

  return {
    patchId: imported.patchId,
    targetRepo: imported.targetRepo,
    author: imported.author,
    bundlePath: derived.bundlePath,
    filesInBundle: derived.filesInBundle,
  };
}
