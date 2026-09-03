import { test, expect } from "bun:test";
import { slugify, generatePatchId, generateULID8 } from "../src/patch-id";

test("slugify lowercases and hyphenates", () => {
  expect(slugify("Add --cheat flag to reveal secret")).toBe("add-cheat-flag-to-reveal-secret");
});

test("slugify strips leading/trailing dashes and caps length", () => {
  expect(slugify("  Hello, World!  ")).toBe("hello-world");
  expect(slugify("a".repeat(100)).length).toBeLessThanOrEqual(50);
});

test("slugify returns empty for undescriptive intent", () => {
  expect(slugify("!!!")).toBe("");
});

test("generateULID8 is 8 crockford chars", () => {
  const id = generateULID8();
  expect(id).toMatch(/^[0123456789abcdefghjkmnpqrstvwxyz]{8}$/);
});

test("generatePatchId combines slug and suffix", () => {
  const id = generatePatchId("my-patch");
  expect(id.startsWith("my-patch-")).toBe(true);
  expect(id.length).toBe("my-patch-".length + 8);
});
