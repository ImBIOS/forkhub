import { test, expect, afterEach } from "bun:test";
import { fetchWithRetry } from "../src/search";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("fetchWithRetry retries 504s then succeeds", async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    if (calls < 3) return new Response("gateway timeout", { status: 504 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as unknown as typeof fetch;

  const res = await fetchWithRetry("https://api.github.com/test");
  expect(res.status).toBe(200);
  expect(calls).toBe(3);
});

test("fetchWithRetry throws after exhausting retries", async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    throw new Error("network down");
  }) as unknown as typeof fetch;

  let threw = false;
  try {
    await fetchWithRetry("https://api.github.com/test", undefined, 2);
  } catch {
    threw = true;
  }
  expect(threw).toBe(true);
  expect(calls).toBe(2);
});

test("fetchWithRetry does not retry 404", async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;

  const res = await fetchWithRetry("https://api.github.com/test");
  expect(res.status).toBe(404);
  expect(calls).toBe(1);
});
