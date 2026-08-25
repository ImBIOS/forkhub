import { describe, test, expect } from "bun:test";
import {
  parseTagPattern,
  deriveNextTag,
  upstreamTagOf,
  globToRegExp,
  matchesParsedPattern,
  DEFAULT_TAG_PATTERN,
} from "./tags";

describe("parseTagPattern", () => {
  test("default pattern", () => {
    expect(parseTagPattern(DEFAULT_TAG_PATTERN)).toEqual({ prefix: "v", track: "-fh" });
  });

  test("empty falls back to default", () => {
    expect(parseTagPattern("")).toEqual({ prefix: "v", track: "-fh" });
    expect(parseTagPattern("   ")).toEqual({ prefix: "v", track: "-fh" });
  });

  test("nightly track", () => {
    expect(parseTagPattern("v*-nightly*")).toEqual({ prefix: "v", track: "-nightly" });
  });

  test("no leading prefix", () => {
    expect(parseTagPattern("*-fh*")).toEqual({ prefix: "", track: "-fh" });
  });

  test("no wildcard treated as literal prefix", () => {
    expect(parseTagPattern("fork-")).toEqual({ prefix: "fork-", track: "" });
  });
});

describe("globToRegExp", () => {
  test("anchors and wildcards", () => {
    const re = globToRegExp("v*-fh*");
    expect(re.test("v1.2.3-fh1")).toBe(true);
    expect(re.test("v10.0.0-fh42")).toBe(true);
    expect(re.test("1.2.3-fh1")).toBe(false);
    expect(re.test("v1.2.3-nightly1")).toBe(false);
  });

  test("regex metacharacters are escaped", () => {
    const re = globToRegExp("v1.*-rc.1+build*");
    expect(re.test("v1.x-rc.1+build9")).toBe(true);
    expect(re.test("v1aX-rcA1+build9")).toBe(false);
  });

  test("prefix-less pattern", () => {
    const re = globToRegExp("*-nightly*");
    expect(re.test("1179-nightly2")).toBe(true);
    expect(re.test("1179-fh1")).toBe(false);
  });
});

describe("deriveNextTag", () => {
  test("first tag on a release", () => {
    expect(deriveNextTag("v*-fh*", "v1.0.0", [])).toBe("v1.0.0-fh1");
  });

  test("increments per release independently", () => {
    const existing = ["v1.0.0-fh1", "v1.0.0-fh2", "v2.0.0-fh1"];
    expect(deriveNextTag("v*-fh*", "v1.0.0", existing)).toBe("v1.0.0-fh3");
    expect(deriveNextTag("v*-fh*", "v2.0.0", existing)).toBe("v2.0.0-fh2");
    expect(deriveNextTag("v*-fh*", "v3.0.0", existing)).toBe("v3.0.0-fh1");
  });

  test("custom track", () => {
    expect(deriveNextTag("*-nightly*", "1179", ["1179-nightly1"])).toBe("1179-nightly2");
  });

  test("ignores non-counter suffixes", () => {
    expect(deriveNextTag("v*-fh*", "v1.0.0", ["v1.0.0-fhX", "v1.0.0-fh"])).toBe("v1.0.0-fh1");
  });
});

describe("upstreamTagOf", () => {
  test("strips default track", () => {
    expect(upstreamTagOf("v2.0.0-fh7", "v*-fh*")).toBe("v2.0.0");
  });

  test("strips custom track", () => {
    expect(upstreamTagOf("1179-fh1", "*-fh*")).toBe("1179");
    expect(upstreamTagOf("1179-nightly3", "*-nightly*")).toBe("1179");
  });

  test("returns null for foreign shapes", () => {
    expect(upstreamTagOf("v2.0.0", "v*-fh*")).toBe(null);
    expect(upstreamTagOf("2.0.0-fh1", "v*-fh*")).toBe(null);
    expect(upstreamTagOf("v2.0.0-fh", "v*-fh*")).toBe(null);
    expect(upstreamTagOf("v2.0.0-fhx", "v*-fh*")).toBe(null);
  });

  test("track overlapping version text picks the LAST occurrence", () => {
    // "v1-fh-fh2": track "-fh" last occurs before "2"
    expect(upstreamTagOf("v1-fh-fh2", "v*-fh*")).toBe("v1-fh");
  });
});

describe("matchesParsedPattern", () => {
  test("shape check", () => {
    const parsed = parseTagPattern("v*-fh*");
    expect(matchesParsedPattern("v1.0.0-fh2", parsed)).toBe(true);
    expect(matchesParsedPattern("1.0.0-fh2", parsed)).toBe(false);
  });
});
