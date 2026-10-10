import { join } from "node:path";
import type { ToolRuntime } from "./agent/tools";
import { validateDoc } from "./docs/frontmatter";
import { parsePortolanYml } from "./docs/portolan";
import { git } from "./git";

export const MAX_DOC_LINES = 1500;

/**
 * Post-run check, a guard behind the tool boundary. Re-validates every file the model wrote,
 * caps the total size, and (in CI) confirms nothing else in the tree changed.
 */
export async function enforce(
  rt: ToolRuntime,
  opts: { strictTree: boolean },
): Promise<{ ok: true; written: string[] } | { ok: false; reason: string }> {
  const written = [...rt.originals.keys()].sort();
  for (const path of written) {
    if (
      !path.startsWith("docs/") ||
      path.startsWith("docs/api/") ||
      path.startsWith("docs/changes/")
    ) {
      return { ok: false, reason: `wrote outside the allowed area: ${path}` };
    }
    const text = await Bun.file(join(rt.cwd, path)).text();
    if (path.endsWith(".md")) {
      const errors = validateDoc(text);
      if (errors.length) return { ok: false, reason: `${path}: ${errors.join("; ")}` };
    }
    if (path === "docs/portolan.yml") {
      const { errors } = parsePortolanYml(text);
      if (errors.length) return { ok: false, reason: errors.join("; ") };
    }
  }

  let lines = 0;
  for (const path of written) {
    const original = rt.originals.get(path);
    const text = await Bun.file(join(rt.cwd, path)).text();
    lines +=
      original === null || original === undefined
        ? text.split("\n").length
        : diffLines(original, text);
  }
  if (lines > MAX_DOC_LINES)
    return { ok: false, reason: `docs edits are too large: ${lines} lines (cap ${MAX_DOC_LINES})` };

  if (opts.strictTree) {
    const changed = git(["status", "--porcelain"], rt.cwd)
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => line.slice(3).replace(/^.* -> /, ""));
    const stray = changed.filter((p) => !rt.originals.has(p));
    if (stray.length)
      return {
        ok: false,
        reason: `unexpected changes outside the model's writes: ${stray.join(", ")}`,
      };
  }
  return { ok: true, written };
}

/** A cheap upper bound on changed lines: lines that differ between the two texts. */
function diffLines(a: string, b: string): number {
  const before = new Set(a.split("\n"));
  const after = new Set(b.split("\n"));
  let n = 0;
  for (const l of after) if (!before.has(l)) n++;
  for (const l of before) if (!after.has(l)) n++;
  return n;
}
