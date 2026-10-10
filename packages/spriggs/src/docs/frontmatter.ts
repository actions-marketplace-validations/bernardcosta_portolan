import { parse, stringify } from "yaml";

export type Frontmatter = Record<string, unknown>;

export const KINDS = ["added", "changed", "fixed", "removed", "deprecated", "internal"] as const;
export const COVERAGES = ["full", "partial"] as const;
export const REASONS = ["diff-too-large", "reason-missing"] as const;

export function splitFrontmatter(text: string): { data: Frontmatter; body: string } | undefined {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return undefined;
  let data: unknown;
  try {
    data = parse(m[1] ?? "") ?? {};
  } catch {
    return undefined;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return undefined;
  return { data: data as Frontmatter, body: m[2] ?? "" };
}

export function renderFrontmatter(data: Frontmatter, body: string): string {
  return `---\n${stringify(data).trimEnd()}\n---\n\n${body.trim()}\n`;
}

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

/** A doc under docs/ (not an entry): `summary` required; `audience` and `covers` optional. */
export function validateDoc(text: string): string[] {
  const fm = splitFrontmatter(text);
  if (!fm) return ["missing or invalid frontmatter"];
  const errors: string[] = [];
  const { summary, audience, covers } = fm.data;
  if (typeof summary !== "string" || !summary.trim())
    errors.push("frontmatter: summary is required");
  if (audience !== undefined && audience !== "agent")
    errors.push('frontmatter: audience must be "agent" or omitted');
  if (covers !== undefined && !isStringArray(covers))
    errors.push("frontmatter: covers must be a list of paths");
  return errors;
}

/** A change entry under docs/changes/. */
export function validateEntry(text: string): string[] {
  const fm = splitFrontmatter(text);
  if (!fm) return ["missing or invalid frontmatter"];
  const errors: string[] = [];
  const d = fm.data;
  if (typeof d.title !== "string" || !d.title.trim()) errors.push("entry: title is required");
  if (!KINDS.includes(d.kind as (typeof KINDS)[number]))
    errors.push(`entry: kind must be one of ${KINDS.join(", ")}`);
  if (d.breaking !== undefined && d.breaking !== true)
    errors.push("entry: breaking must be true or omitted");
  if (typeof d.pr !== "number") errors.push("entry: pr must be a number");
  if (!COVERAGES.includes(d.coverage as (typeof COVERAGES)[number]))
    errors.push("entry: coverage must be full or partial");
  if (d.coverage === "partial" && !REASONS.includes(d.reason as (typeof REASONS)[number])) {
    errors.push(`entry: reason must be one of ${REASONS.join(", ")} when coverage is partial`);
  }
  if (!isStringArray(d.docs)) errors.push("entry: docs must be a list of paths");
  return errors;
}
