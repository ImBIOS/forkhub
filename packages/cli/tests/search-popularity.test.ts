import { test, expect, afterEach } from "bun:test";
import { runSearch, formatSearchResults } from "../src/search";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function intentMd(id: string, title: string, target = "github.com/o/r"): string {
  return `---\nid: ${id}\ntitle: ${title}\ntarget_repo: ${target}\n---\n\n## Intent\n\n${title}\n`;
}

// Target flow with two publishers: bob (100 stars) listed AFTER alice (5 stars).
function mockTargetFlow() {
  globalThis.fetch = (async (url: any) => {
    const u = String(url);
    if (u.includes("/search/repositories")) {
      return new Response(
        JSON.stringify({
          items: [
            { full_name: "alice/.forkhub", default_branch: "main", stargazers_count: 5 },
            { full_name: "bob/.forkhub", default_branch: "main", stargazers_count: 100 },
          ],
        }),
        { status: 200 },
      );
    }
    if (u.includes("/repos/alice/.forkhub/git/trees")) {
      return new Response(
        JSON.stringify({
          tree: [{ type: "blob", path: "repos/github.com/o/r/patches/a1/INTENT.md" }],
        }),
        { status: 200 },
      );
    }
    if (u.includes("/repos/bob/.forkhub/git/trees")) {
      return new Response(
        JSON.stringify({
          tree: [{ type: "blob", path: "repos/github.com/o/r/patches/b1/INTENT.md" }],
        }),
        { status: 200 },
      );
    }
    if (u.includes("raw.githubusercontent.com/alice"))
      return new Response(intentMd("a1", "Alice patch"), { status: 200 });
    if (u.includes("raw.githubusercontent.com/bob"))
      return new Response(intentMd("b1", "Bob patch"), { status: 200 });
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
}

test("search carries publisher stars through", async () => {
  mockTargetFlow();
  const results = await runSearch({ targetRepo: "github.com/o/r" });
  expect(results.length).toBe(2);
  const byId = Object.fromEntries(results.map((r) => [r.patchId, r]));
  expect(byId["a1"]?.stars).toBe(5);
  expect(byId["b1"]?.stars).toBe(100);
});

test("search --sort stars puts most popular first", async () => {
  mockTargetFlow();
  const results = await runSearch({ targetRepo: "github.com/o/r", sort: "stars" });
  expect(results.map((r) => r.patchId)).toEqual(["b1", "a1"]);
});

test("formatSearchResults shows stars and reuse command", async () => {
  mockTargetFlow();
  const results = await runSearch({ targetRepo: "github.com/o/r", sort: "stars", limit: 1 });
  const out = formatSearchResults(results);
  expect(out).toMatch(/stars:\s+100/);
  expect(out).toMatch(/fh reuse https:\/\/github\.com\/bob/);
});
