import { existsSync } from "node:fs";
import { join } from "node:path";
import { isGitRepo, gitOrThrow, currentBranch, createBranch, shortSha } from "./git";
import { slugify } from "./patch-id";

export type DraftOptions = {
  forkhubDir?: string;
  upstreamBranch?: string;
};

export type DraftResult = {
  branch: string;
  slug: string;
  intent: string;
  draftFile: string;
  baseSha: string;
};

const DRAFT_FILE = ".forkhub-draft.md";

export async function runDraft(intent: string, options: DraftOptions = {}): Promise<DraftResult> {
  if (!intent) {
    throw new Error("Intent description required. Usage: forkhub draft \"<intent>\"");
  }

  if (!(await isGitRepo())) {
    throw new Error("Not a git repository. Run from inside your fork's checkout.");
  }

  const forkhubDir = options.forkhubDir ?? join(process.cwd(), "..", ".forkhub");
  if (!existsSync(forkhubDir)) {
    throw new Error(".forkhub repo not found. Run `forkhub init` first.");
  }

  const branch = await currentBranch();
  if (branch !== "main" && branch !== "master") {
    throw new Error(`Currently on branch '${branch}'. Switch to main/master before drafting.`);
  }

  const upstreamBranch = options.upstreamBranch ?? "main";
  const slug = slugify(intent);
  if (!slug) {
    throw new Error("Could not generate slug from intent. Provide a more descriptive intent.");
  }

  const branchName = slug;
  const existingBranches = await gitOrThrow(["branch", "--list", branchName]);
  if (existingBranches) {
    throw new Error(`Branch '${branchName}' already exists. Pick a different intent or delete the branch.`);
  }

  await createBranch(branchName, upstreamBranch);

  const baseSha = await gitOrThrow(["rev-parse", upstreamBranch]);
  const draftPath = join(process.cwd(), DRAFT_FILE);

  const draftContent = `---
slug: ${slug}
intent: ${intent}
base_branch: ${upstreamBranch}
base_sha: ${shortSha(baseSha)}
created: ${new Date().toISOString()}
status: drafting
---

## Intent

${intent}

## Why

(Describe why you want this patch. Why won't the maintainer merge it?)

## Non-negotiables

(What must be true for this patch to be correct?)

## Implementation notes

(Document what you did. This helps the AI re-derive on future upstream releases.)
`;

  await Bun.write(draftPath, draftContent);

  const gitignorePath = join(process.cwd(), ".gitignore");
  const { existsSync: existsSyncSync } = await import("node:fs");
  let gitignore = "";
  if (existsSyncSync(gitignorePath)) {
    gitignore = await Bun.file(gitignorePath).text();
  }
  if (!gitignore.includes(DRAFT_FILE)) {
    gitignore = gitignore.trimEnd() + "\n" + (gitignore.length > 0 ? "\n" : "") + "# forkhub draft\n" + DRAFT_FILE + "\n";
    await Bun.write(gitignorePath, gitignore);
  }

  return {
    branch: branchName,
    slug,
    intent,
    draftFile: draftPath,
    baseSha: baseSha,
  };
}
