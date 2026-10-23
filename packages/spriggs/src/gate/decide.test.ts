import { describe, expect, test } from "bun:test";
import { DEFAULT_IDENTITY, type ForgeContext } from "../context";
import { skipReason } from "./decide";
import { signals } from "./signals";

const ctx = (headRef: string, authorEmail: string): ForgeContext => ({
  repo: { owner: "o", name: "r", url: "", defaultBranch: "main" },
  base: { sha: "b", ref: "main" },
  head: { sha: "h", ref: headRef, repoFullName: "o/r", authorEmail, subject: "feat: x" },
  pr: { number: 1, title: "feat: x", body: "", author: "dev", labels: [] },
  commits: [],
  event: { action: "synchronize", bodyChanged: false },
  files: [{ path: "src/a.ts", additions: 1, deletions: 0 }],
  diffRevisions: [],
  self: DEFAULT_IDENTITY,
  selfEmails: [DEFAULT_IDENTITY.email],
});

describe("skipReason", () => {
  // Source: docs/spriggs/pull-request-run.md, when Spriggs skips: the default branch, and its own head commit (CI only).
  test.each([
    ["the head commit is Spriggs's own", true, ctx("feature", DEFAULT_IDENTITY.email)],
    ["the head branch is the default branch", true, ctx("main", "dev@example.com")],
    ["a normal pull request", false, ctx("feature", "dev@example.com")],
  ])("in CI, %s: skipped %p", (_, skipped, c) => {
    expect(skipReason(c, signals(c)) !== undefined).toBe(skipped);
  });
});
