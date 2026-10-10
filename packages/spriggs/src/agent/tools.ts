import { existsSync, lstatSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { validateDoc } from "../docs/frontmatter";
import { parsePortolanYml } from "../docs/portolan";
import { git } from "../git";
import type { ToolDef } from "./providers/types";

// The five tools are the security boundary. The model has nothing else: no shell, no network.

const READ_CAP = 64_000;
const WRITE_CAP = 100_000;

export type FinishResult = {
  title: string;
  kind: "added" | "changed" | "fixed" | "removed" | "deprecated" | "internal" | "unknown";
  body: string;
  docs: string[];
  notes: string;
  large_refactor: boolean;
};

export type ToolRuntime = {
  cwd: string;
  /** Files the model may read: tracked by git, plus the changed files of this run (new files included). */
  readable: Set<string>;
  /** The diff of this run, split per changed file. */
  diffs: Map<string, string>;
  /** Files the model wrote this run, with their content before the first write (null = did not exist). */
  originals: Map<string, string | null>;
  finished?: FinishResult | undefined;
};

export function createRuntime(
  cwd: string,
  diffs: Map<string, string>,
  changedPaths: string[],
): ToolRuntime {
  const readable = new Set(git(["ls-files"], cwd).trim().split("\n").filter(Boolean));
  for (const p of changedPaths) readable.add(p);
  return { cwd, readable, diffs, originals: new Map() };
}

/** Puts every file the model wrote back the way it was. */
export async function revertWrites(rt: ToolRuntime): Promise<void> {
  for (const [path, original] of rt.originals) {
    const abs = join(rt.cwd, path);
    if (original === null) rmSync(abs, { force: true });
    else await Bun.write(abs, original);
  }
  rt.originals.clear();
}

export const TOOL_DEFS: ToolDef[] = [
  {
    name: "list_files",
    description: 'List the files tracked by git under a directory. Use "" for the repository root.',
    schema: {
      type: "object",
      properties: {
        dir: { type: "string", description: 'Directory path relative to the repo root, or "".' },
      },
      required: ["dir"],
      additionalProperties: false,
    },
  },
  {
    name: "read_file",
    description:
      "Read a file tracked by git, or a changed file. A response holds up to 64 KB; a longer file says how many lines it has and where to continue. Use start and lines to read it in parts.",
    schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        start: {
          type: "integer",
          description: "First line to read, counted from 1. 0 means the beginning.",
        },
        lines: { type: "integer", description: "How many lines to read. 0 means as many as fit." },
      },
      required: ["path", "start", "lines"],
      additionalProperties: false,
    },
  },
  {
    name: "read_diff",
    description:
      "The diff of one changed file in this pull request. Use it for files whose diff is not shown.",
    schema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "write_doc",
    description:
      "Create or overwrite one file under docs/. Markdown files must start with frontmatter that has a `summary`. " +
      "Not allowed: docs/api/ (generated) and docs/changes/ (Spriggs writes the entry itself). " +
      "Keep edits small: change only the sections the diff affects.",
    schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path under docs/, ending in .md, .yml or .html" },
        content: { type: "string", description: "The complete new file content" },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "finish",
    description:
      "End the run and report the result. Call this exactly once, when the docs are correct or when no change is needed.",
    schema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "One line, plain words, what changed. The change-feed headline.",
        },
        kind: {
          type: "string",
          enum: ["added", "changed", "fixed", "removed", "deprecated", "internal", "unknown"],
          description:
            "Keep a Changelog kind. Use unknown when the pull request gives no way to tell.",
        },
        body: {
          type: "string",
          description:
            "Two or three sentences, under 80 words: what changed, why, and what a reader must do. " +
            "A breaking change adds a short 'What to do' paragraph.",
        },
        docs: {
          type: "array",
          items: { type: "string" },
          description: "Paths under docs/ this change touched",
        },
        notes: {
          type: "string",
          description: "What you could not verify or chose not to change. May be empty.",
        },
        large_refactor: {
          type: "boolean",
          description:
            "True only for an internal change so large that readers would wonder. Usually false.",
        },
      },
      required: ["title", "kind", "body", "docs", "notes", "large_refactor"],
      additionalProperties: false,
    },
  },
];

