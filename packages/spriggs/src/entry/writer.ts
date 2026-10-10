import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  type Frontmatter,
  renderFrontmatter,
  splitFrontmatter,
  validateEntry,
} from "../docs/frontmatter";

export type Entry = {
  title: string;
  kind: "added" | "changed" | "fixed" | "removed" | "deprecated" | "internal";
  breaking: boolean;
  pr: number;
  coverage: "full" | "partial";
  reason?: "diff-too-large" | "reason-missing";
  docs: string[];
  body: string;
};

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "change";

/** One entry per pull request: rewrite an existing entry for this PR in place, else create one. */
export async function writeEntry(cwd: string, entry: Entry, today = new Date()): Promise<string> {
  const dir = join(cwd, "docs", "changes");
  mkdirSync(dir, { recursive: true });

  let path = await existingEntryFor(dir, entry.pr);
  if (!path) {
    const date = today.toISOString().slice(0, 10);
    const base = `${date}-${slugify(entry.title)}`;
    path = existsSync(join(dir, `${base}.md`)) ? `${base}-${entry.pr}.md` : `${base}.md`;
  }

  // Field order is the contract's order. `breaking` and `reason` appear only when set.
  const data: Frontmatter = { title: entry.title, kind: entry.kind };
  if (entry.breaking) data.breaking = true;
  data.pr = entry.pr;
  data.coverage = entry.coverage;
  if (entry.reason) data.reason = entry.reason;
  data.docs = entry.docs;

  const text = renderFrontmatter(data, entry.body);
  const errors = validateEntry(text);
  if (errors.length) throw new Error(`entry invalid: ${errors.join("; ")}`);
  await Bun.write(join(dir, path), text);
  return `docs/changes/${path}`;
}

async function existingEntryFor(dir: string, pr: number): Promise<string | undefined> {
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".md"))) {
    const fm = splitFrontmatter(await Bun.file(join(dir, name)).text());
    if (fm?.data.pr === pr) return name;
  }
  return undefined;
}
