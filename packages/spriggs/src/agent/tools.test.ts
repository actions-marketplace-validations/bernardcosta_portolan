import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTool, type ToolRuntime } from "./tools";

const PAGE = "---\nsummary: A page.\n---\n\nBody.\n";

let root: string;
let repo: string;
let outside: string;
let rt: ToolRuntime;

beforeEach(() => {
  // One private parent: a `../` escape from the repo lands in a folder this test owns.
  root = mkdtempSync(join(tmpdir(), "spriggs-"));
  repo = join(root, "repo");
  outside = join(root, "outside");
  mkdirSync(repo);
  mkdirSync(outside);
  mkdirSync(join(repo, "docs"));
  mkdirSync(join(repo, "src"));
  writeFileSync(join(outside, "hosts"), "original");
  symlinkSync(outside, join(repo, "docs", "out"));
  symlinkSync(join(repo, "src"), join(repo, "docs", "code"));
  symlinkSync(join(outside, "hosts"), join(repo, "docs", "hosts.md"));
  rt = { cwd: repo, readable: new Set(), diffs: new Map(), originals: new Map() };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("write_doc", () => {
  // Source: docs/spriggs/agent-harness.md, path rules: under `docs/`, not under `docs/api/` or `docs/changes/`.
  test.each([
    ["src/y.md", "src/y.md"],
    ["../spriggs-escape.md", "../spriggs-escape.md"],
    ["docs/../src/y.md", "src/y.md"],
    ["docs\\..\\src\\y.md", "src/y.md"],
    ["docs/api/x.md", "docs/api/x.md"],
    ["docs/changes/x.md", "docs/changes/x.md"],
  ])("refuses %s and writes nothing", async (path, target) => {
    const result = await runTool(rt, "write_doc", { path, content: PAGE });

    expect(result.isError).toBe(true);
    expect(existsSync(join(repo, target))).toBe(false);
    expect(rt.originals.size).toBe(0);
  });

  // Source: docs/spriggs/agent-harness.md, path rules: "no symlink out of `docs/`".
  test.each(["docs/out/x.md", "docs/code/x.md", "docs/hosts.md"])(
    "refuses %s through a symlink and writes nothing in the target",
    async (path) => {
      const result = await runTool(rt, "write_doc", { path, content: PAGE });

      expect(result.isError).toBe(true);
      expect(readdirSync(outside)).toEqual(["hosts"]);
      expect(readFileSync(join(outside, "hosts"), "utf8")).toBe("original");
      expect(readdirSync(join(repo, "src"))).toEqual([]);
    },
  );
});
