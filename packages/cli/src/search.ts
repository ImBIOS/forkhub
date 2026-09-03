export type SearchResult = {
  user: string;
  repo: string;
  branch: string;
  path: string;
  url: string;
  patchId: string;
  title: string;
  targetRepo: string | null;
};

export type SearchOptions = {
  targetRepo?: string;
  author?: string;
  query?: string;
  limit?: number;
};

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 4;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "forkhub-cli",
  };
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/** fetch with exponential backoff for transient GitHub failures (504s, rate limits). Exported for tests. */
export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  attempts = MAX_ATTEMPTS,
): Promise<Response> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (!RETRYABLE_STATUS.has(response.status) || attempt === attempts) return response;
      lastError = new Error(`GitHub API error ${response.status}`);
      await response.body?.cancel().catch(() => {});
    } catch (err) {
      lastError = err;
      if (attempt === attempts) throw err;
    } finally {
      clearTimeout(timeout);
    }
    await sleep(500 * 2 ** (attempt - 1));
  }
  throw lastError instanceof Error ? lastError : new Error("GitHub request failed after retries");
}

async function githubApi(path: string): Promise<any> {
  const response = await fetchWithRetry(`https://api.github.com${path}`, {
    headers: githubHeaders(),
  });
  if (!response.ok) {
    if (response.status === 403) {
      const body = await response.text();
      throw new Error(
        `GitHub API rate limited. Set GH_TOKEN to raise the limit. ${body.slice(0, 200)}`,
      );
    }
    if (RETRYABLE_STATUS.has(response.status)) {
      throw new Error(
        `GitHub API unavailable (HTTP ${response.status}) after ${MAX_ATTEMPTS} attempts. Try again later.`,
      );
    }
    throw new Error(`GitHub API error ${response.status}: ${await response.text()}`);
  }
  return await response.json();
}

async function fetchIntentMeta(
  user: string,
  repo: string,
  branch: string,
  path: string,
): Promise<{ patchId: string; title: string; targetRepo: string | null }> {
  try {
    const rawUrl = `https://raw.githubusercontent.com/${user}/${repo}/${branch}/${path}`;
    const response = await fetch(rawUrl);
    if (!response.ok)
      return {
        patchId: path.split("/").pop()?.replace("/INTENT.md", "") ?? "unknown",
        title: "unknown",
        targetRepo: null,
      };
    const content = await response.text();
    const idMatch = content.match(/^id:\s*(.+)$/m);
    const titleMatch = content.match(/^title:\s*(.+)$/m);
    const targetMatch = content.match(/^target_repo:\s*(.+)$/m);
    return {
      patchId:
        idMatch?.[1]?.trim() ?? path.split("/").pop()?.replace("/INTENT.md", "") ?? "unknown",
      title: titleMatch?.[1]?.trim() ?? "unknown",
      targetRepo: targetMatch?.[1]?.trim() ?? null,
    };
  } catch {
    return { patchId: "unknown", title: "unknown", targetRepo: null };
  }
}

export async function runSearch(options: SearchOptions = {}): Promise<SearchResult[]> {
  if (options.author) {
    return await searchByAuthor(options.author, options);
  }

  if (options.targetRepo) {
    return await searchByTargetRepo(options.targetRepo, options);
  }

  throw new Error(
    "Search requires --author <username> or --target <github.com/owner/repo>.\n" +
      "GitHub code search API requires authentication for unfiltered queries.\n" +
      "Example: forkhub search --author alice\n" +
      "         forkhub search --target github.com/owner/repo",
  );
}

