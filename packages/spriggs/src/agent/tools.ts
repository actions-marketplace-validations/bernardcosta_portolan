import { existsSync, lstatSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { validateDoc } from "../docs/frontmatter";
import { parsePortolanYml } from "../docs/portolan";
import { isGenerated } from "../gate/signals";
import { git } from "../git";
import type { ToolDef } from "./providers/types";

// The tool pool is the security boundary. The model has nothing else: no shell, no network.
// Each agent takes a subset of the pool (see agents.ts).

export type ToolName =
  | "list_files"
  | "search"
  | "read_file"
  | "read_diff"
  | "write_doc"
  | "move_doc"
  | "delete_doc"
  | "finish";

const READ_CAP = 64_000;
const SEARCH_CAP_LINES = 200;
/** One doc file, in characters. Below what one reply can carry (MAX_OUTPUT_TOKENS in loop.ts). */
const WRITE_CAP = 80_000;

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
  /** Files the model wrote, moved or deleted this run, with their content before the first change (null = did not exist). */
  originals: Map<string, string | null>;
  /** When set, write_doc accepts only these paths (a checker corrects its own pages). */
  writable?: Set<string> | undefined;
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
    name: "search",
    description:
      "Search the repository's files for a regular expression (git grep -P, Perl syntax: \\b, \\d and (?i) work). Returns file:line:text, at most 200 lines. Use it to find commands, flags, settings, endpoints and where things are defined. A pattern finds only the words in it: to find a fact, try several patterns and wordings, and run them together.",
    schema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Perl-compatible regular expression." },
        path: {
          type: "string",
          description: 'Directory to search under, or "" for the whole repository.',
        },
      },
      required: ["pattern", "path"],
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
      "Edit existing pages in place. A new path creates a page; see the rules for when a new page is right.",
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
    name: "move_doc",
    description:
      "Move or rename one page under docs/. The content stays the same; to change it too, move first, then write_doc. " +
      "Then search docs/ for links to the old path and fix them. Not allowed: docs/api/, docs/changes/, and the required " +
      "pages docs/overview.md, docs/setup.md and docs/portolan.yml.",
    schema: {
      type: "object",
      properties: {
        from: { type: "string", description: "The page's path now, under docs/" },
        to: {
          type: "string",
          description: "The new path under docs/; nothing may exist there yet",
        },
      },
      required: ["from", "to"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_doc",
    description:
      "Delete one page under docs/, when its whole subject is gone from the code or another page already says all of it. " +
      "Then search docs/ for links to it and fix them, and name the deletion in your finish notes. Not allowed: " +
      "docs/api/, docs/changes/, and the required pages docs/overview.md, docs/setup.md and docs/portolan.yml.",
    schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "The page's path under docs/" },
      },
      required: ["path"],
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

/** The subset of the pool an agent may use, in pool order. */
export function toolDefs(names: ToolName[]): ToolDef[] {
  return TOOL_DEFS.filter((t) => names.includes(t.name as ToolName));
}

