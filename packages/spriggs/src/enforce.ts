import { existsSync } from "node:fs";
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
  opts: { strictTree: boolean; maxLines?: number },
): Promise<
  | { ok: true; written: string[]; created: string[]; deleted: string[] }
  | { ok: false; reason: string }
> {
  // A file written back with its original content is not a change. `written` holds deleted files too.
  const written: string[] = [];
  const created: string[] = [];
  const deleted: string[] = [];
  const now = new Map<string, string | null>();
  for (const [path, original] of rt.originals) {
    const abs = join(rt.cwd, path);
    const text = existsSync(abs) ? await Bun.file(abs).text() : null;
    if (text === original) continue;
    now.set(path, text);
    written.push(path);
    if (original === null) created.push(path);
    if (text === null) deleted.push(path);
  }
  written.sort();
  for (const path of written) {
    if (
      !path.startsWith("docs/") ||
      path.startsWith("docs/api/") ||
      path.startsWith("docs/changes/")
    ) {
      return { ok: false, reason: `wrote outside the allowed area: ${path}` };
    }
    const text = now.get(path);
    if (text === null || text === undefined) continue; // deleted: nothing to validate
    if (path.endsWith(".md")) {
      const errors = validateDoc(text);
      if (errors.length) return { ok: false, reason: `${path}: ${errors.join("; ")}` };
    }
    if (path === "docs/portolan.yml") {
      const { errors } = parsePortolanYml(text);
      if (errors.length) return { ok: false, reason: errors.join("; ") };
    }
  }

  // The cap is on text a reviewer must read: a deletion or an unchanged moved page adds none.
  const movedContent = new Set(deleted.map((p) => rt.originals.get(p)));
  let lines = 0;
  for (const path of written) {
    const original = rt.originals.get(path);
    const text = now.get(path);
    if (text === null || text === undefined) continue;
    if (original === null || original === undefined) {
      if (!movedContent.has(text)) lines += text.split("\n").length;
    } else lines += diffLines(original, text);
  }
  const cap = opts.maxLines ?? MAX_DOC_LINES;
  if (lines > cap)
    return { ok: false, reason: `docs edits are too large: ${lines} lines (cap ${cap})` };

  if (opts.strictTree) {
    // Lines are "XY path"; a leading space is part of XY, so no trim before the split.
    // Untracked files one by one, not collapsed to their folder.
    const changed = git(["status", "--porcelain", "--untracked-files=all"], rt.cwd)
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
  return { ok: true, written, created, deleted };
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