async function searchByAuthor(author: string, options: SearchOptions): Promise<SearchResult[]> {
  const limit = options.limit ?? 20;
  const candidates: Array<{
    user: string;
    repo: string;
    branch: string;
    path: string;
    url: string;
  }> = [];

  const pushTreeEntries = (tree: any, branch: string) => {
    for (const entry of tree.tree ?? []) {
      if (
        entry.type === "blob" &&
        entry.path.includes("/patches/") &&
        entry.path.endsWith("/INTENT.md")
      ) {
        candidates.push({
          user: author,
          repo: ".forkhub",
          branch,
          path: entry.path,
          url: `https://github.com/${author}/.forkhub/blob/${branch}/${entry.path}`,
        });
      }
    }
  };

  try {
    const meta: any = await githubApi(`/repos/${author}/.forkhub`);
    const defaultBranch = typeof meta.default_branch === "string" ? meta.default_branch : "main";
    const tree: any = await githubApi(
      `/repos/${author}/.forkhub/git/trees/${defaultBranch}?recursive=1`,
    );
    if (tree.truncated || !tree.tree) {
      throw new Error("Tree too large or empty");
    }
    pushTreeEntries(tree, defaultBranch);
  } catch {
    const reposData: any = await githubApi(`/users/${author}/repos?per_page=100`);
    for (const r of reposData.filter((r: any) => r.name === ".forkhub")) {
      try {
        const tree: any = await githubApi(
          `/repos/${author}/.forkhub/git/trees/${r.default_branch}?recursive=1`,
        );
        for (const entry of tree.tree) {
          if (
            entry.type === "blob" &&
            entry.path.includes("/patches/") &&
            entry.path.endsWith("/INTENT.md")
          ) {
            candidates.push({
              user: author,
              repo: ".forkhub",
              branch: r.default_branch,
              path: entry.path,
              url: `https://github.com/${author}/.forkhub/blob/${r.default_branch}/${entry.path}`,
            });
          }
        }
      } catch {}
    }
  }

  return await filterAndEnrich(candidates, options, limit);
}

async function searchByTargetRepo(
  targetRepo: string,
  options: SearchOptions,
): Promise<SearchResult[]> {
  const limit = options.limit ?? 20;
  const dotRepoSearch: any = await githubApi(
    `/search/repositories?q=${encodeURIComponent(targetRepo + " in:name .forkhub")}&per_page=20`,
  );
  const candidates: Array<{
    user: string;
    repo: string;
    branch: string;
    path: string;
    url: string;
  }> = [];
  for (const r of dotRepoSearch.items ?? []) {
    try {
      const tree: any = await githubApi(
        `/repos/${r.full_name}/git/trees/${r.default_branch}?recursive=1`,
      );
      for (const entry of tree.tree) {
        if (
          entry.type === "blob" &&
          entry.path.includes("/patches/") &&
          entry.path.endsWith("/INTENT.md")
        ) {
          const [user, repo] = r.full_name.split("/");
          candidates.push({
            user,
            repo,
            branch: r.default_branch,
            path: entry.path,
            url: `https://github.com/${r.full_name}/blob/${r.default_branch}/${entry.path}`,
          });
        }
      }
    } catch {}
  }
  return await filterAndEnrich(candidates, options, limit);
}

async function filterAndEnrich(
  candidates: Array<{ user: string; repo: string; branch: string; path: string; url: string }>,
  options: SearchOptions,
  limit: number,
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  for (const c of candidates) {
    const meta = await fetchIntentMeta(c.user, c.repo, c.branch, c.path);
    if (options.targetRepo && meta.targetRepo !== options.targetRepo) continue;
    if (options.query) {
      const q = options.query.toLowerCase();
      if (!meta.title.toLowerCase().includes(q) && !meta.patchId.toLowerCase().includes(q))
        continue;
    }
    results.push({ ...c, ...meta });
    if (results.length >= limit) break;
  }
  return results;
}

export function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) {
    return "No patches found.\n";
  }
  const lines: string[] = [`Found ${results.length} patch(es):\n`];
  for (const r of results) {
    lines.push(`  ${r.patchId}`);
    lines.push(`    title:      ${r.title}`);
    lines.push(`    author:     ${r.user}`);
    if (r.targetRepo) lines.push(`    target:     ${r.targetRepo}`);
    lines.push(`    import:     forkhub import ${r.url}`);
    lines.push("");
  }
  return lines.join("\n");
}