/** A normalised repo-relative path, or undefined when it escapes the repo or holds a control character. */
export function safeRel(input: unknown): string | undefined {
  // A newline or escape code in a path could forge a line in the log or the report.
  if (typeof input !== "string" || /\p{Cc}/u.test(input)) return undefined;
  const n = posix.normalize(input.replace(/\\/g, "/")).replace(/^\.\//, "").replace(/^\/+/, "");
  if (n === ".." || n.startsWith("../") || n.startsWith("/")) return undefined;
  return n === "." ? "" : n;
}

/** A regular file inside the repo. A tracked symlink could point at /proc or a home directory. */
export function readableFile(cwd: string, rel: string): boolean {
  const abs = join(cwd, rel);
  if (lstatSync(abs).isSymbolicLink()) return false;
  return realpathSync(abs).startsWith(`${realpathSync(cwd)}/`);
}

/** The nearest existing ancestor must resolve (symlinks followed) inside the repo's docs/. */
function insideDocs(cwd: string, rel: string): boolean {
  mkdirSync(resolve(cwd, "docs"), { recursive: true }); // a repo adopting Spriggs may have no docs/ yet
  const docsReal = realpathSync(resolve(cwd, "docs"));
  let probe = resolve(cwd, rel);
  try {
    if (lstatSync(probe).isSymbolicLink()) return false; // also a dangling link
  } catch {}
  while (!existsSync(probe)) probe = dirname(probe);
  const real = realpathSync(probe);
  return real === docsReal || real.startsWith(`${docsReal}/`);
}

/** `partial`: the content was cut, so the file does not count as read. */
type ToolResult = { content: string; isError: boolean; partial?: boolean };
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
    case "search": {
      const pattern = field(input, "pattern");
      const dir = safeRel(field(input, "path") ?? "");
      if (typeof pattern !== "string" || !pattern.trim() || pattern.length > 200)
        return err("pattern must be 1 to 200 characters");
      if (dir === undefined) return err("invalid path");
      // -e keeps a pattern that starts with "-" a pattern; -I skips binary files. --untracked adds
      // new files that git does not ignore, so the search sees what list_files and read_file see.
      // -P (PCRE) is the dialect models write; with -E, "\b20\b" matches nothing and gives no error.
      // A git built without PCRE falls back to -E, and the result says so.
      const args = ["-c", "core.quotePath=false", "grep", "-n", "-I", "--untracked"];
      const grep = (dialect: string) =>
        Bun.spawnSync(["git", ...args, dialect, "-e", pattern, "--", dir || "."], {
          cwd: rt.cwd,
          stdout: "pipe",
          stderr: "pipe",
        });
      let p = grep("-P");
      let note = "";
      if (p.exitCode > 1 && /PCRE/i.test(p.stderr.toString())) {
        p = grep("-E");
        note =
          "[This git has no Perl regex support: the pattern ran as POSIX ERE, where \\b and \\d do not work.]\n";
      }
      if (p.exitCode === 1) return ok(`${note}no matches`);
      if (p.exitCode !== 0) return err(`search failed: ${p.stderr.toString().trim()}`);
      const lines = p.stdout
        .toString()
        .split("\n")
        .filter((l) => l && !isGenerated(l.slice(0, l.indexOf(":"))));
      const shown = lines
        .slice(0, SEARCH_CAP_LINES)
        .map((l) => (l.length > 300 ? `${l.slice(0, 300)} [cut]` : l));
      const tail =
        lines.length > SEARCH_CAP_LINES
          ? `\n[${lines.length} matches; the first ${SEARCH_CAP_LINES} are shown. Narrow the pattern or the path.]`
          : "";
      return ok(note + shown.join("\n") + tail);
    }
    case "read_file": {
      const path = safeRel(field(input, "path"));
      if (!path || (!rt.readable.has(path) && !rt.originals.has(path)))
        return err("not a readable file");
      if (!existsSync(join(rt.cwd, path))) return err("file does not exist in this revision");
      if (!readableFile(rt.cwd, path)) return err("not a readable file");
      const all = (await Bun.file(join(rt.cwd, path)).text()).split("\n");
      const first = Math.max(1, Number(field(input, "start")) || 1);
      const want = Math.max(0, Number(field(input, "lines")) || 0) || all.length;
      if (first > all.length) return err(`the file has ${all.length} lines`);
      // Take whole lines until the cap; a cut names the next line to ask for.
      const taken: string[] = [];
      let size = 0;
      for (const line of all.slice(first - 1, first - 1 + want)) {
        if (size + line.length + 1 > READ_CAP) {
          if (taken.length === 0)
            taken.push(`${line.slice(0, READ_CAP)}\n[line cut at ${READ_CAP} characters]`);
          break;
        }
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
        if (chunk.length <= READ_CAP) return ok(chunk);
        return {
          content: `${chunk.slice(0, READ_CAP)}\n[cut at ${READ_CAP} characters; use read_file for the full new content]`,
          isError: false,
          partial: true,
        };
      }
      if (path && rt.readable.has(path))
        return ok("new file, not in git yet: use read_file for its content");
      return err("not a changed file in this pull request");
    }
    case "write_doc":
      return writeDoc(rt, field(input, "path"), field(input, "content"));
    case "move_doc":
      return moveDoc(rt, field(input, "from"), field(input, "to"));
    case "delete_doc":
      return deleteDoc(rt, field(input, "path"));
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

/** Why the model may not change this path, or undefined when it may. Shared by every tool that changes docs/. */
function docsPathError(rt: ToolRuntime, path: string | undefined): string | undefined {
  if (!path?.startsWith("docs/")) return "path must be under docs/";
  if (rt.writable && !rt.writable.has(path)) return "you may only correct the pages in the message";
  if (path.startsWith("docs/api/")) return "docs/api/ is generated from the build; do not edit it";
  if (path.startsWith("docs/changes/"))
    return "Spriggs writes the change entry itself; do not write under docs/changes/";
  if (!/\.(md|yml|html)$/.test(path)) return "only .md, .yml and .html files are allowed";
  if (path.split("/").length > 4) return "docs/ folders go at most two levels deep";
  if (!insideDocs(rt.cwd, path)) return "path resolves outside docs/";
  return undefined;
}

/** The docs spine: a run may edit these pages, never move or delete them. */
const REQUIRED = new Set(["docs/overview.md", "docs/setup.md", "docs/portolan.yml"]);

/** Records a path's content before its first change this run, so a failed run can put it back. */
async function remember(rt: ToolRuntime, path: string): Promise<void> {
  const abs = join(rt.cwd, path);
  if (!rt.originals.has(path))
    rt.originals.set(path, existsSync(abs) ? await Bun.file(abs).text() : null);
}

/** Errors for content that may not go to this path. */
function contentErrors(path: string, content: string): string[] {
  if (path.endsWith(".md")) return validateDoc(content);
  if (path === "docs/portolan.yml") return parsePortolanYml(content).errors;
  return [];
}

async function writeDoc(rt: ToolRuntime, rawPath: unknown, content: unknown): Promise<ToolResult> {
  const path = safeRel(rawPath);
  const bad = docsPathError(rt, path);
  if (bad || !path) return err(bad ?? "invalid path");
  if (typeof content !== "string") return err("content must be a string");
  if (content.length > WRITE_CAP) return err(`content is over ${WRITE_CAP} characters`);
  const errors = contentErrors(path, content);
  if (errors.length) return err(errors.join("; "));
  await remember(rt, path);
  const abs = join(rt.cwd, path);
  mkdirSync(dirname(abs), { recursive: true });
  await Bun.write(abs, content);
  return ok(`wrote ${path}`);
}

/** An existing regular file under docs/ that the model may move or delete. */
function existingPage(rt: ToolRuntime, path: string | undefined): string | undefined {
  const bad = docsPathError(rt, path);
  if (bad || !path) return bad ?? "invalid path";
  if (REQUIRED.has(path)) return `${path} is a required page; edit it in place`;
  if (!existsSync(join(rt.cwd, path)) || !readableFile(rt.cwd, path))
    return `${path} does not exist`;
  return undefined;
}

async function moveDoc(rt: ToolRuntime, rawFrom: unknown, rawTo: unknown): Promise<ToolResult> {
  const from = safeRel(rawFrom);
  const to = safeRel(rawTo);
  const badFrom = existingPage(rt, from);
  if (badFrom || !from) return err(badFrom ?? "invalid path");
  const badTo = docsPathError(rt, to);
  if (badTo || !to) return err(badTo ?? "invalid path");
  if (REQUIRED.has(to)) return err(`${to} is a required page; edit it in place`);
  if (existsSync(join(rt.cwd, to))) return err(`${to} already exists`);
  const content = await Bun.file(join(rt.cwd, from)).text();
  const errors = contentErrors(to, content);
  if (errors.length)
    return err(
      `the page cannot go to ${to} as it is: ${errors.join("; ")}. Write it there with write_doc.`,
    );
  await remember(rt, from);
  await remember(rt, to);
  mkdirSync(dirname(join(rt.cwd, to)), { recursive: true });
  await Bun.write(join(rt.cwd, to), content);
  rmSync(join(rt.cwd, from));
  rt.readable.delete(from);
  rt.readable.add(to);
  return ok(`moved ${from} to ${to}`);
}

async function deleteDoc(rt: ToolRuntime, rawPath: unknown): Promise<ToolResult> {
  const path = safeRel(rawPath);
  const bad = existingPage(rt, path);
  if (bad || !path) return err(bad ?? "invalid path");
  await remember(rt, path);
  rmSync(join(rt.cwd, path));
  rt.readable.delete(path);
  return ok(`deleted ${path}`);
}
