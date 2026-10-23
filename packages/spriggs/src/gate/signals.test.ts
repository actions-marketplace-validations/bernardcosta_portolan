import { describe, expect, test } from "bun:test";
import { type Commit, DEFAULT_IDENTITY, type ForgeContext } from "../context";
import { type Kind, signals } from "./signals";

const ctx = (title: string, body = "", commits: Commit[] = []): ForgeContext => ({
  repo: { owner: "o", name: "r", url: "", defaultBranch: "main" },
  base: { sha: "b", ref: "main" },
  head: {
    sha: "h",
    ref: "feature",
    repoFullName: "o/r",
    authorEmail: "dev@example.com",
    subject: title,
  },
  pr: { number: 1, title, body, author: "dev", labels: [] },
  commits,
  event: { action: "synchronize", bodyChanged: false },
  files: [{ path: "src/a.ts", additions: 1, deletions: 0 }],
  diffRevisions: [],
  self: DEFAULT_IDENTITY,
  selfEmails: [DEFAULT_IDENTITY.email],
});

describe("signals", () => {
  // Source: docs/reference/docs-contract.md, how `kind` is filled. The model may later narrow `feat` to changed.
  test.each([
    ["feat: x", "added"],
    ["fix: x", "fixed"],
    ["perf: x", "changed"],
    ["refactor: x", "internal"],
    ["chore: x", "internal"],
    ["ci: x", "internal"],
    ["build: x", "internal"],
    ["test: x", "internal"],
    ["style: x", "internal"],
    ["docs: x", "internal"],
  ] as [string, Kind][])("maps the title %s to kind %s", (title, kind) => {
    expect(signals(ctx(title)).kind).toBe(kind);
  });

  // Source: docs/reference/docs-contract.md, how `breaking` is filled: `!`, or a line that starts with the footer.
  test.each([
    ["feat(api)!: x", "", [], true],
    ["fix: x", "Notes\nBREAKING CHANGE: the API moved", [], true],
    ["fix: x", "", [{ subject: "fix: x", body: "BREAKING CHANGE: y" }], true],
    ["fix: x", "This is not a BREAKING CHANGE: only words in a sentence", [], false],
    ["fix: x", "", [], false],
  ] as [string, string, Commit[], boolean][])(
    "title %p, description %p, commits %p gives breaking %p",
    (title, body, commits, breaking) => {
      expect(signals(ctx(title, body, commits)).breaking).toBe(breaking);
    },
  );
});
