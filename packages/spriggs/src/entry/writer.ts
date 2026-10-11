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

/** Words a cut slug should not end with. */
const STOP_WORDS = new Set(
  "a an the of to in on for and or with as at by from instead than into when".split(" "),
);

/** Lower-case words joined by hyphens, cut at a word boundary to about 50 characters. */
function slugify(s: string): string {
  const words = s
    .normalize("NFD")
    .replace(/\p{M}+/gu, "") // accents off: "é" -> "e"
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-");
  const kept: string[] = [];
  let length = 0;
  for (const w of words) {
    if (kept.length && length + w.length + 1 > 50) break;
    kept.push(w);
    length += w.length + (kept.length > 1 ? 1 : 0);
  }
  // A cut slug should not end in "the" or "of".
  if (kept.length < words.length) {
    while (kept.length > 1 && STOP_WORDS.has(kept[kept.length - 1] ?? "")) kept.pop();
  }
  return kept.join("-") || "change";
}

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

  await Bun.write(join(dir, path), renderEntry(entry));
  return `docs/changes/${path}`;
}

/** The entry file text, validated. Field order is the contract's order. */
export function renderEntry(entry: Entry): string {
  const data: Frontmatter = { title: entry.title, kind: entry.kind };
  if (entry.breaking) data.breaking = true; // only when set
  data.pr = entry.pr;
  data.coverage = entry.coverage;
  if (entry.reason) data.reason = entry.reason; // only when partial
  data.docs = entry.docs;
  const text = renderFrontmatter(data, entry.body);
  const errors = validateEntry(text);
  if (errors.length) throw new Error(`entry invalid: ${errors.join("; ")}`);
  return text;
}

async function existingEntryFor(dir: string, pr: number): Promise<string | undefined> {
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".md"))) {
    const fm = splitFrontmatter(await Bun.file(join(dir, name)).text());
    if (fm?.data.pr === pr) return name;
  }
  return undefined;
}
