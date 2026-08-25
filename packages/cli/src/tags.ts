/**
 * Channel/track awareness for forkhub tags.
 *
 * A manifest may pin a `tag_pattern` glob (default "v*-fh*"). Consumers
 * (`fh update`, `fh rollback`, `fh status`) only ever see tags matching that
 * pattern, and producers (`fh satisfied`, `fh apply`, `fh advance`) derive new
 * tags from it — so a nightly-track fork never silently jumps onto stable
 * tags or vice versa.
 *
 * Derivation rule for a pattern like "v*-nightly*":
 *   - everything before the first "*" is the literal version prefix ("v")
 *   - the segment between the first and last "*" is the track ("-nightly")
 *   - the trailing "*" is the monotonically increasing counter
 *   → upstream tag "1.2.3-nightly.7" yields "1.2.3-nightly.7-nightly2"? No —
 *     upstream tag comes from `git describe`, e.g. "v1.2.3"; result:
 *     "v1.2.3-nightly2".
 */

export const DEFAULT_TAG_PATTERN = "v*-fh*";

export type ParsedTagPattern = {
  /** Literal text before the first wildcard ("" when absent). */
  prefix: string;
  /** Track segment between first and last wildcard, including separator (e.g. "-fh"). */
  track: string;
};

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gitExec } from "./git";
import { allConfiguredRepos } from "./target-repo";

export function parseTagPattern(pattern: string): ParsedTagPattern {
  const trimmed = pattern.trim();
  if (!trimmed) return parseTagPattern(DEFAULT_TAG_PATTERN);
  const parts = trimmed.split("*");
  // "A*B" / "A*B*..." → track = B; single segment (no wildcard) → treat as prefix only.
  if (parts.length === 1) return { prefix: parts[0]!, track: "" };
  return { prefix: parts[0]!, track: parts[1] ?? "" };
}

/** Convert a tag glob like "v*-nightly*" into an anchored RegExp for enforcement. */
export function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .trim()
    .split("*")
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}$`);
}

/** True when `tag` matches the parsed pattern's shape (prefix … track … digits). */
export function matchesParsedPattern(tag: string, parsed: ParsedTagPattern): boolean {
  if (!tag.startsWith(parsed.prefix)) return false;
  if (parsed.track === "") return true;
  const afterPrefix = tag.slice(parsed.prefix.length);
  const trackIdx = afterPrefix.lastIndexOf(parsed.track);
  if (trackIdx === -1) return false;
  const counter = afterPrefix.slice(trackIdx + parsed.track.length);
  return /^\d+$/.test(counter);
}

/**
 * Derive the next forkhub tag for `upstreamTag`, counting existing tags on the
 * same track. Pure — pass tags already listed with the same pattern.
 */
export function deriveNextTag(
  pattern: string,
  upstreamTag: string,
  existingTags: string[],
): string {
  const { prefix, track } = parseTagPattern(pattern);
  const base = `${upstreamTag}${track}`;
  let count = 0;
  for (const tag of existingTags) {
    if (!tag.startsWith(base)) continue;
    const counter = tag.slice(base.length);
    if (/^\d+$/.test(counter)) count++;
  }
  void prefix;
  return `${base}${count + 1}`;
}

/**
 * Strip the track suffix off a forkhub tag to recover the upstream tag it was
 * cut from. E.g. ("1179-fh1", "v*-fh*") → "1179".
 */
export function upstreamTagOf(fhTag: string, pattern: string): string | null {
  const { prefix, track } = parseTagPattern(pattern);
  if (!fhTag.startsWith(prefix)) return null;
  const afterPrefix = fhTag.slice(prefix.length);
  if (track === "") return afterPrefix === "" ? null : fhTag;
  const trackIdx = afterPrefix.lastIndexOf(track);
  if (trackIdx === -1) return null;
  const counter = afterPrefix.slice(trackIdx + track.length);
  if (!/^\d+$/.test(counter)) return null;
  const upstream = `${prefix}${afterPrefix.slice(0, trackIdx)}`;
  return upstream === "" ? null : upstream;
}

/**
 * Resolve the effective tag_pattern for this checkout: the manifest value when
 * every configured target agrees (or none sets one), otherwise a loud warning
 * plus the lexicographically-first value.
 */
export async function resolveTagPattern(forkhubDir?: string): Promise<string> {
  if (!forkhubDir) return DEFAULT_TAG_PATTERN;
  const patterns = new Set<string>();
  for (const repo of allConfiguredRepos(join(forkhubDir, "repos"))) {
    try {
      const manifest = JSON.parse(
        readFileSync(join(forkhubDir, "repos", repo, "manifest.json"), "utf-8"),
      );
      if (typeof manifest.tag_pattern === "string" && manifest.tag_pattern.trim()) {
        patterns.add(manifest.tag_pattern.trim());
      }
    } catch {
      // unreadable manifest — skip; other resolvers will surface real errors
    }
  }
  if (patterns.size === 0) return DEFAULT_TAG_PATTERN;
  if (patterns.size === 1) return [...patterns][0]!;
  const sorted = [...patterns].sort();
  console.error(
    `⚠ Multiple tag_patterns configured across targets: ${sorted.join(", ")}. Using "${sorted[0]}".`,
  );
  return sorted[0]!;
}

/**
 * Git-backed next-tag derivation used by satisfied/apply/advance: describe the
 * upstream release containing `atRef`, then count existing tags on the same
 * track for that release.
 */
export async function deriveNextFhTag(
  cwd: string,
  pattern: string,
  atRef = "HEAD",
): Promise<string> {
  const describe = await gitExec(["describe", "--tags", "--abbrev=0", atRef], cwd);
  const upstreamTag = describe.exitCode === 0 && describe.stdout ? describe.stdout : "v0.0.0";
  const { track } = parseTagPattern(pattern);
  const listing = await gitExec(["tag", "--list", `${upstreamTag}${track}*`], cwd);
  const existing = listing.stdout ? listing.stdout.split("\n").filter(Boolean) : [];
  return deriveNextTag(pattern, upstreamTag, existing);
}
