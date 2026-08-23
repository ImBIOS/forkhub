import pc from "picocolors";

let enabled: boolean | undefined;

export function colorsEnabled(): boolean {
  if (enabled !== undefined) return enabled;
  if (process.env.NO_COLOR !== undefined) return false;
  if (process.argv.includes("--no-color")) return false;
  // fh is colorful by default (like better-t-stack's gradient banner), piped `| head` still colored
  // disable only via NO_COLOR / --no-color / TERM=dumb
  if (process.argv.includes("--color")) return true;
  const force = process.env.FORCE_COLOR;
  if (force !== undefined && force !== "") return force !== "0" && force !== "false";
  if (process.env.TERM === "dumb") return false;
  return true;
}

/** Explicit override, e.g. from --no-color / --color CLI flags. */
export function setColorsEnabled(value: boolean): void {
  enabled = value;
}

function c(): ReturnType<typeof pc.createColors> {
  return pc.createColors(colorsEnabled());
}

export const bold = (t: string) => c().bold(t);
export const dim = (t: string) => c().dim(t);
export const italic = (t: string) => c().italic(t);
export const underline = (t: string) => c().underline(t);
export const red = (t: string) => c().red(t);
export const green = (t: string) => c().green(t);
export const yellow = (t: string) => c().yellow(t);
export const blue = (t: string) => c().blue(t);
export const magenta = (t: string) => c().magenta(t);
export const cyan = (t: string) => c().cyan(t);
export const white = (t: string) => c().white(t);
export const gray = (t: string) => c().gray(t);

// --- semantic tokens ---

export const ok = (t = "✓") => green(t);
export const fail = (t = "✗") => red(t);
export const warn = (t = "⚠") => yellow(t);
export const info = (t = "ℹ") => cyan(t);
export const pending = (t = "⏳") => yellow(t);

/** Command name / runnable hint, e.g. `fh drift-check`. */
export const cmd = (t: string) => cyan(t);

/** File path. */
export const filePath = (t: string) => blue(t);

/** URL / PR-issue link. */
export const url = (t: string) => cyan(underline(t));

/** Git commit SHA. */
export const sha = (s: string) => yellow(s);

/** Branch or tag name. */
export const refName = (s: string) => magenta(s);

/** Secondary metadata line. */
export const meta = (t: string) => gray(t);

/** Bold `Label:` padded to width for key/value blocks. */
export function kv(label: string, width: number): string {
  return bold(label.padEnd(width));
}

/** Colored [status] badge. Kind picks the palette. */
export type BadgeKind = "ok" | "warn" | "err" | "info" | "muted" | "accent";

export function badge(text: string, kind: BadgeKind): string {
  const p = c();
  switch (kind) {
    case "ok":
      return p.green(`[${text}]`);
    case "warn":
      return p.yellow(`[${text}]`);
    case "err":
      return p.red(`[${text}]`);
    case "accent":
      return p.magenta(`[${text}]`);
    case "muted":
      return p.gray(`[${text}]`);
    default:
      return p.cyan(`[${text}]`);
  }
}

export function statusBadge(status: string): string {
  switch (status) {
    case "applied":
    case "current":
    case "upstreamed":
    case "removed":
      return badge(status, "ok");
    case "draft":
    case "drifted":
    case "open":
    case "pending":
    case "would_remove":
      return badge(status, "warn");
    case "failed":
    case "closed":
    case "error":
      return badge(status, "err");
    case "merged":
      return badge(status, "accent");
    case "skipped":
      return badge(status, "info");
    default:
      return badge(status, "muted");
  }
}

/** Section heading in help/long output. */
export const heading = (t: string) => bold(underline(t));

/** Error prefix for stderr lines, e.g. cargo/npm style. */
export const errPrefix = () => red(bold("error:"));
export const warnPrefix = () => yellow(bold("warning:"));

/**
 * Highlight inline command mentions like `fh update` inside a sentence.
 * Replaces backtick-quoted spans with cyan.
 */
export function highlightCmds(sentence: string): string {
  if (!colorsEnabled()) return sentence;
  return sentence.replace(/`([^`]+)`/g, (_, inner: string) => cyan(inner));
}