/** A normalised repo-relative path, or undefined when it escapes the repo. */
function safeRel(input: unknown): string | undefined {
  if (typeof input !== "string" || input.includes("\0")) return undefined;
  const n = posix.normalize(input.replace(/\\/g, "/")).replace(/^\.\//, "").replace(/^\/+/, "");
  if (n === ".." || n.startsWith("../") || n.startsWith("/")) return undefined;
  return n === "." ? "" : n;
}

/** The nearest existing ancestor must resolve (symlinks followed) inside the repo's docs/. */
function insideDocs(cwd: string, rel: string): boolean {
  const docsReal = realpathSync(resolve(cwd, "docs"));
  let probe = resolve(cwd, rel);
  if (existsSync(probe) && lstatSync(probe).isSymbolicLink()) return false;
  while (!existsSync(probe)) probe = dirname(probe);
  const real = realpathSync(probe);
  return real === docsReal || real.startsWith(`${docsReal}/`);
}

type ToolResult = { content: string; isError: boolean };
const ok = (content: string): ToolResult => ({ content, isError: false });
const err = (content: string): ToolResult => ({ content, isError: true });
const field = (input: unknown, key: string): unknown =>
  typeof input === "object" && input !== null ? (input as Record<string, unknown>)[key] : undefined;

export async function runTool(rt: ToolRuntime, name: string, input: unknown): Promise<ToolResult> {
  switch (name) {
    case "list_files": {
      const dir = safeRel(field(input, "dir") ?? "");
      if (dir === undefined) return err("invalid directory");
      const prefix = dir ? `${dir}/` : "";
      const files = [...rt.readable].filter((p) => p.startsWith(prefix)).sort();
      return files.length ? ok(files.join("\n")) : err(`no tracked files under "${dir}"`);
    }
    case "read_file": {
      const path = safeRel(field(input, "path"));
      if (!path || (!rt.readable.has(path) && !rt.originals.has(path)))
        return err("not a readable file");
      if (!existsSync(join(rt.cwd, path))) return err("file does not exist in this revision");
      const all = (await Bun.file(join(rt.cwd, path)).text()).split("\n");
      const first = Math.max(1, Number(field(input, "start")) || 1);
      const want = Math.max(0, Number(field(input, "lines")) || 0) || all.length;
      if (first > all.length) return err(`the file has ${all.length} lines`);
      // Take whole lines until the cap; a cut names the next line to ask for.
      const taken: string[] = [];
      let size = 0;
      for (const line of all.slice(first - 1, first - 1 + want)) {
        if (size + line.length + 1 > READ_CAP) break;
        taken.push(line);
        size += line.length + 1;
      }
      const last = first + taken.length - 1;
      const tail =
        last < all.length
          ? `\n[lines ${first}-${last} of ${all.length}; call read_file with start=${last + 1} to continue]`
          : "";
      return ok(taken.join("\n") + tail);
    }
    case "read_diff": {
      const path = safeRel(field(input, "path"));
      const chunk = path ? rt.diffs.get(path) : undefined;
      if (chunk) {
        return ok(
          chunk.length > READ_CAP
            ? `${chunk.slice(0, READ_CAP)}\n[cut at ${READ_CAP} characters; use read_file for the full new content]`
            : chunk,
        );
      }
      if (path && rt.readable.has(path))
        return ok("new file, not in git yet: use read_file for its content");
      return err("not a changed file in this pull request");
    }
    case "write_doc":
      return writeDoc(rt, field(input, "path"), field(input, "content"));
    case "finish": {
      const r = input as Partial<FinishResult>;
      if (typeof r.title !== "string" || !r.title.trim() || typeof r.body !== "string") {
        return err("finish needs a title and a body");
      }
      rt.finished = {
        title: r.title.trim(),
        kind: r.kind ?? "unknown",
        body: r.body.trim(),
        docs: Array.isArray(r.docs) ? r.docs.map(String) : [],
        notes: typeof r.notes === "string" ? r.notes : "",
        large_refactor: r.large_refactor === true,
      };
      return ok("done");
    }
    default:
      return err(`unknown tool ${name}`);
  }
}

async function writeDoc(rt: ToolRuntime, rawPath: unknown, content: unknown): Promise<ToolResult> {
  const path = safeRel(rawPath);
  if (!path?.startsWith("docs/")) return err("path must be under docs/");
  if (path.startsWith("docs/api/"))
    return err("docs/api/ is generated from the build; do not edit it");
  if (path.startsWith("docs/changes/"))
    return err("Spriggs writes the change entry itself; do not write under docs/changes/");
  if (!/\.(md|yml|html)$/.test(path)) return err("only .md, .yml and .html files are allowed");
  if (typeof content !== "string") return err("content must be a string");
  if (content.length > WRITE_CAP) return err(`content is over ${WRITE_CAP} characters`);
  if (!insideDocs(rt.cwd, path)) return err("path resolves outside docs/");
  if (path.endsWith(".md")) {
    const errors = validateDoc(content);
    if (errors.length) return err(errors.join("; "));
  }
  if (path === "docs/portolan.yml") {
    const { errors } = parsePortolanYml(content);
    if (errors.length) return err(errors.join("; "));
  }
  const abs = join(rt.cwd, path);
  if (!rt.originals.has(path)) {
    rt.originals.set(path, existsSync(abs) ? await Bun.file(abs).text() : null);
  }
  mkdirSync(dirname(abs), { recursive: true });
  await Bun.write(abs, content);
  return ok(`wrote ${path}`);
}
